import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  canReviewAccessTotalHierarchy,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from '../lib/permission-engine.js';
import { notifyUsers } from '../lib/notifications.js';
import { requireAuth } from '../middleware/auth.js';

import { deleteTeamById, deleteUserById } from '../services/users/admin-management.service.js';
import { canUserReviewAdmissionCountry, canUserReviewAdmissions } from '../services/users/admissions-access.service.js';
import { sendAdmissionInviteEmail } from '../services/users/admissions-email.service.js';
import {
  admissionFormSettingsSchema,
  buildDefaultAdmissionFormSettings,
  buildEmptyAdmissionPersonalData,
  getAdmissionRequiredFieldOptions,
  normalizeAdmissionFormSettings,
  normalizeEmployeeAdmissionPersonalData,
  normalizeBooleanField,
  resolveAdmissionRequiredFieldsByCountry,
  validateEmployeeAdmissionPersonalDataWithSettings,
} from '../services/users/admissions-public-data.service.js';
import {
  buildAdmissionToken,
  buildFrontendAdmissionUrl,
  createAdmissionInvitation,
  getAdmissionExpiryDate,
  hashAdmissionToken,
} from '../services/users/initiate-admission.service.js';
import {
  findActorWorkCountry,
  findAdmissionDetailById,
  listAdmissionsForReview,
  listAdmissionsWithPagination,
} from '../services/users/admissions-query.service.js';
import {
  findAdmissionById,
  markAdmissionApprovedPendingContract,
  markAdmissionCorrectionRequested,
  notifyAdmissionReadyForContract,
} from '../services/users/admissions-review.service.js';
import { approveAdmissionPersonalData, requestAdmissionCorrection } from '../services/users/admissions-review-actions.service.js';
import { completeAdmissionAndCreateUser } from '../services/users/complete-admission-actions.service.js';
import { createUser } from '../services/users/create-user.service.js';
import {
  buildDashboardSummaryAnalytics,
  buildDashboardTeamInsights,
  filterDashboardCollaborators,
  findDashboardCollaboratorsExportRows,
  loadUsersDashboardSummaryData,
  mapDashboardCollaboratorsExportRows,
} from '../services/users/dashboard-summary.service.js';
import { findCollaboratorsWithPagination, findDirectoryUsers } from '../services/users/list-users.service.js';
import { resolveAdmissionByTokenOrThrow } from '../services/users/resolve-admission-token.service.js';
import { submitAdmissionPublicForm } from '../services/users/submit-admission-public.service.js';
import { findUserActiveState, updateUserActiveState } from '../services/users/update-user.service.js';

const router = Router();
const roleSchema = z.enum(['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN', 'CONVIDADO']);
const countrySchema = z.enum(['PT', 'BR']);
const brWorkStateSchema = z.enum(['SP', 'RS']);

const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  fullName: z.string().min(2),
  role: roleSchema.optional(),
  teamId: z.string().optional(),
  workCountry: countrySchema.optional(),
});

const employeeAdmissionStatusValues = [
  'INVITED',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED_PENDING_CONTRACT',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
] as const;

type EmployeeAdmissionStatus = typeof employeeAdmissionStatusValues[number];
const employeeAdmissionStatusSchema = z.enum(employeeAdmissionStatusValues);

const employeeAdmissionCreateSchema = z.object({
  fullName: z.string().min(2, 'Nome completo é obrigatório.'),
  personalEmail: z.string().email('Email pessoal inválido.'),
  workCountry: countrySchema,
  brWorkState: brWorkStateSchema.optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.workCountry === 'BR' && !data.brWorkState) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['brWorkState'], message: 'Seleciona o estado de trabalho no Brasil.' });
  }
});

const employeeAdmissionContractSchema = z.object({
  companyEmail: z.string().email('Email da empresa inválido.'),
  companyUsername: z.string().min(3, 'Username é obrigatório.'),
  cargo: z.string().min(1, 'Cargo é obrigatório.'),
  categoriaProfissional: z.string().optional().default(''),
  numeroMecanografico: z.string().optional().default(''),
  funcao: z.string().min(1, 'Função é obrigatória.'),
  dataInicioContrato: z.string().min(1, 'Data início contrato é obrigatória.'),
  dataFimContrato: z.string().optional().default(''),
  tipoContrato: z.string().min(1, 'Tipo de contrato é obrigatório.'),
  regimeHorario: z.string().min(1, 'Regime horário é obrigatório.'),
  horasSemanaisContrato: z.string().optional().default(''),
});

const DYNAMIC_REGIME_PREFIX = 'DINAMICO::';

function parseWeeklyHoursContract(value: unknown) {
  const text = String(value ?? '').trim().replace(',', '.');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new Error('As horas semanais de contrato devem ser numéricas.');
  }

  if (parsed <= 0 || parsed > 80) {
    throw new Error('As horas semanais de contrato devem estar entre 1 e 80 horas.');
  }

  return Math.round(parsed * 100) / 100;
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return (hours * 60) + minutes;
}

function calculateWeeklyHoursFromDynamicRegime(value: string) {
  if (!value.startsWith(DYNAMIC_REGIME_PREFIX)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(value.slice(DYNAMIC_REGIME_PREFIX.length));
  } catch {
    throw new Error('Configuração de horas de trabalho inválida.');
  }

  if (!Array.isArray(payload)) {
    throw new Error('Configuração de horas de trabalho inválida.');
  }

  let totalMinutes = 0;
  let activeDays = 0;

  for (const item of payload) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (record.enabled !== true) {
      continue;
    }

    activeDays += 1;
    const start = parseTimeToMinutes(String(record.start ?? ''));
    const end = parseTimeToMinutes(String(record.end ?? ''));
    if (start == null || end == null || end <= start) {
      throw new Error('Configuração de horas de trabalho inválida. Verifica os horários dos dias ativos.');
    }

    totalMinutes += (end - start);
  }

  if (activeDays === 0 || totalMinutes <= 0) {
    throw new Error('Configuração de horas de trabalho inválida. Define pelo menos um dia ativo.');
  }

  return Math.round((totalMinutes / 60) * 100) / 100;
}

function deriveAdmissionHourBankLimitHours(contract: z.infer<typeof employeeAdmissionContractSchema>) {
  if (contract.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) {
    return calculateWeeklyHoursFromDynamicRegime(contract.regimeHorario) ?? undefined;
  }

  const raw = String(contract.horasSemanaisContrato ?? '').trim();
  if (!raw) {
    return undefined;
  }

  return parseWeeklyHoursContract(raw);
}

const employeeAdmissionCorrectionSchema = z.object({
  reason: z.string().trim().min(5, 'Indica nas observações o que está mal.'),
});

const ADMISSION_FORM_SETTINGS_KEY = 'admissions_public_form_settings_v1';

async function getAdmissionFormSettings() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: ADMISSION_FORM_SETTINGS_KEY },
    select: { textValue: true },
  });

  if (!setting?.textValue) {
    return buildDefaultAdmissionFormSettings();
  }

  try {
    const parsed = JSON.parse(setting.textValue) as unknown;
    return normalizeAdmissionFormSettings(parsed);
  } catch {
    return buildDefaultAdmissionFormSettings();
  }
}

async function canManageAdmissionFormSettings(actor: { id: string; isRootAccess: boolean }) {
  if (actor.isRootAccess) {
    return true;
  }

  return isAccessTotal(actor.id);
}

const BULK_IMPORT_PROFILE_FIELD_KEYS = [
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'curso',
  'faculdade',
  'nacionalidade',
  'emailPessoal',
  'telemovel',
  'githubUser',
  'moradaFiscal',
  'endereco',
  'localidade',
  'codigoPostal',
  'matriculaCarro',
  'cartaoCidadao',
  'validadeCartaoCidadao',
  'nif',
  'niss',
  'iban',
  'situacaoIrs',
  'numeroDependentes',
  'declaracaoIrs',
  'irsJovem',
  'anoPrimeiroDesconto',
  'numeroCartaoContinente',
  'voucherNosData',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
  'cargo',
  'categoriaProfissional',
  'funcao',
  'dataInicioContrato',
  'dataFimContrato',
  'tipoContrato',
  'regimeHorario',
  'workCountry',
  'brWorkState',
  'localidade',
  'isActive',
] as const;

type BulkImportProfileFieldKey = typeof BULK_IMPORT_PROFILE_FIELD_KEYS[number];

const bulkImportUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  fullName: z.string().min(2),
  teamName: z.string().optional(),
  subTeamName: z.string().optional(),
  workCountry: countrySchema.optional(),
  profile: z.record(z.string(), z.string()).optional(),
});

const bulkImportUsersSchema = z.object({
  rows: z.array(bulkImportUserSchema).min(1).max(200),
});

const updateAdminUserSchema = z.object({
  nomeCompleto: z.string().optional(),
  nomeAbreviado: z.string().optional(),
  dataNascimento: z.string().optional(),
  genero: z.string().optional(),
  estadoCivil: z.string().optional(),
  habilitacoesLiterarias: z.string().optional(),
  curso: z.string().optional(),
  faculdade: z.string().optional(),
  nacionalidade: z.string().optional(),
  emailPessoal: z.string().optional(),
  telemovel: z.string().optional(),
  githubUser: z.string().optional(),
  moradaFiscal: z.string().optional(),
  endereco: z.string().optional(),
  role: roleSchema.optional(),
  teamId: z.string().nullable().optional(),
  codigoPostal: z.string().optional(),
  matriculaCarro: z.string().optional(),
  localNascimentoPais: z.string().optional(),
  localNascimentoCidade: z.string().optional(),
  nomePai: z.string().optional(),
  nomeMae: z.string().optional(),
  cartaoCidadao: z.string().optional(),
  nif: z.string().optional(),
  cpf: z.string().optional(),
  pis: z.string().optional(),
  ctps: z.string().optional(),
  ctpsSerie: z.string().optional(),
  ctpsDataExpedicao: z.string().optional(),
  rg: z.string().optional(),
  rgOrgaoEmissor: z.string().optional(),
  rgDataExpedicao: z.string().optional(),
  cnh: z.string().optional(),
  cnhCategoria: z.string().optional(),
  cnhDataValidade: z.string().optional(),
  tituloEleitor: z.string().optional(),
  zonaEleitoral: z.string().optional(),
  secaoEleitoral: z.string().optional(),
  certificadoReservista: z.string().optional(),
  niss: z.string().optional(),
  iban: z.string().optional(),
  situacaoIrs: z.string().optional(),
  numeroDependentes: z.string().optional(),
  declaracaoIrs: z.string().optional(),
  irsJovem: z.string().optional(),
  anoPrimeiroDesconto: z.string().optional(),
  primeiroEmprego: z.boolean().optional(),
  recebeAposentadoria: z.boolean().optional(),
  recebeSeguroDesemprego: z.boolean().optional(),
  valeTransporte: z.boolean().optional(),
  numeroCartaoContinente: z.string().optional(),
  voucherNosData: z.string().optional(),
  comprovativoMoradaFiscal: z.string().optional(),
  comprovativoCartaoCidadao: z.string().optional(),
  comprovativoIban: z.string().optional(),
  comprovativoCartaoContinente: z.string().optional(),
  criminalRecordUrl: z.string().optional(),
  contactoEmergenciaNome: z.string().optional(),
  contactoEmergenciaParentesco: z.string().optional(),
  contactoEmergenciaNumero: z.string().optional(),
  validadeCartaoCidadao: z.string().optional(),
  cargo: z.string().optional(),
  categoriaProfissional: z.string().optional(),
  numeroMecanografico: z.string().optional(),
  funcao: z.string().optional(),
  dataInicioContrato: z.string().optional(),
  dataFimContrato: z.string().optional(),
  tipoContrato: z.string().optional(),
  regimeHorario: z.string().optional(),
  horasSemanaisContrato: z.string().optional(),
  workCountry: z.string().optional(),
  brWorkState: z.string().optional(),
  localidade: z.string().optional(),
  isActive: z.boolean().optional(),
});

const updateUserActiveSchema = z.object({
  isActive: z.boolean(),
});

const SENSITIVE_PROFILE_FIELDS = [
  'nomePai',
  'nomeMae',
  'moradaFiscal',
  'endereco',
  'codigoPostal',
  'cartaoCidadao',
  'validadeCartaoCidadao',
  'nif',
  'cpf',
  'pis',
  'ctps',
  'ctpsSerie',
  'ctpsDataExpedicao',
  'rg',
  'rgOrgaoEmissor',
  'rgDataExpedicao',
  'cnh',
  'cnhCategoria',
  'cnhDataValidade',
  'tituloEleitor',
  'zonaEleitoral',
  'secaoEleitoral',
  'certificadoReservista',
  'niss',
  'iban',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'criminalRecordUrl',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
] as const;

function sanitizeProfileForViewer<T extends object | null | undefined>(profile: T, canViewSensitiveData: boolean): T {
  if (!profile || canViewSensitiveData) {
    return profile;
  }

  const sanitized = { ...(profile as Record<string, unknown>) };
  for (const field of SENSITIVE_PROFILE_FIELDS) {
    if (field in sanitized) {
      sanitized[field] = '';
    }
  }

  return sanitized as T;
}

const updateAdminUserCredentialsSchema = z.object({
  username: z.string().min(3).optional(),
  email: z.string().email().optional(),
}).refine((data) => Boolean(data.username || data.email), {
  message: 'Indica pelo menos um campo para atualizar.',
  path: ['username'],
});

const updateAdminMembershipsSchema = z.object({
  memberships: z.array(z.object({
    teamId: z.string().min(1),
    membershipRole: z.string().optional(),
    isApprover: z.boolean().optional(),
    approvalLevel: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })).default([]),
});

const adminTeamSchema = z.object({
  name: z.string().min(2),
  leaderId: z.string().nullable().optional(),
  memberIds: z.array(z.string().min(1)).optional().default([]),
  parentTeamId: z.string().nullable().optional(),
  costCenter: z.string().max(120).nullable().optional(),
  color: z.string().max(30).nullable().optional(),
});

const managerTeamMemberUpdateSchema = z.object({
  teamId: z.string().nullable().optional(),
  cargo: z.string().optional(),
  categoriaProfissional: z.string().optional(),
  funcao: z.string().optional(),
  nacionalidade: z.string().optional(),
  githubUser: z.string().optional(),
  validadeCartaoCidadao: z.string().optional(),
});

const AUTO_DEFAULT_EMPLOYEE_NOTE = '[AUTO_PRESET_DEFAULT_EMPLOYEE]';
const AUTO_TEAM_LEADER_NOTE = '[AUTO_PRESET_TEAM_LEADER]';

function normalizeTextField(value?: string | null) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function isValidNif(value: string) {
  const digits = onlyDigits(value);
  if (!/^\d{9}$/.test(digits)) {
    return false;
  }

  const firstDigit = Number(digits[0]);
  if (![1, 2, 3, 5, 6, 8, 9].includes(firstDigit)) {
    return false;
  }

  let total = 0;
  for (let index = 0; index < 8; index += 1) {
    total += Number(digits[index]) * (9 - index);
  }
  const modulo = total % 11;
  const checkDigit = modulo < 2 ? 0 : 11 - modulo;
  return checkDigit === Number(digits[8]);
}

function isValidNiss(value: string) {
  return /^\d{11}$/.test(onlyDigits(value));
}

function getTeamPeopleCount(input: {
  memberships: Array<{ userId: string }>;
  managerId?: string | null;
  coordinatorId?: string | null;
}) {
  const peopleIds = new Set<string>();

  for (const membership of input.memberships) {
    peopleIds.add(membership.userId);
  }

  if (input.managerId) {
    peopleIds.add(input.managerId);
  }

  if (input.coordinatorId) {
    peopleIds.add(input.coordinatorId);
  }

  return {
    members: peopleIds.size,
    memberships: input.memberships.length,
  };
}

function normalizeIban(value: string) {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isValidIban(value: string) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return false;
  }

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;

  for (const char of rearranged) {
    const expanded = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
}

function isValidPhone(value: string) {
  const compact = value.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) {
    return false;
  }
  const digits = compact.replace(/^\+/, '');
  return digits.length >= 9 && digits.length <= 15;
}

function isNonNegativeInteger(value: string) {
  return /^\d+$/.test(value);
}

function isReasonableYear(value: string) {
  if (!/^\d{4}$/.test(value)) {
    return false;
  }
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  return year >= 1900 && year <= currentYear + 1;
}

function buildTodayIsoDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function sanitizeBulkImportProfile(profile?: Record<string, string>) {
  const sanitized: Partial<Record<BulkImportProfileFieldKey, string>> = {};

  for (const key of BULK_IMPORT_PROFILE_FIELD_KEYS) {
    sanitized[key] = normalizeTextField(profile?.[key]);
  }

  return sanitized;
}

function resolveManagedUserInitialPassword() {
  const configured = process.env.AUTH_PROVISION_INITIAL_PASSWORD?.trim();
  return configured && configured.length >= 12
    ? configured
    : randomBytes(32).toString('base64url');
}

async function createManagedUser(params: {
  actorUserId: string;
  username: string;
  email: string;
  fullName: string;
  role?: z.infer<typeof roleSchema>;
  teamId?: string | null;
  workCountry?: z.infer<typeof countrySchema>;
  profile?: Partial<Record<string, unknown>>;
}) {
  const passwordHash = await bcrypt.hash(resolveManagedUserInitialPassword(), 10);
  const fullName = normalizeTextField(params.fullName).replace(/\s+/g, ' ');
  const profile = params.profile ?? {};
  const workCountry = params.workCountry ?? 'PT';
  const shortName = normalizeTextField(String(profile.nomeAbreviado ?? '')) || fullName;
  const dataInicioContrato = normalizeTextField(String(profile.dataInicioContrato ?? '')) || buildTodayIsoDate();
  const rawHourBankLimit = Number(profile.hourBankLimitHours);
  const hourBankLimitHours = Number.isFinite(rawHourBankLimit) && rawHourBankLimit > 0
    ? Math.round(rawHourBankLimit * 100) / 100
    : null;
  const user = await prisma.user.create({
    data: {
      username: normalizeTextField(params.username).toLowerCase(),
      email: normalizeTextField(params.email).toLowerCase(),
      passwordHash,
      role: params.role ?? 'COLABORADOR',
      teamId: params.teamId || null,
      ...(params.teamId
        ? {
            teamMemberships: {
              create: {
                teamId: params.teamId,
                membershipRole: 'PARTICIPANT',
                isApprover: false,
                isActive: true,
              },
            },
          }
        : {}),
      profile: {
        create: {
          nomeCompleto: fullName,
          nomeAbreviado: shortName,
          dataNascimento: normalizeTextField(String(profile.dataNascimento ?? '')),
          genero: normalizeTextField(String(profile.genero ?? '')),
          estadoCivil: normalizeTextField(String(profile.estadoCivil ?? '')),
          habilitacoesLiterarias: normalizeTextField(String(profile.habilitacoesLiterarias ?? '')),
          curso: normalizeTextField(String(profile.curso ?? '')),
          faculdade: normalizeTextField(String(profile.faculdade ?? '')),
          nacionalidade: normalizeTextField(String(profile.nacionalidade ?? '')),
          emailPessoal: normalizeTextField(String(profile.emailPessoal ?? '')) || normalizeTextField(params.email).toLowerCase(),
          telemovel: normalizeTextField(String(profile.telemovel ?? '')),
          githubUser: normalizeTextField(String(profile.githubUser ?? '')),
          moradaFiscal: normalizeTextField(String(profile.moradaFiscal ?? '')),
          endereco: normalizeTextField(String(profile.endereco ?? '')),
          localidade: normalizeTextField(String(profile.localidade ?? '')),
          codigoPostal: normalizeTextField(String(profile.codigoPostal ?? '')),
          matriculaCarro: normalizeTextField(String(profile.matriculaCarro ?? '')),
          localNascimentoPais: normalizeTextField(String(profile.localNascimentoPais ?? '')),
          localNascimentoCidade: normalizeTextField(String(profile.localNascimentoCidade ?? '')),
          nomePai: normalizeTextField(String(profile.nomePai ?? '')),
          nomeMae: normalizeTextField(String(profile.nomeMae ?? '')),
          cartaoCidadao: normalizeTextField(String(profile.cartaoCidadao ?? '')),
          validadeCartaoCidadao: normalizeTextField(String(profile.validadeCartaoCidadao ?? '')),
          nif: normalizeTextField(String(profile.nif ?? '')),
          cpf: normalizeTextField(String(profile.cpf ?? '')),
          pis: normalizeTextField(String(profile.pis ?? '')),
          ctps: normalizeTextField(String(profile.ctps ?? '')),
          ctpsSerie: normalizeTextField(String(profile.ctpsSerie ?? '')),
          ctpsDataExpedicao: normalizeTextField(String(profile.ctpsDataExpedicao ?? '')),
          rg: normalizeTextField(String(profile.rg ?? '')),
          rgOrgaoEmissor: normalizeTextField(String(profile.rgOrgaoEmissor ?? '')),
          rgDataExpedicao: normalizeTextField(String(profile.rgDataExpedicao ?? '')),
          cnh: normalizeTextField(String(profile.cnh ?? '')),
          cnhCategoria: normalizeTextField(String(profile.cnhCategoria ?? '')),
          cnhDataValidade: normalizeTextField(String(profile.cnhDataValidade ?? '')),
          tituloEleitor: normalizeTextField(String(profile.tituloEleitor ?? '')),
          zonaEleitoral: normalizeTextField(String(profile.zonaEleitoral ?? '')),
          secaoEleitoral: normalizeTextField(String(profile.secaoEleitoral ?? '')),
          certificadoReservista: normalizeTextField(String(profile.certificadoReservista ?? '')),
          niss: normalizeTextField(String(profile.niss ?? '')),
          iban: normalizeTextField(String(profile.iban ?? '')),
          situacaoIrs: normalizeTextField(String(profile.situacaoIrs ?? '')),
          numeroDependentes: normalizeTextField(String(profile.numeroDependentes ?? '')),
          declaracaoIrs: normalizeTextField(String(profile.declaracaoIrs ?? '')),
          irsJovem: normalizeTextField(String(profile.irsJovem ?? '')),
          anoPrimeiroDesconto: normalizeTextField(String(profile.anoPrimeiroDesconto ?? '')),
          primeiroEmprego: normalizeBooleanField(profile.primeiroEmprego),
          recebeAposentadoria: normalizeBooleanField(profile.recebeAposentadoria),
          recebeSeguroDesemprego: normalizeBooleanField(profile.recebeSeguroDesemprego),
          valeTransporte: normalizeBooleanField(profile.valeTransporte),
          numeroCartaoContinente: normalizeTextField(String(profile.numeroCartaoContinente ?? '')),
          voucherNosData: normalizeTextField(String(profile.voucherNosData ?? '')),
          comprovativoMoradaFiscal: normalizeTextField(String(profile.comprovativoMoradaFiscal ?? '')),
          comprovativoCartaoCidadao: normalizeTextField(String(profile.comprovativoCartaoCidadao ?? '')),
          comprovativoIban: normalizeTextField(String(profile.comprovativoIban ?? '')),
          comprovativoCartaoContinente: normalizeTextField(String(profile.comprovativoCartaoContinente ?? '')),
          criminalRecordUrl: normalizeTextField(String(profile.criminalRecordUrl ?? '')),
          contactoEmergenciaNome: normalizeTextField(String(profile.contactoEmergenciaNome ?? '')),
          contactoEmergenciaParentesco: normalizeTextField(String(profile.contactoEmergenciaParentesco ?? '')),
          contactoEmergenciaNumero: normalizeTextField(String(profile.contactoEmergenciaNumero ?? '')),
          cargo: normalizeTextField(String(profile.cargo ?? '')),
          categoriaProfissional: normalizeTextField(String(profile.categoriaProfissional ?? '')),
          numeroMecanografico: normalizeTextField(String(profile.numeroMecanografico ?? '')),
          funcao: normalizeTextField(String(profile.funcao ?? '')),
          dataInicioContrato,
          dataFimContrato: normalizeTextField(String(profile.dataFimContrato ?? '')),
          tipoContrato: normalizeTextField(String(profile.tipoContrato ?? '')),
          regimeHorario: normalizeTextField(String(profile.regimeHorario ?? '')),
          ...(hourBankLimitHours != null ? { hourBankLimitHours } : {}),
          workCountry,
          brWorkState: workCountry === 'BR'
            ? ((normalizeTextField(String(profile.brWorkState ?? '')) || null) as 'SP' | 'RS' | null)
            : null,
        },
      },
    },
    include: {
      profile: true,
    },
  });

  const createdRole = params.role ?? 'COLABORADOR';

  if (createdRole !== 'CONVIDADO') {
    await upsertPresetPermissions({
      userId: user.id,
      actorUserId: params.actorUserId,
      codes: DEFAULT_EMPLOYEE_PERMISSION_CODES,
      note: AUTO_DEFAULT_EMPLOYEE_NOTE,
    });
  }

  await syncTeamLeaderPreset(user.id, params.actorUserId);

  const { passwordHash: _ignored, ...safeUser } = user;
  return safeUser;
}

function normalizeTeamCostCenter(value?: string | null) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseIsoDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseMultiValueQuery(value: unknown) {
  const rawValues = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

  return rawValues
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, collection) => collection.indexOf(entry) === index);
}

const DEFAULT_EMPLOYEE_PERMISSION_CODES = [
  'view_profile',
  'request_profile_change',
  'view_notifications',
  'request_vacation',
  'view_own_vacations',
  'view_team_vacations',
  'request_training',
  'view_trainings',
] as const;

const TEAM_LEADER_PERMISSION_CODES = [
  'view_teams',
  'manage_team_members',
  'view_team_vacations',
  'approve_vacation',
  'reject_vacation',
  'assign_training',
] as const;

async function upsertPresetPermissions(params: {
  userId: string;
  actorUserId?: string;
  codes: readonly string[];
  note: string;
  restrictedToTeams?: string[];
  restrictedToCountries?: Array<'PT' | 'BR'>;
  restrictedToLevels?: string[];
}) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...params.codes] } },
    select: { id: true },
  });

  if (permissions.length === 0) {
    return;
  }

  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: params.userId,
          permissionId: permission.id,
        },
      },
      create: {
        userId: params.userId,
        permissionId: permission.id,
        isEnabled: true,
        restrictedToTeams: params.restrictedToTeams ?? [],
        restrictedToCountries: params.restrictedToCountries ?? [],
        restrictedToLevels: params.restrictedToLevels ?? [],
        notes: params.note,
        grantedById: params.actorUserId,
      },
      update: {
        isEnabled: true,
        restrictedToTeams: params.restrictedToTeams ?? [],
        restrictedToCountries: params.restrictedToCountries ?? [],
        restrictedToLevels: params.restrictedToLevels ?? [],
        notes: params.note,
        grantedById: params.actorUserId,
      },
    });
  }
}

async function disablePresetPermissions(userId: string, codes: readonly string[], actorUserId?: string) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true },
  });

  if (permissions.length === 0) {
    return;
  }

  await prisma.userPermission.updateMany({
    where: {
      userId,
      permissionId: { in: permissions.map((item) => item.id) },
    },
    data: {
      isEnabled: false,
      grantedById: actorUserId,
    },
  });
}

async function syncTeamLeaderPreset(userId: string, actorUserId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true },
  });

  if (!user) {
    return;
  }

  // Quem tem acesso total/root não deve ser limitado pelo preset de chefe.
  if (user.isRootAccess || await isAccessTotal(userId)) {
    return;
  }

  const ledTeams = await prisma.team.findMany({
    where: { managerId: userId },
    select: { id: true },
  });

  const ledTeamIds = ledTeams.map((team) => team.id);

  if (ledTeamIds.length === 0) {
    await disablePresetPermissions(userId, TEAM_LEADER_PERMISSION_CODES, actorUserId);
    return;
  }

  await upsertPresetPermissions({
    userId,
    actorUserId,
    codes: TEAM_LEADER_PERMISSION_CODES,
    note: AUTO_TEAM_LEADER_NOTE,
    restrictedToTeams: ledTeamIds,
  });
}

function parseBooleanQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'sim', 'yes'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'nao', 'não', 'no'].includes(normalized)) {
    return false;
  }

  return undefined;
}

async function resolveTeamScopeForUser(userId: string, isRootAccess: boolean) {
  const [teamsScope, vacationsScope, isFullAccess, user, managedTeams] = await Promise.all([
    getPermissionScope(userId, 'view_teams'),
    getPermissionScope(userId, 'view_team_vacations'),
    isAccessTotal(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        teamId: true,
        teamMemberships: {
          where: { isActive: true },
          select: { teamId: true },
        },
      },
    }),
    prisma.team.findMany({
      where: {
        OR: [
          { managerId: userId },
          { coordinatorId: userId },
        ],
      },
      select: { id: true },
    }),
  ]);

  const hasTeamViewPermission = Boolean(teamsScope);
  const hasVacationTeamViewPermission = Boolean(vacationsScope);
  const restrictedTeamsForTeamView = teamsScope?.restrictedToTeams ?? null;
  const restrictedTeamsForVacationView = vacationsScope?.restrictedToTeams ?? null;

  const ownTeamIds = new Set<string>();
  if (user?.teamId) {
    ownTeamIds.add(user.teamId);
  }
  for (const membership of user?.teamMemberships ?? []) {
    ownTeamIds.add(membership.teamId);
  }
  for (const team of managedTeams) {
    ownTeamIds.add(team.id);
  }

  const canViewGlobally = isRootAccess
    || isFullAccess
    || (hasTeamViewPermission && restrictedTeamsForTeamView === null)
    || (hasVacationTeamViewPermission && restrictedTeamsForVacationView === null);
  if (canViewGlobally) {
    return { isGlobal: true, teamIds: [] as string[] };
  }

  const allowed = new Set<string>([...ownTeamIds]);
  if (hasTeamViewPermission && restrictedTeamsForTeamView && restrictedTeamsForTeamView.length > 0) {
    for (const teamId of restrictedTeamsForTeamView) {
      allowed.add(teamId);
    }
  }
  if (hasVacationTeamViewPermission && restrictedTeamsForVacationView && restrictedTeamsForVacationView.length > 0) {
    for (const teamId of restrictedTeamsForVacationView) {
      allowed.add(teamId);
    }
  }

  return { isGlobal: false, teamIds: [...allowed] };
}

router.get('/users', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const canViewSensitiveProfileData = req.authUser!.isRootAccess
    || await isAccessTotal(req.authUser!.id)
    || await hasPermission(req.authUser!.id, 'edit_other_profile');

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const email = typeof req.query.email === 'string' ? req.query.email : undefined;
  const limitRaw = typeof req.query.limit === 'string' ? req.query.limit.trim() : '';
  if (!/^\d+$/.test(limitRaw)) {
    return res.status(400).json({ message: 'Parâmetro limit é obrigatório e deve ser numérico.' });
  }

  const limit = Math.min(Math.max(Number(limitRaw), 1), 100);

  const baseWhere: Prisma.UserWhereInput = {
      isActive: true,
      ...(email ? { email } : {}),
      role: {
        in: ['COLABORADOR', 'MANAGER', 'COORDENADOR'],
      },
      ...(q
        ? {
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { profile: { nomeCompleto: { contains: q, mode: 'insensitive' } } },
              { profile: { nacionalidade: { contains: q, mode: 'insensitive' } } },
              { profile: { cargo: { contains: q, mode: 'insensitive' } } },
              { profile: { categoriaProfissional: { contains: q, mode: 'insensitive' } } },
              { profile: { funcao: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const where: Prisma.UserWhereInput = scopeWhere
    ? { AND: [baseWhere, scopeWhere] }
    : baseWhere;

  const users = await findDirectoryUsers(where, limit);

  const normalizedUsers = users.map((user) => ({
    ...user,
    profile: sanitizeProfileForViewer(user.profile, canViewSensitiveProfileData),
    team: user.team ?? user.teamMemberships[0]?.team ?? user.managedTeams[0] ?? null,
    teamRole: (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id)
      && user.managedTeams.some((team) => team.id === (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id))
      ? 'LEADER'
      : user.team || user.teamMemberships[0]?.team || user.managedTeams[0]
        ? 'MEMBER'
        : null,
  }));

  return res.json(normalizedUsers);
});

router.get('/users/collaborators', requireAuth, async (req, res) => {
  const actorUserId = req.authUser!.id;
  const [hasUserListPermission, hasAccessTotalActor, managedTeams] = await Promise.all([
    hasPermission(actorUserId, 'view_user_list'),
    isAccessTotal(actorUserId),
    prisma.team.findMany({
      where: {
        OR: [
          { managerId: actorUserId },
          { coordinatorId: actorUserId },
        ],
      },
      select: { id: true },
    }),
  ]);

  const managedTeamIds = managedTeams.map((item) => item.id);
  const hasLeadershipVisibility = req.authUser!.isRootAccess || hasAccessTotalActor || managedTeamIds.length > 0;

  let scopeWhere: Prisma.UserWhereInput | null = null;
  if (hasUserListPermission) {
    const scope = await getPermissionScope(actorUserId, 'view_user_list');
    if (!scope) {
      return res.status(403).json({ message: 'Sem permissões para consultar colaboradores.' });
    }

    scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  } else if (hasLeadershipVisibility) {
    if (!req.authUser!.isRootAccess && !hasAccessTotalActor && managedTeamIds.length === 0) {
      return res.status(403).json({ message: 'Sem permissões para consultar colaboradores.' });
    }

    scopeWhere = (req.authUser!.isRootAccess || hasAccessTotalActor)
      ? null
      : {
          OR: [
            { teamId: { in: managedTeamIds } },
            { teamMemberships: { some: { teamId: { in: managedTeamIds }, isActive: true } } },
          ],
        };
  } else {
    return res.status(403).json({ message: 'Sem permissões para consultar colaboradores.' });
  }

  const canViewSensitiveProfileData = req.authUser!.isRootAccess
    || await isAccessTotal(req.authUser!.id)
    || await hasPermission(req.authUser!.id, 'edit_other_profile');

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const role = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId.trim() : '';
  const workCountry = typeof req.query.workCountry === 'string' ? req.query.workCountry.trim().toUpperCase() : '';
  const active = parseBooleanQuery(req.query.active);
  const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt';
  const sortDirection = typeof req.query.sortDirection === 'string' && req.query.sortDirection.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const pageRaw = typeof req.query.page === 'string' ? req.query.page.trim() : '';
  const pageSizeRaw = typeof req.query.pageSize === 'string' ? req.query.pageSize.trim() : '';
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(pageSizeRaw)) {
    return res.status(400).json({ message: 'Parâmetros de paginação são obrigatórios (page e pageSize).' });
  }

  const page = Math.max(1, Number(pageRaw));
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw)));
  const parsedRole = roleSchema.safeParse(role);

  const andConditions: Prisma.UserWhereInput[] = [];
  if (teamId) {
    andConditions.push({
      OR: [
        { teamId },
        { teamMemberships: { some: { teamId, isActive: true } } },
      ],
    });
  }

  if (q) {
    andConditions.push({
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { profile: { nomeAbreviado: { contains: q, mode: 'insensitive' } } },
        { profile: { nomeCompleto: { contains: q, mode: 'insensitive' } } },
        { profile: { nacionalidade: { contains: q, mode: 'insensitive' } } },
        { profile: { cargo: { contains: q, mode: 'insensitive' } } },
        { profile: { categoriaProfissional: { contains: q, mode: 'insensitive' } } },
        { profile: { funcao: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const orderByMap: Record<string, { [key: string]: 'asc' | 'desc' }> = {
    createdAt: { createdAt: sortDirection },
    updatedAt: { updatedAt: sortDirection },
    username: { username: sortDirection },
    email: { email: sortDirection },
    role: { role: sortDirection },
  };

  const where: Prisma.UserWhereInput = {
    role: parsedRole.success ? parsedRole.data : { in: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'] },
    ...(workCountry && countrySchema.safeParse(workCountry).success ? { profile: { workCountry: workCountry as 'PT' | 'BR' } } : {}),
    ...(typeof active === 'boolean' ? { isActive: active } : {}),
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  };

  const scopedWhere: Prisma.UserWhereInput = scopeWhere
    ? { AND: [where, scopeWhere] }
    : where;

  const { total, rows } = await findCollaboratorsWithPagination({
    where: scopedWhere,
    page,
    pageSize,
    orderBy: orderByMap[sortBy] || orderByMap.createdAt,
  });

  const normalizedRows = rows.map((user) => ({
    ...user,
    profile: sanitizeProfileForViewer(user.profile, canViewSensitiveProfileData),
    team: user.team ?? user.teamMemberships[0]?.team ?? user.managedTeams[0] ?? null,
    teamRole: (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id)
      && user.managedTeams.some((team) => team.id === (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id))
      ? 'LEADER'
      : user.team || user.teamMemberships[0]?.team || user.managedTeams[0]
        ? 'MEMBER'
        : null,
  }));

  return res.json({ total, page, pageSize, rows: normalizedRows });
});

router.get('/users/dashboard-summary', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar o dashboard.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar o dashboard.' });
  }

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const collaboratorWhere: Prisma.UserWhereInput = {
    role: { in: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'] },
    ...(scopeWhere ? { AND: [scopeWhere] } : {}),
  };

  const requestScopeWhere = scopeWhere ? { user: scopeWhere } : {};
  const actorHasAccessTotal = Boolean(req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id));

  const [usersResult, profileRequestsResult, vacationsResult, trainingsResult, historyResult] = await loadUsersDashboardSummaryData({
    collaboratorWhere,
    requestScopeWhere: scopeWhere,
  });

  const collaboratorRows = usersResult.status === 'fulfilled' ? usersResult.value : [];

  const filterSearch = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const filterTeamId = typeof req.query.teamId === 'string' ? req.query.teamId.trim() : '';
  const filterRole = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
  const filterGender = typeof req.query.gender === 'string' ? req.query.gender.trim() : '';
  const filterFunction = typeof req.query.function === 'string' ? req.query.function.trim() : '';
  const filterContractTypes = parseMultiValueQuery(req.query.contractType);
  const filterGeography = typeof req.query.geography === 'string' ? req.query.geography.trim() : '';
  const filterLevel = typeof req.query.level === 'string' ? req.query.level.trim() : '';
  const filterIsActive = typeof req.query.isActive === 'string' ? req.query.isActive.trim().toLowerCase() : '';
  const filterPeriodStart = typeof req.query.periodStart === 'string' ? req.query.periodStart.trim() : '';
  const filterPeriodEnd = typeof req.query.periodEnd === 'string' ? req.query.periodEnd.trim() : '';

  const periodStartDate = filterPeriodStart ? parseIsoDate(filterPeriodStart) : null;
  const periodEndDate = filterPeriodEnd ? parseIsoDate(filterPeriodEnd) : null;

  if ((filterPeriodStart && !periodStartDate) || (filterPeriodEnd && !periodEndDate)) {
    return res.status(400).json({ message: 'Período inválido. Use datas no formato YYYY-MM-DD.' });
  }

  if (periodStartDate && periodEndDate && periodStartDate > periodEndDate) {
    return res.status(400).json({ message: 'Período inválido. A data inicial deve ser anterior à data final.' });
  }

  const dashboardFilters = {
    search: filterSearch,
    teamId: filterTeamId,
    role: filterRole,
    gender: filterGender,
    function: filterFunction,
    contractTypes: filterContractTypes,
    geography: filterGeography,
    level: filterLevel,
    isActive: filterIsActive,
    periodStart: filterPeriodStart,
    periodEnd: filterPeriodEnd,
  };

  const {
    periodScopedRows,
    selectedRows,
    teamOptions,
    levelOptions,
    geographyOptions,
    functionOptions,
    contractTypeOptions,
    genderOptions,
    selectedTeamName,
  } = filterDashboardCollaborators(collaboratorRows, dashboardFilters, periodStartDate, periodEndDate);

  const teamInsights = buildDashboardTeamInsights(
    periodScopedRows,
    selectedRows,
    dashboardFilters,
    {
      teamOptions,
      genderOptions,
      functionOptions,
      contractTypeOptions,
      geographyOptions,
      levelOptions,
      selectedTeamName,
    },
  );
  const teamCount = new Set(
    periodScopedRows
      .map((item) => item.team?.name?.trim())
      .filter((value): value is string => Boolean(value)),
  ).size;
  const pendingProfileRows = profileRequestsResult.status === 'fulfilled' ? profileRequestsResult.value : [];
  const pendingVacationRows = vacationsResult.status === 'fulfilled' ? vacationsResult.value : [];

  let pendingProfileRequests = 0;
  for (const row of pendingProfileRows) {
    if (row.userId === req.authUser!.id) {
      pendingProfileRequests += 1;
      continue;
    }

    if (!actorHasAccessTotal || !row.user.hasAccessTotal || req.authUser!.isRootAccess) {
      pendingProfileRequests += 1;
      continue;
    }

    const canReview = await canReviewAccessTotalHierarchy(req.authUser!.id, row.userId);
    if (canReview) {
      pendingProfileRequests += 1;
    }
  }

  let pendingVacationRequests = 0;
  for (const row of pendingVacationRows) {
    if (row.userId === req.authUser!.id) {
      pendingVacationRequests += 1;
      continue;
    }

    if (!actorHasAccessTotal || !row.user.hasAccessTotal || req.authUser!.isRootAccess) {
      pendingVacationRequests += 1;
      continue;
    }

    const canReview = await canReviewAccessTotalHierarchy(req.authUser!.id, row.userId);
    if (canReview) {
      pendingVacationRequests += 1;
    }
  }
  const assignedTrainings = trainingsResult.status === 'fulfilled' ? trainingsResult.value[0] : 0;
  const completedTrainings = trainingsResult.status === 'fulfilled' ? trainingsResult.value[1] : 0;
  const trainingHoursAvg = trainingsResult.status === 'fulfilled'
    ? average(trainingsResult.value[2].map((item) => Number(item.horas || 0)).filter((value) => value > 0))
    : 0;
  const historyRows = historyResult.status === 'fulfilled' ? historyResult.value : [];

  const {
    activeUsers,
    inactiveUsers,
    averages,
    charts,
    promotionEvents,
  } = buildDashboardSummaryAnalytics(periodScopedRows, historyRows);

  return res.json({
    refreshedAt: new Date().toISOString(),
    totals: {
      collaborators: periodScopedRows.length,
      activeUsers,
      inactiveUsers,
      teams: teamCount,
      pendingProfileRequests,
      pendingVacationRequests,
      trainingsAssigned: assignedTrainings,
      trainingsCompleted: completedTrainings,
      trainingHoursAvg,
      promotionEvents: promotionEvents.length,
    },
    averages,
    charts,
    recentPromotions: promotionEvents.slice(0, 8),
    teamInsights,
  });
});

router.get('/users/dashboard-collaborators', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para exportar colaboradores.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para exportar colaboradores.' });
  }

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const collaboratorWhere: Prisma.UserWhereInput = {
    role: { in: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'] },
    ...(scopeWhere ? { AND: [scopeWhere] } : {}),
  };

  const filterSearch = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const filterTeamId = typeof req.query.teamId === 'string' ? req.query.teamId.trim() : '';
  const filterRole = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
  const filterGender = typeof req.query.gender === 'string' ? req.query.gender.trim() : '';
  const filterFunction = typeof req.query.function === 'string' ? req.query.function.trim() : '';
  const filterContractTypes = parseMultiValueQuery(req.query.contractType);
  const filterGeography = typeof req.query.geography === 'string' ? req.query.geography.trim() : '';
  const filterLevel = typeof req.query.level === 'string' ? req.query.level.trim() : '';
  const filterIsActive = typeof req.query.isActive === 'string' ? req.query.isActive.trim().toLowerCase() : '';
  const filterPeriodStart = typeof req.query.periodStart === 'string' ? req.query.periodStart.trim() : '';
  const filterPeriodEnd = typeof req.query.periodEnd === 'string' ? req.query.periodEnd.trim() : '';

  const periodStartDate = filterPeriodStart ? parseIsoDate(filterPeriodStart) : null;
  const periodEndDate = filterPeriodEnd ? parseIsoDate(filterPeriodEnd) : null;

  if ((filterPeriodStart && !periodStartDate) || (filterPeriodEnd && !periodEndDate)) {
    return res.status(400).json({ message: 'Período inválido. Use datas no formato YYYY-MM-DD.' });
  }

  if (periodStartDate && periodEndDate && periodStartDate > periodEndDate) {
    return res.status(400).json({ message: 'Período inválido. A data inicial deve ser anterior à data final.' });
  }

  const collaboratorRows = await findDashboardCollaboratorsExportRows(collaboratorWhere);

  const dashboardFilters = {
    search: filterSearch,
    teamId: filterTeamId,
    role: filterRole,
    gender: filterGender,
    function: filterFunction,
    contractTypes: filterContractTypes,
    geography: filterGeography,
    level: filterLevel,
    isActive: filterIsActive,
    periodStart: filterPeriodStart,
    periodEnd: filterPeriodEnd,
  };

  const { selectedRows } = filterDashboardCollaborators(
    collaboratorRows,
    dashboardFilters,
    periodStartDate,
    periodEndDate,
  );

  const rows = mapDashboardCollaboratorsExportRows(selectedRows);

  return res.json({
    refreshedAt: new Date().toISOString(),
    total: rows.length,
    appliedFilters: {
      search: filterSearch,
      teamId: filterTeamId,
      role: filterRole,
      gender: filterGender,
      function: filterFunction,
      geography: filterGeography,
      level: filterLevel,
      isActive: filterIsActive,
      periodStart: filterPeriodStart,
      periodEnd: filterPeriodEnd,
    },
    rows,
  });
});

router.patch('/users/:id/active', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_user_active')) {
    return res.status(403).json({ message: 'Sem permissões para alterar estado de colaboradores.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateUserActiveSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  if (req.authUser!.id === userId && payload.data.isActive === false) {
    return res.status(400).json({ message: 'Não é permitido desativar a tua própria conta.' });
  }

  const existing = await findUserActiveState(userId);
  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (!req.authUser!.isRootAccess && !await isAccessTotal(req.authUser!.id)) {
    const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'manage_user_active', userId);
    if (!canManageTarget) {
      return res.status(403).json({ message: 'Sem permissões para alterar este colaborador com as restrições atuais.' });
    }
  }

  const updated = await updateUserActiveState(userId, payload.data.isActive);

  return res.json(updated);
});

router.get('/users/me/teams', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      teamId: true,
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        select: {
          teamId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const teamMap = new Map<string, {
    teamId: string;
    teamName: string;
    membershipRole: string;
    isApprover: boolean;
    approvalLevel: number | null;
    isPrimary: boolean;
  }>();

  for (const item of user.teamMemberships) {
    teamMap.set(item.teamId, {
      teamId: item.teamId,
      teamName: item.team.name,
      membershipRole: item.membershipRole,
      isApprover: item.isApprover,
      approvalLevel: item.approvalLevel,
      isPrimary: user.teamId === item.teamId,
    });
  }

  if (user.teamId && user.team) {
    const existing = teamMap.get(user.teamId);
    if (existing) {
      existing.isPrimary = true;
      teamMap.set(user.teamId, existing);
    } else {
      teamMap.set(user.teamId, {
        teamId: user.team.id,
        teamName: user.team.name,
        membershipRole: 'PARTICIPANT',
        isApprover: false,
        approvalLevel: null,
        isPrimary: true,
      });
    }
  }

  return res.json(Array.from(teamMap.values()).sort((a, b) => a.teamName.localeCompare(b.teamName, 'pt-PT')));
});

router.get('/teams', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_teams')) {
    return res.status(403).json({ message: 'Sem permissões para consultar equipas.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_teams');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar equipas.' });
  }

  const teams = await prisma.team.findMany({
    where: scope.isGlobal
      ? undefined
      : {
          ...(scope.restrictedToTeams && scope.restrictedToTeams.length > 0
            ? { id: { in: scope.restrictedToTeams } }
            : {}),
        },
    select: {
      id: true,
      name: true,
      managerId: true,
      coordinatorId: true,
      manager: { select: { id: true, username: true } },
      coordinator: { select: { id: true, username: true } },
      memberships: {
        where: { isActive: true },
        select: { userId: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(
    teams.map((team) => ({
      ...team,
      _count: {
        ...getTeamPeopleCount(team),
      },
    })),
  );
});

router.get('/teams/me', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;
  const actorHasAccessTotal = req.authUser!.isRootAccess || await isAccessTotal(userId);
  const detailsMode = typeof req.query.details === 'string' ? req.query.details.toLowerCase() : 'full';
  const includeMembers = detailsMode !== 'none';
  const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const teamScope = await resolveTeamScopeForUser(userId, req.authUser!.isRootAccess);

  const teamWhere: Prisma.TeamWhereInput | undefined = teamScope.isGlobal
    ? undefined
    : teamScope.teamIds.length > 0
      ? { id: { in: teamScope.teamIds } }
      : { id: '__no_team_scope__' };

  if (!includeMembers) {
    const teams = await prisma.team.findMany({
      where: teamWhere,
      select: {
        id: true,
        name: true,
        costCenter: true,
        color: true,
        managerId: true,
        coordinatorId: true,
        parentTeamId: true,
        manager: {
          select: {
            id: true,
            username: true,
            profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
          },
        },
        coordinator: {
          select: {
            id: true,
            username: true,
            profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
          },
        },
        parentTeam: { select: { id: true, name: true } },
        memberships: {
          where: { isActive: true },
          select: { userId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return res.json(teams.map((team) => ({
      ...team,
      costCenter: actorHasAccessTotal && !team.parentTeamId ? team.costCenter : null,
      _count: {
        ...getTeamPeopleCount(team),
      },
    })));
  }

  const teams = await prisma.team.findMany({
    where: teamWhere,
    select: {
      id: true,
      name: true,
      costCenter: true,
      color: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
        },
      },
      coordinator: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: {
          userId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              teamId: true,
              profile: {
                select: {
                  nomeAbreviado: true, nomeCompleto: true,
                  dataNascimento: true,
                  nacionalidade: true,
                  cargo: true,
                  categoriaProfissional: true,
                  funcao: true,
                },
              },
              vacations: {
                where: {
                  AND: [
                    { dataInicio: { lte: yearEnd } },
                    { dataFim: { gte: yearStart } },
                  ],
                },
                select: {
                  id: true,
                  dataInicio: true,
                  dataFim: true,
                  status: true,
                  requestType: true,
                  partialDay: true,
                  reviewReason: true,
                  attachmentLink: true,
                  contextTeamId: true,
                  versionNumber: true,
                  contextTeam: { select: { id: true, name: true } },
                },
                orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(teams.map((team) => ({
    ...team,
    costCenter: actorHasAccessTotal && !team.parentTeamId ? team.costCenter : null,
    members: team.memberships.map((membership) => ({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: membership.user.role,
      teamId: membership.user.teamId,
      profile: membership.user.profile,
      membershipRole: membership.membershipRole,
      isApprover: membership.isApprover,
      approvalLevel: membership.approvalLevel,
      vacations: membership.user.vacations,
    })),
    _count: {
      ...getTeamPeopleCount(team),
    },
  })));
});

router.get('/teams/me/:teamId', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;
  const actorHasAccessTotal = req.authUser!.isRootAccess || await isAccessTotal(userId);
  const teamId = String(req.params.teamId || '');
  const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const teamScope = await resolveTeamScopeForUser(userId, req.authUser!.isRootAccess);
  if (!teamScope.isGlobal && !teamScope.teamIds.includes(teamId)) {
    return res.status(403).json({ message: 'Sem permissões para consultar esta equipa.' });
  }

  const teamWhere: Prisma.TeamWhereInput = { id: teamId };

  const team = await prisma.team.findFirst({
    where: teamWhere,
    select: {
      id: true,
      name: true,
      costCenter: true,
      color: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
        },
      },
      coordinator: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: {
          userId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              teamId: true,
              profile: {
                select: {
                  nomeAbreviado: true, nomeCompleto: true,
                  dataNascimento: true,
                  nacionalidade: true,
                  cargo: true,
                  categoriaProfissional: true,
                  funcao: true,
                },
              },
              vacations: {
                where: {
                  AND: [
                    { dataInicio: { lte: yearEnd } },
                    { dataFim: { gte: yearStart } },
                  ],
                },
                select: {
                  id: true,
                  dataInicio: true,
                  dataFim: true,
                  status: true,
                  requestType: true,
                  partialDay: true,
                  reviewReason: true,
                  attachmentLink: true,
                  contextTeamId: true,
                  versionNumber: true,
                  contextTeam: { select: { id: true, name: true } },
                },
                orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
      },
    },
  });

  if (!team) {
    return res.status(404).json({ message: 'Equipa não encontrada.' });
  }

  return res.json({
    ...team,
    costCenter: actorHasAccessTotal && !team.parentTeamId ? team.costCenter : null,
    members: team.memberships.map((membership) => ({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: membership.user.role,
      teamId: membership.user.teamId,
      profile: membership.user.profile,
      membershipRole: membership.membershipRole,
      isApprover: membership.isApprover,
      approvalLevel: membership.approvalLevel,
      vacations: membership.user.vacations,
    })),
    _count: {
      ...getTeamPeopleCount(team),
    },
  });
});

router.patch('/manager/team-members/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_team_members')) {
    return res.status(403).json({ message: 'Sem permissões para gerir membros da equipa.' });
  }

  const targetUserId = String(req.params.id || '');
  const payload = managerTeamMemberUpdateSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const data = payload.data;

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      team: true,
      teamMemberships: {
        where: { isActive: true },
        include: { team: true },
      },
    },
  });

  if (!targetUser) {
    return res.status(404).json({ message: 'Colaborador não encontrado.' });
  }

  if (targetUser.role !== 'COLABORADOR') {
    return res.status(400).json({ message: 'Só é possível gerir utilizadores com role COLABORADOR.' });
  }

  const [scope, fullAccess] = await Promise.all([
    getPermissionScope(req.authUser!.id, 'manage_team_members'),
    isAccessTotal(req.authUser!.id),
  ]);

  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para gerir membros da equipa.' });
  }

  const canManageAllTeams = req.authUser!.isRootAccess || fullAccess || scope.isGlobal;
  const isManageableTeam = (teamId?: string | null) => {
    if (canManageAllTeams) {
      return true;
    }

    return !scope.restrictedToTeams || scope.restrictedToTeams.length === 0 || (Boolean(teamId) && scope.restrictedToTeams.includes(String(teamId)));
  };

  const currentTeamAllowed = await canAccessUserByPermission(req.authUser!.id, 'manage_team_members', targetUserId)
    || isManageableTeam(targetUser.teamId)
    || targetUser.teamMemberships.some((item) => isManageableTeam(item.teamId));
  if (!currentTeamAllowed) {
    return res.status(403).json({ message: 'Este colaborador está fora do teu escopo de gestão.' });
  }

  let nextTeamId: string | null | undefined = data.teamId;

  if (nextTeamId !== undefined && nextTeamId !== null) {
    const nextTeam = await prisma.team.findFirst({ where: { id: nextTeamId }, select: { id: true } });

    if (!nextTeam) {
      return res.status(404).json({ message: 'Equipa de destino não encontrada.' });
    }

    if (!isManageableTeam(nextTeam.id)) {
      return res.status(403).json({ message: 'Só podes mover para equipas geridas por ti.' });
    }
  }

  if (nextTeamId !== undefined) {
    if (nextTeamId === null) {
      await prisma.teamMembership.updateMany({
        where: { userId: targetUserId, isActive: true },
        data: { isActive: false },
      });
      await prisma.user.update({
        where: { id: targetUserId },
        data: { teamId: null },
      });
    } else {
      await prisma.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId: targetUserId,
            teamId: nextTeamId,
          },
        },
        update: {
          isActive: true,
        },
        create: {
          userId: targetUserId,
          teamId: nextTeamId,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        },
      });

      await prisma.user.update({
        where: { id: targetUserId },
        data: { teamId: nextTeamId },
      });
    }
  }

  if (data.cargo !== undefined || data.categoriaProfissional !== undefined || data.funcao !== undefined) {
    await prisma.profile.upsert({
      where: { userId: targetUserId },
      update: {
        ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
        ...(data.categoriaProfissional !== undefined ? { categoriaProfissional: data.categoriaProfissional } : {}),
        ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
        ...(data.nacionalidade !== undefined ? { nacionalidade: data.nacionalidade } : {}),
        ...(data.githubUser !== undefined ? { githubUser: data.githubUser } : {}),
        ...(data.validadeCartaoCidadao !== undefined ? { validadeCartaoCidadao: data.validadeCartaoCidadao } : {}),
      },
      create: {
        userId: targetUserId,
        ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
        ...(data.categoriaProfissional !== undefined ? { categoriaProfissional: data.categoriaProfissional } : {}),
        ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
        ...(data.nacionalidade !== undefined ? { nacionalidade: data.nacionalidade } : {}),
        ...(data.githubUser !== undefined ? { githubUser: data.githubUser } : {}),
        ...(data.validadeCartaoCidadao !== undefined ? { validadeCartaoCidadao: data.validadeCartaoCidadao } : {}),
      },
    });
  }

  return res.json({ success: true });
});

router.get('/admin/users', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;

  const users = await prisma.user.findMany({
    ...(scopeWhere ? { where: scopeWhere } : {}),
    include: {
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        include: {
          team: { select: { id: true, name: true } },
        },
      },
      profile: {
        select: {
          nomeAbreviado: true, nomeCompleto: true,
          workCountry: true,
          localidade: true,
        },
      },
    },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });

  return res.json(users.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isRootAccess: user.isRootAccess,
    isActive: user.isActive,
    profile: user.profile
      ? {
          nomeAbreviado: user.profile.nomeAbreviado,
          nomeCompleto: user.profile.nomeCompleto,
        }
      : null,
    teamId: user.teamId,
    teamName: user.team?.name ?? null,
    teams: user.teamMemberships.map((item) => ({
      teamId: item.teamId,
      teamName: item.team.name,
      membershipRole: item.membershipRole,
      isApprover: item.isApprover,
      approvalLevel: item.approvalLevel,
    })),
    workCountry: user.profile?.workCountry ?? 'PT',
    localidade: user.profile?.localidade ?? '',
  })));
});

router.get('/admin/teams', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_teams')) {
    return res.status(403).json({ message: 'Apenas admin pode gerir equipas.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_teams');
  const actorHasAccessTotal = req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id);
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para gerir equipas.' });
  }

  const teamWhere: Prisma.TeamWhereInput = {
    ...(scope.restrictedToTeams && scope.restrictedToTeams.length > 0
      ? { id: { in: scope.restrictedToTeams } }
      : {}),
  };

  const teams = await prisma.team.findMany({
    ...(scope.isGlobal ? {} : { where: teamWhere }),
    select: {
      id: true,
      name: true,
      costCenter: true,
      color: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: { userId: true },
      },
      _count: { select: { subTeams: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  return res.json(teams.map((team) => ({
    ...team,
    costCenter: actorHasAccessTotal && !team.parentTeamId ? team.costCenter : null,
    leaderId: team.managerId ?? null,
    leader: team.manager ?? null,
    _count: {
      ...getTeamPeopleCount(team),
      subTeams: team._count.subTeams,
    },
  })));
});

router.post('/admin/teams', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'create_team')) {
    return res.status(403).json({ message: 'Apenas admin pode criar equipas.' });
  }

  const payload = adminTeamSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const parentTeamId = payload.data.parentTeamId ?? null;
  const normalizedCostCenter = normalizeTeamCostCenter(payload.data.costCenter);
  if (parentTeamId && normalizedCostCenter) {
    return res.status(400).json({ message: 'Centro de custo só pode ser definido em equipas mãe.' });
  }

  const leaderId = payload.data.leaderId ?? null;
  const memberIds = Array.from(new Set(payload.data.memberIds ?? []));

  if (leaderId && memberIds.includes(leaderId)) {
    return res.status(400).json({ message: 'O chefe de equipa não pode ser membro participante da mesma equipa.' });
  }

  const usersToValidate = [
    ...(leaderId ? [leaderId] : []),
    ...memberIds,
  ];

  if (usersToValidate.length > 0) {
    const candidates = await prisma.user.findMany({
      where: { id: { in: usersToValidate } },
      select: { id: true, username: true, isActive: true },
    });

    const byId = new Map(candidates.map((item) => [item.id, item]));

    for (const userId of usersToValidate) {
      const user = byId.get(userId);
      if (!user) {
        return res.status(400).json({ message: 'Um dos utilizadores selecionados não existe.' });
      }
      if (!user.isActive) {
        return res.status(400).json({ message: `O utilizador ${user.username} está inativo e não pode ser associado à equipa.` });
      }
      if (user.username === 't.people') {
        return res.status(400).json({ message: 'A conta t.people não pode ser associada como chefe ou membro de equipa.' });
      }
    }
  }

  const team = await prisma.$transaction(async (tx) => {
    const createdTeam = await tx.team.create({
      data: {
        // A lógica atual usa um único chefe de equipa.
        // Mantemos managerId como campo persistido e limpamos coordinatorId.
        managerId: leaderId,
        coordinatorId: null,
        name: payload.data.name.trim(),
        parentTeamId,
        costCenter: parentTeamId ? null : normalizedCostCenter,
        color: payload.data.color ?? null,
      },
      select: {
        id: true,
        name: true,
        costCenter: true,
        color: true,
        managerId: true,
        coordinatorId: true,
        parentTeamId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (memberIds.length > 0) {
      await tx.teamMembership.createMany({
        data: memberIds.map((userId) => ({
          userId,
          teamId: createdTeam.id,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        })),
        skipDuplicates: true,
      });
    }

    return createdTeam;
  });

  if (leaderId) {
    await syncTeamLeaderPreset(leaderId, req.authUser!.id);
  }

  return res.status(201).json(team);
});

router.patch('/admin/teams/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'edit_team')) {
    return res.status(403).json({ message: 'Apenas admin pode editar equipas.' });
  }

  const teamId = String(req.params.id || '');
  const payload = adminTeamSchema.partial().safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.team.findUnique({ where: { id: teamId } });
  if (!existing) {
    return res.status(404).json({ message: 'Equipa não encontrada.' });
  }

  const nextParentTeamId = payload.data.parentTeamId !== undefined
    ? payload.data.parentTeamId
    : existing.parentTeamId;

  const nextCostCenter = payload.data.costCenter !== undefined
    ? normalizeTeamCostCenter(payload.data.costCenter)
    : existing.costCenter;

  if (nextParentTeamId && nextCostCenter) {
    return res.status(400).json({ message: 'Centro de custo só pode ser definido em equipas mãe.' });
  }

  const previousLeaderId = existing.managerId ?? null;
  const nextLeaderId = payload.data.leaderId !== undefined
    ? payload.data.leaderId
    : previousLeaderId;

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      ...(payload.data.name ? { name: payload.data.name.trim() } : {}),
      ...(
        payload.data.leaderId !== undefined
          ? { managerId: payload.data.leaderId, coordinatorId: null }
          : {}
      ),
      ...(payload.data.parentTeamId !== undefined ? { parentTeamId: payload.data.parentTeamId } : {}),
      ...(payload.data.costCenter !== undefined
        ? { costCenter: nextParentTeamId ? null : nextCostCenter }
        : {}),
      ...(payload.data.parentTeamId !== undefined && payload.data.parentTeamId !== null && payload.data.costCenter === undefined
        ? { costCenter: null }
        : {}),
      ...(payload.data.color !== undefined ? { color: payload.data.color } : {}),
    },
    select: {
      id: true,
      name: true,
      costCenter: true,
      color: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (previousLeaderId && previousLeaderId !== nextLeaderId) {
    await syncTeamLeaderPreset(previousLeaderId, req.authUser!.id);
  }
  if (nextLeaderId) {
    await syncTeamLeaderPreset(nextLeaderId, req.authUser!.id);
  }

  return res.json(updated);
});

router.delete('/admin/teams/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'delete_team')) {
    return res.status(403).json({ message: 'Apenas admin pode remover equipas.' });
  }

  const teamId = String(req.params.id || '');

  const { previousLeaderId } = await deleteTeamById(teamId);
  if (previousLeaderId) {
    await syncTeamLeaderPreset(previousLeaderId, req.authUser!.id);
  }

  return res.json({ success: true });
});

router.patch('/admin/users/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'edit_user')) {
    return res.status(403).json({ message: 'Apenas admin pode gerir perfis.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminUserSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const data = payload.data;
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isRootAccess: true,
      hasAccessTotal: true,
      profile: { select: { workCountry: true } },
    },
  });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (existing.isRootAccess && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para editar este utilizador.' });
  }

  if (!req.authUser!.isRootAccess) {
    const actorHasAccessTotal = await isAccessTotal(req.authUser!.id);

    if (actorHasAccessTotal) {
      if (existing.hasAccessTotal) {
        const canManageByHierarchy = await canReviewAccessTotalHierarchy(req.authUser!.id, userId);
        if (!canManageByHierarchy) {
          return res.status(403).json({ message: 'Sem permissões para editar este utilizador acima de ti na hierarquia de acesso total.' });
        }
      }
    } else {
      const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'edit_user', userId);
      if (!canManageTarget) {
        return res.status(403).json({ message: 'Sem permissões para editar este utilizador com as restrições atuais.' });
      }
    }
  }

  if (data.role === 'ADMIN') {
    data.teamId = null;
  }

  if (req.authUser!.id === userId && data.isActive === false) {
    return res.status(400).json({ message: 'Não é permitido desativar a tua própria conta.' });
  }

  const normalizedBrWorkState = data.workCountry === 'PT'
    ? null
    : (data.brWorkState ?? undefined);

  let derivedHourBankLimitHours: number | undefined;
  try {
    if (data.regimeHorario && data.regimeHorario.startsWith(DYNAMIC_REGIME_PREFIX)) {
      derivedHourBankLimitHours = calculateWeeklyHoursFromDynamicRegime(data.regimeHorario) ?? undefined;
    } else if (data.horasSemanaisContrato !== undefined) {
      const raw = String(data.horasSemanaisContrato ?? '').trim();
      if (raw) {
        derivedHourBankLimitHours = parseWeeklyHoursContract(raw);
      }
    }
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Configuração de horas de trabalho inválida.',
    });
  }

  const profilePayload = {
    ...(data.nomeCompleto !== undefined ? { nomeCompleto: data.nomeCompleto } : {}),
    ...(data.nomeAbreviado !== undefined ? { nomeAbreviado: data.nomeAbreviado } : {}),
    ...(data.dataNascimento !== undefined ? { dataNascimento: data.dataNascimento } : {}),
    ...(data.genero !== undefined ? { genero: data.genero } : {}),
    ...(data.estadoCivil !== undefined ? { estadoCivil: data.estadoCivil } : {}),
    ...(data.habilitacoesLiterarias !== undefined ? { habilitacoesLiterarias: data.habilitacoesLiterarias } : {}),
    ...(data.curso !== undefined ? { curso: data.curso } : {}),
    ...(data.faculdade !== undefined ? { faculdade: data.faculdade } : {}),
    ...(data.emailPessoal !== undefined ? { emailPessoal: data.emailPessoal } : {}),
    ...(data.telemovel !== undefined ? { telemovel: data.telemovel } : {}),
    ...(data.moradaFiscal !== undefined ? { moradaFiscal: data.moradaFiscal } : {}),
    ...(data.endereco !== undefined ? { endereco: data.endereco } : {}),
    ...(data.localidade !== undefined ? { localidade: data.localidade } : {}),
    ...(data.codigoPostal !== undefined ? { codigoPostal: data.codigoPostal } : {}),
    ...(data.matriculaCarro !== undefined ? { matriculaCarro: data.matriculaCarro } : {}),
    ...(data.localNascimentoPais !== undefined ? { localNascimentoPais: data.localNascimentoPais } : {}),
    ...(data.localNascimentoCidade !== undefined ? { localNascimentoCidade: data.localNascimentoCidade } : {}),
    ...(data.nomePai !== undefined ? { nomePai: data.nomePai } : {}),
    ...(data.nomeMae !== undefined ? { nomeMae: data.nomeMae } : {}),
    ...(data.cartaoCidadao !== undefined ? { cartaoCidadao: data.cartaoCidadao } : {}),
    ...(data.nif !== undefined ? { nif: data.nif } : {}),
    ...(data.cpf !== undefined ? { cpf: data.cpf } : {}),
    ...(data.pis !== undefined ? { pis: data.pis } : {}),
    ...(data.ctps !== undefined ? { ctps: data.ctps } : {}),
    ...(data.ctpsSerie !== undefined ? { ctpsSerie: data.ctpsSerie } : {}),
    ...(data.ctpsDataExpedicao !== undefined ? { ctpsDataExpedicao: data.ctpsDataExpedicao } : {}),
    ...(data.rg !== undefined ? { rg: data.rg } : {}),
    ...(data.rgOrgaoEmissor !== undefined ? { rgOrgaoEmissor: data.rgOrgaoEmissor } : {}),
    ...(data.rgDataExpedicao !== undefined ? { rgDataExpedicao: data.rgDataExpedicao } : {}),
    ...(data.cnh !== undefined ? { cnh: data.cnh } : {}),
    ...(data.cnhCategoria !== undefined ? { cnhCategoria: data.cnhCategoria } : {}),
    ...(data.cnhDataValidade !== undefined ? { cnhDataValidade: data.cnhDataValidade } : {}),
    ...(data.tituloEleitor !== undefined ? { tituloEleitor: data.tituloEleitor } : {}),
    ...(data.zonaEleitoral !== undefined ? { zonaEleitoral: data.zonaEleitoral } : {}),
    ...(data.secaoEleitoral !== undefined ? { secaoEleitoral: data.secaoEleitoral } : {}),
    ...(data.certificadoReservista !== undefined ? { certificadoReservista: data.certificadoReservista } : {}),
    ...(data.niss !== undefined ? { niss: data.niss } : {}),
    ...(data.iban !== undefined ? { iban: data.iban } : {}),
    ...(data.situacaoIrs !== undefined ? { situacaoIrs: data.situacaoIrs } : {}),
    ...(data.numeroDependentes !== undefined ? { numeroDependentes: data.numeroDependentes } : {}),
    ...(data.declaracaoIrs !== undefined ? { declaracaoIrs: data.declaracaoIrs } : {}),
    ...(data.irsJovem !== undefined ? { irsJovem: data.irsJovem } : {}),
    ...(data.anoPrimeiroDesconto !== undefined ? { anoPrimeiroDesconto: data.anoPrimeiroDesconto } : {}),
    ...(data.primeiroEmprego !== undefined ? { primeiroEmprego: data.primeiroEmprego } : {}),
    ...(data.recebeAposentadoria !== undefined ? { recebeAposentadoria: data.recebeAposentadoria } : {}),
    ...(data.recebeSeguroDesemprego !== undefined ? { recebeSeguroDesemprego: data.recebeSeguroDesemprego } : {}),
    ...(data.valeTransporte !== undefined ? { valeTransporte: data.valeTransporte } : {}),
    ...(data.numeroCartaoContinente !== undefined ? { numeroCartaoContinente: data.numeroCartaoContinente } : {}),
    ...(data.voucherNosData !== undefined ? { voucherNosData: data.voucherNosData } : {}),
    ...(data.comprovativoMoradaFiscal !== undefined ? { comprovativoMoradaFiscal: data.comprovativoMoradaFiscal } : {}),
    ...(data.comprovativoCartaoCidadao !== undefined ? { comprovativoCartaoCidadao: data.comprovativoCartaoCidadao } : {}),
    ...(data.comprovativoIban !== undefined ? { comprovativoIban: data.comprovativoIban } : {}),
    ...(data.comprovativoCartaoContinente !== undefined ? { comprovativoCartaoContinente: data.comprovativoCartaoContinente } : {}),
    ...(data.criminalRecordUrl !== undefined ? { criminalRecordUrl: data.criminalRecordUrl } : {}),
    ...(data.contactoEmergenciaNome !== undefined ? { contactoEmergenciaNome: data.contactoEmergenciaNome } : {}),
    ...(data.contactoEmergenciaParentesco !== undefined ? { contactoEmergenciaParentesco: data.contactoEmergenciaParentesco } : {}),
    ...(data.contactoEmergenciaNumero !== undefined ? { contactoEmergenciaNumero: data.contactoEmergenciaNumero } : {}),
    ...(data.nacionalidade !== undefined ? { nacionalidade: data.nacionalidade } : {}),
    ...(data.githubUser !== undefined ? { githubUser: data.githubUser } : {}),
    ...(data.validadeCartaoCidadao !== undefined ? { validadeCartaoCidadao: data.validadeCartaoCidadao } : {}),
    ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
    ...(data.categoriaProfissional !== undefined ? { categoriaProfissional: data.categoriaProfissional } : {}),
    ...(data.numeroMecanografico !== undefined ? { numeroMecanografico: data.numeroMecanografico } : {}),
    ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
    ...(data.dataInicioContrato !== undefined ? { dataInicioContrato: data.dataInicioContrato } : {}),
    ...(data.dataFimContrato !== undefined ? { dataFimContrato: data.dataFimContrato } : {}),
    ...(data.tipoContrato !== undefined ? { tipoContrato: data.tipoContrato } : {}),
    ...(data.regimeHorario !== undefined ? { regimeHorario: data.regimeHorario } : {}),
    ...(derivedHourBankLimitHours !== undefined ? { hourBankLimitHours: derivedHourBankLimitHours } : {}),
    ...(data.workCountry !== undefined ? { workCountry: data.workCountry } : {}),
    ...(data.workCountry !== undefined || data.brWorkState !== undefined ? { brWorkState: normalizedBrWorkState } : {}),
  };

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.role ? { role: data.role } : {}),
      ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
      ...(data.isActive !== undefined
        ? { isActive: data.isActive, deactivatedAt: data.isActive ? null : new Date() }
        : {}),
    },
  });

  if (data.teamId !== undefined) {
    if (data.teamId === null) {
      await prisma.teamMembership.updateMany({
        where: { userId },
        data: { isActive: false },
      });
    } else {
      await prisma.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: data.teamId,
          },
        },
        update: { isActive: true },
        create: {
          userId,
          teamId: data.teamId,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        },
      });
    }
  }

  if (Object.keys(profilePayload).length > 0 || data.localidade !== undefined) {
    const existingProfileForHistory = await prisma.profile.findUnique({
      where: { userId },
      select: { cargo: true },
    });

    const shouldUpdateWorkCountry = Object.prototype.hasOwnProperty.call(profilePayload, 'workCountry');
    const shouldUpdateBrWorkState = Object.prototype.hasOwnProperty.call(profilePayload, 'brWorkState');

    const previousCargo = (existingProfileForHistory?.cargo ?? '').trim();
    const nextCargo = data.cargo === undefined ? previousCargo : (data.cargo ?? '').trim();

    await prisma.profile.upsert({
      where: { userId },
      update: {
        ...profilePayload,
        ...(data.localidade !== undefined ? { localidade: data.localidade } : {}),
        ...(shouldUpdateWorkCountry ? { workCountry: profilePayload.workCountry as any } : {}),
        ...(shouldUpdateBrWorkState ? { brWorkState: profilePayload.brWorkState as any } : {}),
      },
      create: {
        userId,
        ...profilePayload,
        workCountry: (data.workCountry as any) ?? 'PT',
        brWorkState: (data.brWorkState as any) || null,
        localidade: data.localidade ?? '',
      },
    });

    if (data.cargo !== undefined && previousCargo !== nextCargo) {
      const actorName = req.authUser?.username || 'sistema';
      await prisma.profileChangeRequest.create({
        data: {
          userId,
          status: 'APPROVED',
          changesSummary: `Cargo atualizado de "${previousCargo || 'sem cargo'}" para "${nextCargo || 'sem cargo'}" via gestão RH (${actorName}).`,
          requestedData: {
            cargo: nextCargo,
            previousCargo,
            source: 'ADMIN_DIRECT_UPDATE',
          },
          approvedFields: {
            cargo: nextCargo,
          },
          rejectedFields: {},
          reviewReason: 'Alteração direta aprovada pela gestão de colaboradores.',
          reviewedById: req.authUser?.id,
          reviewedAt: new Date(),
        },
      });
    }
  }

  // ── Country change side-effects ────────────────────────────────────────────
  const previousCountry = existing.profile?.workCountry ?? 'PT';
  const newCountry = data.workCountry;
  let cancelledVacations = 0;
  let removedCountrySpecificFields = 0;

  if (newCountry && newCountry !== previousCountry) {
    // Cancel all PENDING vacation requests - they were submitted under old country rules
    const pendingVacations = await prisma.vacation.findMany({
      where: { userId, status: 'PENDING' },
      select: { id: true, requestType: true, dataInicio: true, dataFim: true },
    });

    cancelledVacations = pendingVacations.length;

    if (pendingVacations.length > 0) {
      await prisma.vacation.updateMany({
        where: { userId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          observacoes: `Cancelado automaticamente: mudança de país de trabalho de ${previousCountry} para ${newCountry}.`,
        },
      });
    }

    const countryLabel = (c: string) => (c === 'BR' ? 'Brasil' : 'Portugal');

    // Clear fields that are exclusive to the previous country
    const PT_ONLY_FIELDS = {
      cartaoCidadao: '',
      validadeCartaoCidadao: '',
      nif: '',
      niss: '',
      iban: '',
      situacaoIrs: '',
      numeroDependentes: '',
      irsJovem: '',
      anoPrimeiroDesconto: '',
      matriculaCarro: '',
      numeroCartaoContinente: '',
      voucherNosData: '',
      comprovativoMoradaFiscal: '',
      comprovativoCartaoCidadao: '',
      comprovativoIban: '',
      comprovativoCartaoContinente: '',
      criminalRecordUrl: '',
    };

    const BR_ONLY_FIELDS = {
      brWorkState: null,
      cpf: '',
      pis: '',
      ctps: '',
      ctpsSerie: '',
      ctpsDataExpedicao: '',
      rg: '',
      rgOrgaoEmissor: '',
      rgDataExpedicao: '',
      cnh: '',
      cnhCategoria: '',
      cnhDataValidade: '',
      tituloEleitor: '',
      zonaEleitoral: '',
      secaoEleitoral: '',
      certificadoReservista: '',
      localNascimentoPais: '',
      localNascimentoCidade: '',
      nomePai: '',
      nomeMae: '',
      primeiroEmprego: false,
      recebeAposentadoria: false,
      recebeSeguroDesemprego: false,
      valeTransporte: false,
    };

    const PT_ONLY_DEFAULTS_ON_SWITCH = {
      cartaoCidadao: '',
      validadeCartaoCidadao: '',
      nif: '',
      niss: '',
      iban: '',
      situacaoIrs: '',
      numeroDependentes: '',
      irsJovem: '',
      anoPrimeiroDesconto: '',
      matriculaCarro: '',
      numeroCartaoContinente: '',
      voucherNosData: '',
      comprovativoMoradaFiscal: '',
      comprovativoCartaoCidadao: '',
      comprovativoIban: '',
      comprovativoCartaoContinente: '',
      criminalRecordUrl: '',
    };

    const BR_ONLY_DEFAULTS_ON_SWITCH = {
      cpf: '',
      pis: '',
      ctps: '',
      ctpsSerie: '',
      ctpsDataExpedicao: '',
      rg: '',
      rgOrgaoEmissor: '',
      rgDataExpedicao: '',
      cnh: '',
      cnhCategoria: '',
      cnhDataValidade: '',
      tituloEleitor: '',
      zonaEleitoral: '',
      secaoEleitoral: '',
      certificadoReservista: '',
      localNascimentoPais: '',
      localNascimentoCidade: '',
      nomePai: '',
      nomeMae: '',
      primeiroEmprego: false,
      recebeAposentadoria: false,
      recebeSeguroDesemprego: false,
      valeTransporte: false,
    };

    // Clear the fields belonging to the OLD country (they no longer apply)
    const fieldsToClean = previousCountry === 'PT' ? PT_ONLY_FIELDS : BR_ONLY_FIELDS;
    const fieldsToInitialize = newCountry === 'PT' ? PT_ONLY_DEFAULTS_ON_SWITCH : BR_ONLY_DEFAULTS_ON_SWITCH;

    // Clear codigoPostal when moving to BR - CEP format is different, avoid stale PT postal code
    const extraClean = newCountry === 'BR' ? { codigoPostal: '' } : {};

    removedCountrySpecificFields = Object.keys({ ...fieldsToClean, ...extraClean }).length;

    const countryTransitionProfileData: Prisma.ProfileUpdateInput = {
      ...fieldsToClean,
      ...fieldsToInitialize,
      ...extraClean,
    };

    await prisma.profile.update({
      where: { userId },
      data: countryTransitionProfileData,
    });

    // Deactivate all team memberships - teams are country-scoped
    await prisma.teamMembership.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { teamId: null },
    });

    await prisma.notification.create({
      data: {
        userId,
        title: `País de trabalho alterado para ${countryLabel(newCountry)}`,
        message: [
          `O teu país de trabalho foi alterado de ${countryLabel(previousCountry)} para ${countryLabel(newCountry)}.`,
          cancelledVacations > 0
            ? `${cancelledVacations} pedido(s) de férias/ausências pendente(s) foram cancelados (regras diferentes entre países).`
            : '',
          `Os dados exclusivos de ${countryLabel(previousCountry)} foram removidos da tua ficha.`,
          `A tua equipa foi removida - o administrador irá reatribuir-te à equipa correta em ${countryLabel(newCountry)}.`,
          `Ação: completa os dados obrigatórios para ${countryLabel(newCountry)} na tua ficha.`,
        ].filter(Boolean).join('\n'),
      },
    });
  }

  return res.json({
    id: updatedUser.id,
    role: updatedUser.role,
    teamId: updatedUser.teamId,
    isActive: updatedUser.isActive,
    cancelledVacations,
    removedCountrySpecificFields,
    countryChanged: newCountry !== undefined && newCountry !== previousCountry,
  });
});

router.delete('/admin/users/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'edit_user')) {
    return res.status(403).json({ message: 'Apenas admin pode apagar utilizadores.' });
  }

  const userId = String(req.params.id || '');
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true },
  });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (req.authUser!.id === userId) {
    return res.status(400).json({ message: 'Não é permitido apagar a tua própria conta.' });
  }

  if (existing.isRootAccess && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para apagar este utilizador.' });
  }

  if (!req.authUser!.isRootAccess && !await isAccessTotal(req.authUser!.id)) {
    const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'edit_user', userId);
    if (!canManageTarget) {
      return res.status(403).json({ message: 'Sem permissões para apagar este utilizador com as restrições atuais.' });
    }
  }

  await deleteUserById(userId);

  return res.json({ success: true });
});

router.patch('/admin/users/:id/credentials', requireAuth, async (req, res) => {
  if (req.authUser?.username !== 't.people') {
    return res.status(403).json({ message: 'Apenas t.people pode editar credenciais de utilizadores.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminUserCredentialsSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true },
  });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const nextUsername = payload.data.username?.trim().toLowerCase();
  const nextEmail = payload.data.email?.trim().toLowerCase();

  if (nextUsername || nextEmail) {
    const duplicate = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        OR: [
          ...(nextUsername ? [{ username: nextUsername }] : []),
          ...(nextEmail ? [{ email: nextEmail }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicate) {
      return res.status(409).json({ message: 'Username ou email já está em uso por outro utilizador.' });
    }
  }

  const data: {
    username?: string;
    email?: string;
  } = {};

  if (nextUsername) {
    data.username = nextUsername;
  }
  if (nextEmail) {
    data.email = nextEmail;
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      updatedAt: true,
    },
  });

  return res.json(updated);
});

router.patch('/admin/users/:id/memberships', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_team_members')) {
    return res.status(403).json({ message: 'Apenas admin pode gerir memberships.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminMembershipsSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const memberships = payload.data.memberships;

  await prisma.$transaction(async (tx) => {
    await tx.teamMembership.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    for (const item of memberships) {
      await tx.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: item.teamId,
          },
        },
        update: {
          isActive: item.isActive ?? true,
          membershipRole: item.membershipRole ?? 'PARTICIPANT',
          isApprover: item.isApprover ?? false,
          approvalLevel: item.approvalLevel ?? null,
        },
        create: {
          userId,
          teamId: item.teamId,
          isActive: item.isActive ?? true,
          membershipRole: item.membershipRole ?? 'PARTICIPANT',
          isApprover: item.isApprover ?? false,
          approvalLevel: item.approvalLevel ?? null,
        },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        teamId: memberships[0]?.teamId ?? null,
      },
    });
  });

  return res.json({ success: true });
});

router.post('/users/admissions', requireAuth, async (req, res, next) => {
  try {
    const actorHasAccess = req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id);
    if (!actorHasAccess) {
      return res.status(403).json({ message: 'Sem permissões para iniciar admissões.' });
    }

    const data = employeeAdmissionCreateSchema.parse(req.body);
    const invitation = await createAdmissionInvitation({
      actorUserId: req.authUser!.id,
      fullName: data.fullName,
      personalEmail: data.personalEmail,
      workCountry: data.workCountry,
      brWorkState: data.brWorkState,
    });

    if (invitation.conflict) {
      return res.status(409).json({ message: 'Já existe um processo de admissão ativo para este email pessoal.' });
    }

    await sendAdmissionInviteEmail({
      personalEmail: invitation.personalEmail,
      fullName: invitation.admission.fullName,
      invitationLink: invitation.invitationLink,
    });

    return res.status(201).json({
      ...invitation.admission,
      invitationLinkPreview: process.env.NODE_ENV === 'production' ? undefined : invitation.invitationLink,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users/admissions/public/:token', async (req, res) => {
  try {
    const admission = await resolveAdmissionByTokenOrThrow(String(req.params.token));
    const formSettings = await getAdmissionFormSettings();
    const requiredFields = resolveAdmissionRequiredFieldsByCountry(formSettings, admission.workCountry);

    return res.json({
      id: admission.id,
      fullName: admission.fullName,
      personalEmail: admission.personalEmail,
      workCountry: admission.workCountry,
      brWorkState: admission.brWorkState,
      status: admission.status,
      reviewReason: admission.reviewReason,
      tokenExpiresAt: admission.tokenExpiresAt,
      personalData: admission.personalData,
      formSettings: { requiredFields },
    });
  } catch (error) {
    return res.status(404).json({ message: error instanceof Error ? error.message : 'Convite não encontrado.' });
  }
});

router.get('/users/admissions/settings', requireAuth, async (req, res) => {
  const canManage = await canManageAdmissionFormSettings(req.authUser!);
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para consultar configurações da ficha de admissão.' });
  }

  const settings = await getAdmissionFormSettings();
  return res.json({
    requiredFieldsByCountry: {
      PT: settings.byCountry.PT.requiredFields,
      BR: settings.byCountry.BR.requiredFields,
    },
    availableFieldsByCountry: getAdmissionRequiredFieldOptions(),
  });
});

router.put('/users/admissions/settings', requireAuth, async (req, res) => {
  const canManage = await canManageAdmissionFormSettings(req.authUser!);
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para editar configurações da ficha de admissão.' });
  }

  const payload = admissionFormSettingsSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const previousSettings = await getAdmissionFormSettings();
  const targetCountry = payload.data.country;
  const normalizedCountryFields = Array.from(new Set(payload.data.requiredFields));

  if (normalizedCountryFields.length === 0) {
    return res.status(400).json({ message: 'Define pelo menos um campo obrigatório.' });
  }

  const normalized = {
    byCountry: {
      PT: {
        requiredFields: targetCountry === 'PT'
          ? normalizedCountryFields
          : previousSettings.byCountry.PT.requiredFields,
      },
      BR: {
        requiredFields: targetCountry === 'BR'
          ? normalizedCountryFields
          : previousSettings.byCountry.BR.requiredFields,
      },
    },
  };

  const safeNormalized = normalizeAdmissionFormSettings(normalized);

  await prisma.systemSetting.upsert({
    where: { key: ADMISSION_FORM_SETTINGS_KEY },
    update: { textValue: JSON.stringify(safeNormalized), boolValue: null },
    create: { key: ADMISSION_FORM_SETTINGS_KEY, textValue: JSON.stringify(safeNormalized), boolValue: null },
  });

  return res.json({
    requiredFieldsByCountry: {
      PT: safeNormalized.byCountry.PT.requiredFields,
      BR: safeNormalized.byCountry.BR.requiredFields,
    },
    availableFieldsByCountry: getAdmissionRequiredFieldOptions(),
  });
});

router.post('/users/admissions/public/:token/submit', async (req, res, next) => {
  try {
    const admission = await resolveAdmissionByTokenOrThrow(String(req.params.token));
    if (admission.status === 'APPROVED_PENDING_CONTRACT') {
      return res.status(409).json({ message: 'Este pedido já foi aprovado e está a aguardar conclusão contratual.' });
    }

    const normalized = normalizeEmployeeAdmissionPersonalData(req.body, {
      fullName: admission.fullName,
      personalEmail: admission.personalEmail,
      workCountry: admission.workCountry,
      brWorkState: admission.brWorkState,
    });
    const formSettings = await getAdmissionFormSettings();
    const validationErrors = validateEmployeeAdmissionPersonalDataWithSettings(
      normalized,
      admission.workCountry,
      formSettings,
    );
    if (validationErrors.length > 0) {
      return res.status(400).json({ message: validationErrors[0] });
    }

    await submitAdmissionPublicForm({
      admissionId: admission.id,
      fullName: admission.fullName,
      personalEmail: admission.personalEmail,
      workCountry: admission.workCountry,
      brWorkState: admission.brWorkState,
      normalizedPersonalData: normalized as Record<string, unknown>,
    });

    return res.json({ success: true, message: 'Ficha submetida para revisão RH.' });
  } catch (error) {
    if (error instanceof Error && /Convite|expirou|disponível/.test(error.message)) {
      return res.status(404).json({ message: error.message });
    }
    return next(error);
  }
});

router.get('/users/admissions/review', requireAuth, async (req, res) => {
  const canReview = await canUserReviewAdmissions(req.authUser!);
  if (!canReview) {
    return res.status(403).json({ message: 'Sem permissões para consultar admissões.' });
  }

  const actorWorkCountry = await findActorWorkCountry(req.authUser!.id);
  const rows = await listAdmissionsForReview({
    isRootAccess: req.authUser!.isRootAccess,
    actorWorkCountry,
  });

  return res.json(rows);
});

router.post('/users/admissions/:id/request-correction', requireAuth, async (req, res, next) => {
  try {
    const canReview = await canUserReviewAdmissions(req.authUser!);
    if (!canReview) {
      return res.status(403).json({ message: 'Sem permissões para devolver admissões.' });
    }

    const payload = employeeAdmissionCorrectionSchema.parse(req.body);
    const admission = await findAdmissionById(String(req.params.id));
    if (!admission) {
      return res.status(404).json({ message: 'Pedido de admissão não encontrado.' });
    }

    const canReviewCountry = await canUserReviewAdmissionCountry(req.authUser!, admission.workCountry as 'PT' | 'BR');
    if (!canReviewCountry) {
      return res.status(403).json({ message: 'Sem permissões para devolver admissões deste país.' });
    }

    await requestAdmissionCorrection({
      admissionId: admission.id,
      reviewerId: req.authUser!.id,
      fullName: admission.fullName,
      personalEmail: admission.personalEmail,
      reason: payload.reason,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/users/admissions/:id/approve-personal', requireAuth, async (req, res, next) => {
  try {
    const canReview = await canUserReviewAdmissions(req.authUser!);
    if (!canReview) {
      return res.status(403).json({ message: 'Sem permissões para aprovar admissões.' });
    }

    const admission = await findAdmissionById(String(req.params.id));
    if (!admission) {
      return res.status(404).json({ message: 'Pedido de admissão não encontrado.' });
    }

    const canReviewCountry = await canUserReviewAdmissionCountry(req.authUser!, admission.workCountry as 'PT' | 'BR');
    if (!canReviewCountry) {
      return res.status(403).json({ message: 'Sem permissões para aprovar admissões deste país.' });
    }

    if (admission.status !== 'SUBMITTED') {
      return res.status(409).json({ message: 'Este pedido não está pronto para aprovação dos dados pessoais.' });
    }

    await approveAdmissionPersonalData({
      admissionId: admission.id,
      reviewerId: req.authUser!.id,
      fullName: admission.fullName,
    });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/users/admissions/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const canReview = await canUserReviewAdmissions(req.authUser!);
    if (!canReview) {
      return res.status(403).json({ message: 'Sem permissões para concluir admissões.' });
    }

    const admission = await findAdmissionById(String(req.params.id));
    if (!admission) {
      return res.status(404).json({ message: 'Pedido de admissão não encontrado.' });
    }

    const canReviewCountry = await canUserReviewAdmissionCountry(req.authUser!, admission.workCountry as 'PT' | 'BR');
    if (!canReviewCountry) {
      return res.status(403).json({ message: 'Sem permissões para concluir admissões deste país.' });
    }

    if (admission.status !== 'APPROVED_PENDING_CONTRACT') {
      return res.status(409).json({ message: 'Os dados pessoais ainda não foram aprovados para este pedido.' });
    }

    const contract = employeeAdmissionContractSchema.parse(req.body);
    const derivedHourBankLimitHours = deriveAdmissionHourBankLimitHours(contract);
    const createdUser = await completeAdmissionAndCreateUser({
      actorUserId: req.authUser!.id,
      admission: {
        id: admission.id,
        fullName: admission.fullName,
        personalEmail: admission.personalEmail,
        workCountry: admission.workCountry,
        brWorkState: admission.brWorkState,
        personalData: admission.personalData,
      },
      contract,
      derivedHourBankLimitHours,
      createManagedUser,
    });

    return res.status(201).json(createdUser);
  } catch (error) {
    return next(error);
  }
});

// ── LIST ALL ADMISSIONS (for RH / admin review page) ──────────────────────────
router.get('/users/admissions/list', requireAuth, async (req, res) => {
  const canView = await canUserReviewAdmissions(req.authUser!);
  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para consultar admissões.' });
  }

  const actorWorkCountry = await findActorWorkCountry(req.authUser!.id);

  const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
  const statusValidation = rawStatus ? employeeAdmissionStatusSchema.safeParse(rawStatus) : null;
  if (statusValidation && !statusValidation.success) {
    return res.status(400).json({ message: 'Parâmetro status inválido.' });
  }

  const status = statusValidation?.success ? statusValidation.data as EmployeeAdmissionStatus : undefined;

  const pageRaw = typeof req.query.page === 'string' ? req.query.page.trim() : '1';
  const pageSizeRaw = typeof req.query.pageSize === 'string' ? req.query.pageSize.trim() : '50';
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(pageSizeRaw)) {
    return res.status(400).json({ message: 'Parâmetros de paginação inválidos.' });
  }

  const page = Math.max(1, Number(pageRaw));
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw)));

  const { total, rows } = await listAdmissionsWithPagination({
    isRootAccess: req.authUser!.isRootAccess,
    actorWorkCountry,
    status,
    page,
    pageSize,
  });

  return res.json({ total, page, pageSize, rows });
});

// ── GET SINGLE ADMISSION DETAIL ──────────────────────────────────────────────
router.get('/users/admissions/:id', requireAuth, async (req, res) => {
  const canView = await canUserReviewAdmissions(req.authUser!);
  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para consultar admissões.' });
  }

  const admission = await findAdmissionDetailById(String(req.params.id));

  if (!admission) {
    return res.status(404).json({ message: 'Admissão não encontrada.' });
  }

  const actorWorkCountry = await findActorWorkCountry(req.authUser!.id);
  if (!req.authUser!.isRootAccess && admission.workCountry !== actorWorkCountry) {
    return res.status(403).json({ message: 'Sem permissões para consultar esta admissão.' });
  }

  return res.json(admission);
});

router.post('/users', requireAuth, async (req, res, next) => {
  try {
    if (!await hasPermission(req.authUser!.id, 'create_user')) {
      return res.status(403).json({ message: 'Sem permissões para criar utilizadores.' });
    }

    const data = createUserSchema.parse(req.body);
    const safeUser = await createManagedUser({
      actorUserId: req.authUser!.id,
      username: data.username,
      email: data.email,
      fullName: data.fullName,
      role: data.role ?? 'COLABORADOR',
      teamId: data.teamId,
      workCountry: data.workCountry ?? 'PT',
    });

    return res.status(201).json(safeUser);
  } catch (error) {
    return next(error);
  }
});

router.post('/users/import', requireAuth, async (req, res, next) => {
  try {
    const actorHasBulkAccess = req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id);
    if (!actorHasBulkAccess) {
      return res.status(403).json({ message: 'A importação em massa está disponível apenas para quem tem acesso total.' });
    }

    const payload = bulkImportUsersSchema.parse(req.body);
    const allTeams = await prisma.team.findMany({
      select: { id: true, name: true, parentTeamId: true },
    });

    const teamsByName = new Map(allTeams.map((team) => [team.name.trim().toLowerCase(), team]));

    const normalizedRows = payload.rows.map((row, index) => ({
      rowNumber: index + 2,
      fullName: normalizeTextField(row.fullName).replace(/\s+/g, ' '),
      username: normalizeTextField(row.username).toLowerCase(),
      email: normalizeTextField(row.email).toLowerCase(),
      workCountry: row.workCountry ?? 'PT',
      teamName: normalizeTextField(row.teamName),
      subTeamName: normalizeTextField(row.subTeamName),
      profile: sanitizeBulkImportProfile(row.profile),
    }));

    const usernameCounts = new Map<string, number>();
    const emailCounts = new Map<string, number>();
    for (const row of normalizedRows) {
      usernameCounts.set(row.username, (usernameCounts.get(row.username) ?? 0) + 1);
      emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1);
    }

    const existingUsers = normalizedRows.length > 0
      ? await prisma.user.findMany({
          where: {
            OR: [
              { username: { in: normalizedRows.map((row) => row.username) } },
              { email: { in: normalizedRows.map((row) => row.email) } },
            ],
          },
          select: {
            username: true,
            email: true,
          },
        })
      : [];

    const existingUsernames = new Set(existingUsers.map((user) => user.username.toLowerCase()));
    const existingEmails = new Set(existingUsers.map((user) => user.email.toLowerCase()));
    const results: Array<{
      rowNumber: number;
      fullName: string;
      username: string;
      email: string;
      status: 'CREATED' | 'FAILED';
      message: string;
      id?: string;
    }> = [];

    for (const row of normalizedRows) {
      const rowErrors: string[] = [];

      if (!row.fullName) {
        rowErrors.push('Nome completo em falta.');
      }
      if (!row.username) {
        rowErrors.push('Username em falta.');
      }
      if (!row.email) {
        rowErrors.push('Email em falta.');
      }
      if ((usernameCounts.get(row.username) ?? 0) > 1) {
        rowErrors.push('Username duplicado no ficheiro.');
      }
      if ((emailCounts.get(row.email) ?? 0) > 1) {
        rowErrors.push('Email duplicado no ficheiro.');
      }
      if (existingUsernames.has(row.username)) {
        rowErrors.push('Username já existe na plataforma.');
      }
      if (existingEmails.has(row.email)) {
        rowErrors.push('Email já existe na plataforma.');
      }

      const profile = row.profile;
      if (profile.nif && !isValidNif(profile.nif)) {
        rowErrors.push('NIF inválido. Deve conter 9 dígitos válidos.');
      }
      if (profile.niss && !isValidNiss(profile.niss)) {
        rowErrors.push('NISS inválido. Deve conter 11 dígitos.');
      }
      if (profile.iban && !isValidIban(profile.iban)) {
        rowErrors.push('IBAN inválido.');
      }
      if (profile.emailPessoal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailPessoal)) {
        rowErrors.push('Email pessoal inválido.');
      }
      if (profile.contactoEmergenciaNumero && !isValidPhone(profile.contactoEmergenciaNumero)) {
        rowErrors.push('Contacto de emergência inválido.');
      }
      if (profile.numeroDependentes && !isNonNegativeInteger(profile.numeroDependentes)) {
        rowErrors.push('Número de dependentes inválido. Usa apenas dígitos.');
      }
      if (profile.anoPrimeiroDesconto && !isReasonableYear(profile.anoPrimeiroDesconto)) {
        rowErrors.push('Ano primeiro desconto inválido. Usa formato AAAA.');
      }

      const dateFieldEntries: Array<[BulkImportProfileFieldKey, string]> = [
        ['dataNascimento', 'Data de nascimento'],
        ['validadeCartaoCidadao', 'Validade do cartão de cidadão'],
        ['voucherNosData', 'Data voucher NOS'],
        ['dataInicioContrato', 'Data início contrato'],
        ['dataFimContrato', 'Data fim contrato'],
      ];

      for (const [dateField, label] of dateFieldEntries) {
        const rawValue = profile[dateField];
        if (!rawValue) {
          continue;
        }
        if (!isValidIsoDate(rawValue)) {
          rowErrors.push(`${label} inválida. Usa formato YYYY-MM-DD.`);
        }
      }

      if (profile.dataInicioContrato && profile.dataFimContrato
        && isValidIsoDate(profile.dataInicioContrato)
        && isValidIsoDate(profile.dataFimContrato)
        && profile.dataFimContrato < profile.dataInicioContrato) {
        rowErrors.push('Data fim contrato não pode ser anterior à data início contrato.');
      }

      let resolvedTeamId: string | null = null;
      const resolvedTeam = row.teamName
        ? teamsByName.get(row.teamName.toLowerCase())
        : undefined;

      if (row.teamName && !resolvedTeam) {
        rowErrors.push('Equipa principal não encontrada.');
      }

      if (row.subTeamName) {
        const resolvedSubTeam = teamsByName.get(row.subTeamName.toLowerCase());
        if (!resolvedSubTeam) {
          rowErrors.push('Subequipa não encontrada.');
        } else if (!resolvedSubTeam.parentTeamId) {
          rowErrors.push('A subequipa indicada não é uma subequipa válida.');
        } else if (resolvedTeam && resolvedSubTeam.parentTeamId !== resolvedTeam.id) {
          rowErrors.push('A subequipa não pertence à equipa principal indicada.');
        } else {
          resolvedTeamId = resolvedSubTeam.id;
        }
      } else if (resolvedTeam) {
        resolvedTeamId = resolvedTeam.id;
      }

      if (rowErrors.length > 0) {
        results.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          username: row.username,
          email: row.email,
          status: 'FAILED',
          message: rowErrors.join(' '),
        });
        continue;
      }

      try {
        const createdUser = await createManagedUser({
          actorUserId: req.authUser!.id,
          username: row.username,
          email: row.email,
          fullName: row.fullName,
          role: 'COLABORADOR',
          teamId: resolvedTeamId,
          workCountry: row.workCountry,
          profile: row.profile,
        });

        existingUsernames.add(row.username);
        existingEmails.add(row.email);
        results.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          username: row.username,
          email: row.email,
          status: 'CREATED',
          message: 'Criado com sucesso.',
          id: createdUser.id,
        });
      } catch (error) {
        results.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          username: row.username,
          email: row.email,
          status: 'FAILED',
          message: error instanceof Error ? error.message : 'Falha inesperada ao criar colaborador.',
        });
      }
    }

    const createdCount = results.filter((item) => item.status === 'CREATED').length;
    const failedCount = results.length - createdCount;

    return res.json({
      createdCount,
      failedCount,
      results,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/users', requireAuth, async (req, res) => {
  try {
    const user = await createUser(req.body);
    return res.status(201).json(user);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return res.status(400).json({ message: errorMessage });
  }
});

export { router as usersRouter };
