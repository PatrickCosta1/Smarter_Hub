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
import { sendTransactionalEmail } from '../lib/email.js';
import { requireAuth } from '../middleware/auth.js';

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
});

const employeeAdmissionCorrectionSchema = z.object({
  reason: z.string().trim().min(5, 'Indica nas observações o que está mal.'),
});

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
  workCountry: countrySchema.optional(),
  brWorkState: brWorkStateSchema.optional(),
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

const EMPLOYEE_ADMISSION_PUBLIC_FIELDS = [
  'nomeCompleto',
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
  'localNascimentoPais',
  'localNascimentoCidade',
  'nomePai',
  'nomeMae',
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
  'situacaoIrs',
  'numeroDependentes',
  'declaracaoIrs',
  'irsJovem',
  'anoPrimeiroDesconto',
  'primeiroEmprego',
  'recebeAposentadoria',
  'recebeSeguroDesemprego',
  'valeTransporte',
  'numeroCartaoContinente',
  'voucherNosData',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
  'workCountry',
  'brWorkState',
] as const;

type EmployeeAdmissionPublicField = typeof EMPLOYEE_ADMISSION_PUBLIC_FIELDS[number];

type EmployeeAdmissionPersonalData = Partial<Record<EmployeeAdmissionPublicField, string | boolean>>;

function normalizeBooleanField(value: unknown) {
  return value === true || value === 'true' || value === '1';
}

function hashAdmissionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildAdmissionToken() {
  return randomBytes(32).toString('hex');
}

function buildFrontendAdmissionUrl(token: string) {
  const configuredBase = String(process.env.FRONTEND_URL ?? '').split(',').map((item) => item.trim()).find(Boolean) || 'http://localhost:5173';
  return `${configuredBase.replace(/\/$/, '')}/admissao/${token}`;
}

function getAdmissionExpiryDate() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
}

function buildEmptyAdmissionPersonalData(input: {
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
}): EmployeeAdmissionPersonalData {
  return {
    nomeCompleto: input.fullName,
    nomeAbreviado: input.fullName,
    emailPessoal: input.personalEmail,
    workCountry: input.workCountry,
    brWorkState: input.workCountry === 'BR' ? (input.brWorkState ?? '') : '',
  };
}

function normalizeEmployeeAdmissionPersonalData(
  payload: unknown,
  invitation: { fullName: string; personalEmail: string; workCountry: 'PT' | 'BR'; brWorkState?: 'SP' | 'RS' | null },
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload inválido.');
  }

  const source = payload as Record<string, unknown>;
  const normalized: EmployeeAdmissionPersonalData = buildEmptyAdmissionPersonalData(invitation);

  for (const field of EMPLOYEE_ADMISSION_PUBLIC_FIELDS) {
    if (!(field in source)) {
      continue;
    }

    if (field === 'primeiroEmprego' || field === 'recebeAposentadoria' || field === 'recebeSeguroDesemprego' || field === 'valeTransporte') {
      normalized[field] = normalizeBooleanField(source[field]);
      continue;
    }

    normalized[field] = source[field] == null ? '' : String(source[field]);
  }

  normalized.nomeCompleto = normalizeTextField(String(normalized.nomeCompleto ?? invitation.fullName)) || invitation.fullName;
  normalized.emailPessoal = normalizeTextField(String(normalized.emailPessoal ?? invitation.personalEmail)).toLowerCase() || invitation.personalEmail;
  normalized.workCountry = invitation.workCountry;
  normalized.brWorkState = invitation.workCountry === 'BR' ? normalizeTextField(String(normalized.brWorkState ?? invitation.brWorkState ?? '')) : '';

  return normalized;
}

function validateEmployeeAdmissionPersonalData(data: EmployeeAdmissionPersonalData, country: 'PT' | 'BR') {
  const errors: string[] = [];

  if (!normalizeTextField(String(data.nomeCompleto ?? ''))) errors.push('Nome completo é obrigatório.');
  if (!normalizeTextField(String(data.nomeAbreviado ?? ''))) errors.push('Nome abreviado é obrigatório.');
  if (!normalizeTextField(String(data.dataNascimento ?? ''))) errors.push('Data de nascimento é obrigatória.');
  if (!normalizeTextField(String(data.genero ?? ''))) errors.push('Género é obrigatório.');
  if (!normalizeTextField(String(data.estadoCivil ?? ''))) errors.push('Estado civil é obrigatório.');
  if (!normalizeTextField(String(data.habilitacoesLiterarias ?? ''))) errors.push('Habilitações literárias são obrigatórias.');
  if (!normalizeTextField(String(data.emailPessoal ?? '')) || !z.string().email().safeParse(String(data.emailPessoal ?? '')).success) errors.push('Email pessoal inválido.');
  if (!normalizeTextField(String(data.telemovel ?? ''))) errors.push('Telemóvel é obrigatório.');
  if (!normalizeTextField(String(data.moradaFiscal ?? ''))) errors.push('Morada fiscal é obrigatória.');
  if (!normalizeTextField(String(data.endereco ?? ''))) errors.push('Morada habitual é obrigatória.');
  if (!normalizeTextField(String(data.localidade ?? ''))) errors.push('Localidade é obrigatória.');
  if (!normalizeTextField(String(data.codigoPostal ?? ''))) errors.push(country === 'BR' ? 'CEP é obrigatório.' : 'Código postal é obrigatório.');
  if (!normalizeTextField(String(data.contactoEmergenciaNome ?? ''))) errors.push('Nome do contacto de emergência é obrigatório.');
  if (!normalizeTextField(String(data.contactoEmergenciaParentesco ?? ''))) errors.push('Parentesco do contacto de emergência é obrigatório.');
  if (!normalizeTextField(String(data.contactoEmergenciaNumero ?? ''))) errors.push('Número do contacto de emergência é obrigatório.');
  if (country === 'BR' && !normalizeTextField(String(data.brWorkState ?? ''))) errors.push('Estado de trabalho no Brasil é obrigatório.');

  return errors;
}

async function resolveAdmissionByTokenOrThrow(token: string) {
  const tokenHash = hashAdmissionToken(token);
  const admission = await prisma.employeeAdmission.findUnique({
    where: { submissionTokenHash: tokenHash },
  });

  if (!admission) {
    throw new Error('Convite não encontrado.');
  }

  if (admission.status === 'COMPLETED' || admission.status === 'CANCELLED') {
    throw new Error('Este convite já não está disponível.');
  }

  if (admission.tokenExpiresAt < new Date()) {
    throw new Error('Este convite expirou.');
  }

  return admission;
}

async function resolveAdmissionReviewersByCountry(workCountry: 'PT' | 'BR') {
  const reviewers = await prisma.user.findMany({
    where: {
      isActive: true,
      AND: [
        {
          OR: [
            { isRootAccess: true },
            {
              permissionAssignments: {
                some: {
                  isEnabled: true,
                  permission: { code: 'approve_profile_change' },
                },
              },
            },
          ],
        },
        {
          OR: [
            { isRootAccess: true },
            { profile: { is: { workCountry } } },
          ],
        },
      ],
    },
    select: { id: true },
  });

  return Array.from(new Set(reviewers.map((item) => item.id)));
}

async function canActorReviewAdmissionCountry(actor: { id: string; isRootAccess: boolean }, admissionCountry: 'PT' | 'BR') {
  if (actor.isRootAccess) {
    return true;
  }

  const actorProfile = await prisma.profile.findUnique({
    where: { userId: actor.id },
    select: { workCountry: true },
  });

  return (actorProfile?.workCountry ?? 'PT') === admissionCountry;
}

async function sendAdmissionInviteEmail(params: {
  personalEmail: string;
  fullName: string;
  invitationLink: string;
  reviewReason?: string;
}) {
  const isCorrection = Boolean(params.reviewReason);
  const subject = isCorrection
    ? 'Tlantic · atualização necessária no formulário de admissão'
    : 'Bem-vindo à Tlantic · completa o teu formulário de admissão';

  const headerColor = isCorrection ? '#b45309' : '#1a56db';
  const headerGradient = isCorrection
    ? 'linear-gradient(135deg,#b45309,#92400e)'
    : 'linear-gradient(135deg,#1a56db,#0e3f9e)';
  const badgeLabel = isCorrection ? 'Correção solicitada' : 'Convite de admissão';
  const bodyTitle = isCorrection ? 'Atualização necessária no teu formulário' : 'Bem-vindo(a) à Tlantic';
  const bodyText = isCorrection
    ? 'O teu processo de admissão foi devolvido para correção. Revê os dados submetidos e atualiza o formulário de acordo com as observações da equipa de RH.'
    : 'O teu processo de admissão na Tlantic foi iniciado. Usa o link abaixo para preencher o formulário com os teus dados pessoais e profissionais.';

  const reviewBlock = isCorrection && params.reviewReason
    ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 20px;margin:0 0 28px;">
        <p style="margin:0 0 4px;font-weight:700;color:#92400e;font-size:14px;">Motivo da devolução:</p>
        <p style="margin:0;color:#78350f;font-size:14px;line-height:1.6;">${params.reviewReason}</p>
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:48px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

        <!-- HEADER -->
        <tr><td style="background:${headerGradient};padding:40px 40px 32px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 16px;margin-bottom:16px;">
            <span style="color:rgba(255,255,255,0.9);font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">${badgeLabel}</span>
          </div>
          <h1 style="margin:0 0 6px;color:#ffffff;font-size:32px;font-weight:800;letter-spacing:-1px;">Tlantic</h1>
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:14px;">Smarter Hub · Portal de Recursos Humanos</p>
        </td></tr>

        <!-- BODY -->
        <tr><td style="padding:40px 40px 32px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:22px;font-weight:700;">${bodyTitle}</h2>
          <p style="margin:0 0 8px;color:#6b7280;font-size:15px;">Olá <strong style="color:#111827;">${params.fullName}</strong>,</p>
          <p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.7;">${bodyText}</p>

          ${reviewBlock}

          <!-- CTA BUTTON -->
          <div style="text-align:center;margin:0 0 32px;">
            <a href="${params.invitationLink}"
               style="display:inline-block;background:${headerColor};color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.2px;box-shadow:0 4px 12px rgba(26,86,219,0.35);">
              ${isCorrection ? 'Corrigir a minha ficha' : 'Preencher ficha de admissão'} →
            </a>
          </div>

          <!-- LINK FALLBACK -->
          <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
            <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Ou copia o link diretamente</p>
            <p style="margin:0;word-break:break-all;color:${headerColor};font-size:13px;font-family:monospace;">${params.invitationLink}</p>
          </div>

          <!-- EXPIRY NOTE -->
          <div style="display:flex;align-items:flex-start;gap:12px;background:#f0f9ff;border-radius:10px;padding:16px 20px;border:1px solid #bae6fd;">
            <span style="font-size:20px;flex-shrink:0;">⏱</span>
            <p style="margin:0;color:#0369a1;font-size:14px;line-height:1.6;">Este link é <strong>pessoal e intransmissível</strong> e expira em <strong>7 dias</strong>. Se o prazo expirar, responde a este processo junto da equipa de RH para receberes um novo convite.</p>
          </div>
        </td></tr>

        <!-- DIVIDER -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:24px 40px;">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">Este email foi enviado automaticamente por <strong>Tlantic · Smarter Hub</strong>.</p>
          <p style="margin:0;color:#d1d5db;font-size:12px;text-align:center;">Em caso de dúvida, contacta a equipa de RH.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textFallback = [
    `Olá ${params.fullName},`,
    '',
    isCorrection
      ? 'Foi solicitada uma atualização no teu formulário de admissão da Tlantic.'
      : 'Bem-vindo(a) à Tlantic. O teu processo de admissão foi iniciado.',
    '',
    bodyText,
    ...(params.reviewReason ? ['', `Motivo: ${params.reviewReason}`] : []),
    '',
    'Link:',
    params.invitationLink,
    '',
    'Este link expira em 7 dias.',
  ].join('\n');

  await sendTransactionalEmail({
    to: params.personalEmail,
    subject,
    text: textFallback,
    html,
  });
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

function yearsBetween(start: Date, end = new Date()) {
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return diff / (365.25 * 24 * 60 * 60 * 1000);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeGender(value?: string) {
  const normalized = (value || '').trim().toLowerCase();

  if (!normalized) {
    return 'Não informado';
  }

  if (['m', 'masculino', 'male', 'homem'].includes(normalized)) {
    return 'Masculino';
  }

  if (['f', 'feminino', 'female', 'mulher'].includes(normalized)) {
    return 'Feminino';
  }

  return 'Outro';
}

function normalizeContractType(value?: string | null) {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
  const [teamsScope, vacationsScope, isFullAccess, user] = await Promise.all([
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

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
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
      managedTeams: {
        select: { id: true, name: true },
      },
      profile: {
        select: {
          nomeAbreviado: true, nomeCompleto: true,
          dataNascimento: true,
          genero: true,
          estadoCivil: true,
          habilitacoesLiterarias: true,
          curso: true,
          faculdade: true,
          emailPessoal: true,
          telemovel: true,
          nacionalidade: true,
          githubUser: true,
          moradaFiscal: true,
          endereco: true,
          codigoPostal: true,
          matriculaCarro: true,
          localNascimentoPais: true,
          localNascimentoCidade: true,
          nomePai: true,
          nomeMae: true,
          cartaoCidadao: true,
          validadeCartaoCidadao: true,
          nif: true,
          cpf: true,
          pis: true,
          ctps: true,
          ctpsSerie: true,
          ctpsDataExpedicao: true,
          rg: true,
          rgOrgaoEmissor: true,
          rgDataExpedicao: true,
          cnh: true,
          cnhCategoria: true,
          cnhDataValidade: true,
          tituloEleitor: true,
          zonaEleitoral: true,
          secaoEleitoral: true,
          certificadoReservista: true,
          niss: true,
          iban: true,
          situacaoIrs: true,
          numeroDependentes: true,
          declaracaoIrs: true,
          irsJovem: true,
          anoPrimeiroDesconto: true,
          primeiroEmprego: true,
          recebeAposentadoria: true,
          recebeSeguroDesemprego: true,
          valeTransporte: true,
          numeroCartaoContinente: true,
          voucherNosData: true,
          comprovativoMoradaFiscal: true,
          comprovativoCartaoCidadao: true,
          comprovativoIban: true,
          comprovativoCartaoContinente: true,
          contactoEmergenciaNome: true,
          contactoEmergenciaParentesco: true,
          contactoEmergenciaNumero: true,
          cargo: true,
          categoriaProfissional: true,
          numeroMecanografico: true,
          funcao: true,
          dataInicioContrato: true,
          dataFimContrato: true,
          tipoContrato: true,
          regimeHorario: true,
          workCountry: true,
          localidade: true,
        },
      },
    },
    take: limit,
    orderBy: {
      createdAt: 'desc',
    },
  });

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
    const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
    if (!scope) {
      return res.status(403).json({ message: 'Sem permissões para consultar colaboradores.' });
    }

  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
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

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const scopedWhere: Prisma.UserWhereInput = scopeWhere
    ? { AND: [where, scopeWhere] }
    : where;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where: scopedWhere }),
    prisma.user.findMany({
      where: scopedWhere,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: orderByMap[sortBy] || orderByMap.createdAt,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isRootAccess: true,
        hasAccessTotal: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        teamMemberships: {
          where: { isActive: true },
          select: {
            teamId: true,
            membershipRole: true,
            team: { select: { id: true, name: true } },
          },
        },
        managedTeams: {
          select: { id: true, name: true },
        },
        profile: {
          select: {
            nomeAbreviado: true, nomeCompleto: true,
            dataNascimento: true,
            genero: true,
            estadoCivil: true,
            habilitacoesLiterarias: true,
            curso: true,
            faculdade: true,
            emailPessoal: true,
            telemovel: true,
            nacionalidade: true,
            githubUser: true,
            moradaFiscal: true,
            endereco: true,
            codigoPostal: true,
            matriculaCarro: true,
            localNascimentoPais: true,
            localNascimentoCidade: true,
            nomePai: true,
            nomeMae: true,
            cartaoCidadao: true,
            validadeCartaoCidadao: true,
            nif: true,
            cpf: true,
            pis: true,
            ctps: true,
            ctpsSerie: true,
            ctpsDataExpedicao: true,
            rg: true,
            rgOrgaoEmissor: true,
            rgDataExpedicao: true,
            cnh: true,
            cnhCategoria: true,
            cnhDataValidade: true,
            tituloEleitor: true,
            zonaEleitoral: true,
            secaoEleitoral: true,
            certificadoReservista: true,
            niss: true,
            iban: true,
            situacaoIrs: true,
            numeroDependentes: true,
            declaracaoIrs: true,
            irsJovem: true,
            anoPrimeiroDesconto: true,
            primeiroEmprego: true,
            recebeAposentadoria: true,
            recebeSeguroDesemprego: true,
            valeTransporte: true,
            numeroCartaoContinente: true,
            voucherNosData: true,
            comprovativoMoradaFiscal: true,
            comprovativoCartaoCidadao: true,
            comprovativoIban: true,
            comprovativoCartaoContinente: true,
            contactoEmergenciaNome: true,
            contactoEmergenciaParentesco: true,
            contactoEmergenciaNumero: true,
            cargo: true,
            categoriaProfissional: true,
            numeroMecanografico: true,
            funcao: true,
            dataInicioContrato: true,
            dataFimContrato: true,
            tipoContrato: true,
            regimeHorario: true,
            workCountry: true,
            brWorkState: true,
            localidade: true,
          },
        },
      },
    }),
  ]);

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

  const [usersResult, profileRequestsResult, vacationsResult, trainingsResult, historyResult] = await Promise.allSettled([
    prisma.user.findMany({
      where: collaboratorWhere,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        team: { select: { id: true, name: true } },
        teamMemberships: {
          where: { isActive: true },
          select: {
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        profile: {
          select: {
            nomeAbreviado: true,
            nomeCompleto: true,
            dataNascimento: true,
            dataInicioContrato: true,
            tipoContrato: true,
            genero: true,
            habilitacoesLiterarias: true,
            cargo: true,
            categoriaProfissional: true,
            numeroMecanografico: true,
            localidade: true,
            workCountry: true,
            funcao: true,
            voucherNosData: true,
            numeroCartaoContinente: true,
          },
        },
        createdAt: true,
      },
    }),
    prisma.profileChangeRequest.findMany({
      where: {
        status: 'PENDING',
        ...requestScopeWhere,
      },
      select: {
        userId: true,
        user: {
          select: {
            hasAccessTotal: true,
          },
        },
      },
    }),
    prisma.vacation.findMany({
      where: {
        status: 'PENDING',
        ...requestScopeWhere,
      },
      select: {
        userId: true,
        user: {
          select: {
            hasAccessTotal: true,
          },
        },
      },
    }),
    Promise.all([
      prisma.training.count({
        where: {
          status: { in: ['ASSIGNED', 'ATRIBUIDA', 'ATRIBUÍDA'] },
          ...requestScopeWhere,
        },
      }),
      prisma.training.count({
        where: {
          status: { in: ['COMPLETED', 'CONCLUIDA', 'CONCLUÍDA'] },
          ...requestScopeWhere,
        },
      }),
      prisma.training.findMany({
        where: requestScopeWhere,
        select: { horas: true },
      }),
    ]),
    prisma.profileChangeRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'PARTIALLY_REJECTED', 'REJECTED'] },
        reviewedAt: { not: null },
        ...requestScopeWhere,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                nomeAbreviado: true, nomeCompleto: true,
              },
            },
          },
        },
      },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: 120,
    }),
  ]);

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

  const getDisplayName = (user: typeof collaboratorRows[number]) => (
    user.profile?.nomeAbreviado?.trim()
      || user.profile?.nomeCompleto?.trim()
      || user.username
  );

  const getUserTeams = (user: typeof collaboratorRows[number]) => {
    const map = new Map<string, { id: string; name: string }>();

    if (user.team?.id && user.team?.name) {
      map.set(user.team.id, { id: user.team.id, name: user.team.name });
    }

    for (const membership of user.teamMemberships) {
      if (membership.team?.id && membership.team?.name) {
        map.set(membership.team.id, { id: membership.team.id, name: membership.team.name });
      }
    }

    return Array.from(map.values());
  };

  const getHierarchyLevel = (user: typeof collaboratorRows[number]) => (
    user.profile?.cargo?.trim()
      || user.profile?.categoriaProfissional?.trim()
      || user.role
  );

  const getGeography = (user: typeof collaboratorRows[number]) => (
    user.profile?.localidade?.trim()
      || user.profile?.workCountry
      || 'Não informado'
  );

  const getFunction = (user: typeof collaboratorRows[number]) => (
    user.profile?.funcao?.trim()
      || 'Não informado'
  );

  const buildDistribution = (
    rows: typeof collaboratorRows,
    getLabel: (item: typeof collaboratorRows[number]) => string,
  ) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const label = getLabel(row).trim() || 'Não informado';
      map.set(label, (map.get(label) || 0) + 1);
    }

    const total = rows.length;
    return Array.from(map.entries())
      .map(([label, count]) => ({
        label,
        count,
        share: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  const buildCharacterization = (rows: typeof collaboratorRows) => {
    const ageValues = rows
      .map((item) => parseIsoDate(item.profile?.dataNascimento || ''))
      .filter((value): value is Date => value !== null)
      .map((birthDate) => yearsBetween(birthDate));

    const tenureValues = rows
      .map((item) => parseIsoDate(item.profile?.dataInicioContrato || ''))
      .filter((value): value is Date => value !== null)
      .map((startDate) => yearsBetween(startDate));

    const activeRows = rows.filter((item) => item.isActive !== false);
    const activeCount = activeRows.length;
    const total = rows.length;

    const eligibleNosVoucherRows = activeRows.filter((row) => {
      const isPtProfile = !row.profile?.workCountry || row.profile?.workCountry === 'PT';
      return isPtProfile && normalizeContractType(row.profile?.tipoContrato) === 'sem termo';
    });

    const requestedNosVoucherRows = eligibleNosVoucherRows.filter((row) => Boolean(row.profile?.voucherNosData?.trim()));
    const nosVoucherRate = eligibleNosVoucherRows.length > 0
      ? (requestedNosVoucherRows.length / eligibleNosVoucherRows.length) * 100
      : 0;

    const voucherRequestLeadDays = requestedNosVoucherRows
      .map((row) => {
        const contractStart = parseIsoDate(row.profile?.dataInicioContrato || '');
        const requestDate = parseIsoDate(row.profile?.voucherNosData || '');

        if (!contractStart || !requestDate) {
          return null;
        }

        const diffDays = (requestDate.getTime() - contractStart.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 ? diffDays : null;
      })
      .filter((value): value is number => typeof value === 'number');

    const voucherRequestLeadDetails = eligibleNosVoucherRows
      .map((row) => {
        const contractStart = parseIsoDate(row.profile?.dataInicioContrato || '');
        const requestDate = parseIsoDate(row.profile?.voucherNosData || '');
        const teamName = getUserTeams(row).map((team) => team.name).join(', ');
        const displayName = getDisplayName(row);

        let leadDays: number | null = null;
        let daysSinceStart: number | null = null;

        if (contractStart) {
          const referenceDate = requestDate ?? new Date();
          const diffDays = Math.floor((referenceDate.getTime() - contractStart.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0) {
            if (requestDate) {
              leadDays = diffDays;
            } else {
              daysSinceStart = diffDays;
            }
          }
        }

        return {
          id: row.id,
          name: displayName,
          teamName: teamName || 'Sem equipa',
          contractStart: row.profile?.dataInicioContrato || null,
          requestDate: row.profile?.voucherNosData?.trim() || null,
          leadDays,
          daysSinceStart,
          hasRequested: Boolean(requestDate),
        };
      })
      .sort((a, b) => {
        if (a.hasRequested !== b.hasRequested) {
          return a.hasRequested ? -1 : 1;
        }

        if (a.hasRequested) {
          return (a.leadDays ?? Number.MAX_SAFE_INTEGER) - (b.leadDays ?? Number.MAX_SAFE_INTEGER);
        }

        return a.name.localeCompare(b.name);
      });

    // % cartão Continente (activos)
    const continenteCardRate = activeCount > 0
      ? (activeRows.filter((r) => r.profile?.numeroCartaoContinente?.trim()).length / activeCount) * 100
      : 0;

    // Tempo médio por função
    const functionTenureMap = new Map<string, number[]>();
    for (const row of rows) {
      const fn = getFunction(row);
      if (fn === 'Não informado') {
        continue;
      }

      const tenure = parseIsoDate(row.profile?.dataInicioContrato || '');
      if (!tenure) {
        continue;
      }

      if (!functionTenureMap.has(fn)) {
        functionTenureMap.set(fn, []);
      }

      functionTenureMap.get(fn)!.push(yearsBetween(tenure));
    }

    const avgTenureByFunction = Array.from(functionTenureMap.entries())
      .map(([label, values]) => ({ label, avgTenure: average(values), count: values.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      headcount: total,
      averages: {
        age: average(ageValues),
        tenure: average(tenureValues),
      },
      retentionRate: total > 0 ? (activeCount / total) * 100 : 0,
      nosVoucherRate,
      avgVoucherRequestLeadDays: voucherRequestLeadDays.length > 0 ? average(voucherRequestLeadDays) : null,
      voucherRequestLeadDetails,
      continenteCardRate,
      avgTenureByFunction,
      distributions: {
        hierarchy: buildDistribution(rows, getHierarchyLevel),
        geography: buildDistribution(rows, getGeography),
        gender: buildDistribution(rows, (item) => normalizeGender(item.profile?.genero)),
        function: buildDistribution(rows, getFunction),
      },
    };
  };

  const periodScopedRows = collaboratorRows.filter((item) => {
    if (!periodStartDate && !periodEndDate) {
      return true;
    }

    const contractStart = parseIsoDate(item.profile?.dataInicioContrato || '');
    if (!contractStart) {
      return false;
    }

    if (periodStartDate && contractStart < periodStartDate) {
      return false;
    }

    if (periodEndDate && contractStart > periodEndDate) {
      return false;
    }

    return true;
  });

  const teamOptions = Array.from(new Map(
    periodScopedRows
      .flatMap((item) => getUserTeams(item))
      .map((team) => [team.id, team]),
  ).values()).sort((a, b) => a.name.localeCompare(b.name));

  const levelOptions = Array.from(new Set(periodScopedRows.map((item) => getHierarchyLevel(item)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const geographyOptions = Array.from(new Set(periodScopedRows.map((item) => getGeography(item)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const functionOptions = Array.from(new Set(periodScopedRows.map((item) => getFunction(item)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const contractTypeOptions = Array.from(new Set(
    periodScopedRows
      .map((item) => item.profile?.tipoContrato?.trim())
      .filter((value): value is string => Boolean(value)),
  )).sort((a, b) => a.localeCompare(b));
  const genderOptions = Array.from(new Set(periodScopedRows.map((item) => normalizeGender(item.profile?.genero))))
    .sort((a, b) => a.localeCompare(b));

  const selectedRows = periodScopedRows.filter((item) => {
    const teams = getUserTeams(item);

    if (filterTeamId && !teams.some((team) => team.id === filterTeamId)) {
      return false;
    }

    if (filterRole && item.role !== filterRole) {
      return false;
    }

    if (filterGender && normalizeGender(item.profile?.genero) !== filterGender) {
      return false;
    }

    if (filterFunction && getFunction(item) !== filterFunction) {
      return false;
    }

    if (filterContractTypes.length > 0 && !filterContractTypes.includes(item.profile?.tipoContrato?.trim() || '')) {
      return false;
    }

    if (filterGeography && getGeography(item) !== filterGeography) {
      return false;
    }

    if (filterLevel && getHierarchyLevel(item) !== filterLevel) {
      return false;
    }

    if (filterIsActive === 'active' && item.isActive === false) {
      return false;
    }

    if (filterIsActive === 'inactive' && item.isActive !== false) {
      return false;
    }

    if (!filterSearch) {
      return true;
    }

    const haystack = [
      getDisplayName(item),
      item.username,
      item.email,
      teams.map((team) => team.name).join(' '),
      getHierarchyLevel(item),
      getFunction(item),
      getGeography(item),
      item.profile?.numeroMecanografico || '',
    ].join(' ').toLowerCase();

    return haystack.includes(filterSearch);
  });

  const selectedTeamName = filterTeamId
    ? (teamOptions.find((team) => team.id === filterTeamId)?.name || 'Equipa filtrada')
    : 'Todas as equipas';

  const teamInsights = {
    appliedFilters: {
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
    },
    selectedTeamName,
    availableFilters: {
      teams: teamOptions,
      roles: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'],
      genders: genderOptions,
      functions: functionOptions,
      contractTypes: contractTypeOptions,
      geographies: geographyOptions,
      levels: levelOptions,
      activeStates: [
        { value: 'all', label: 'Todos' },
        { value: 'active', label: 'Ativos' },
        { value: 'inactive', label: 'Inativos' },
      ],
    },
    selected: buildCharacterization(selectedRows),
    company: buildCharacterization(periodScopedRows),
  };
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

  const activeUsers = periodScopedRows.filter((user) => user.isActive !== false).length;
  const inactiveUsers = Math.max(0, periodScopedRows.length - activeUsers);

  const ageValues = periodScopedRows
    .map((item) => parseIsoDate(item.profile?.dataNascimento || ''))
    .filter((value): value is Date => value !== null)
    .map((birthDate) => yearsBetween(birthDate));

  const tenureValues = periodScopedRows
    .map((item) => parseIsoDate(item.profile?.dataInicioContrato || ''))
    .filter((value): value is Date => value !== null)
    .map((startDate) => yearsBetween(startDate));

  const educationMap = new Map<string, number>();
  const areaGenderMap = new Map<string, { Masculino: number; Feminino: number; Outro: number; 'Não informado': number }>();
  const timeInLevelMap = new Map<string, number[]>();

  const promotionEvents = historyRows
    .filter((item) => Boolean(item.reviewedAt))
    .filter((item) => {
      const requestedData = (item.requestedData as Record<string, unknown>) || {};
      const approvedFields = (item.approvedFields as Record<string, unknown>) || {};
      const changedFields = Object.keys(requestedData);
      const approvedFieldNames = Object.keys(approvedFields);
      const requestedCargo = String(requestedData.cargo || '').trim();
      const approvedCargo = String(approvedFields.cargo || '').trim();

      const approvedWithCargo = item.status === 'APPROVED' && changedFields.includes('cargo') && requestedCargo.length > 0;
      const partialWithApprovedCargo = item.status === 'PARTIALLY_REJECTED' && approvedFieldNames.includes('cargo') && approvedCargo.length > 0;

      return approvedWithCargo || partialWithApprovedCargo;
    })
    .map((item) => ({
      id: item.id,
      userId: item.user?.id || '',
      collaborator: item.user?.profile?.nomeAbreviado?.trim()
        || String(item.user?.profile?.nomeCompleto || '').trim()
        || item.user?.username
        || 'Colaborador',
      promotedTo: String(((item.approvedFields as Record<string, unknown>)?.cargo || (item.requestedData as Record<string, unknown>)?.cargo || '')).trim() || 'Nível atualizado',
      reviewedAt: item.reviewedAt?.toISOString() || item.createdAt.toISOString(),
    }))
    .filter((item) => Boolean(item.userId))
    .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());

  const latestPromotionByUser = new Map<string, string>();
  for (const event of promotionEvents) {
    if (!latestPromotionByUser.has(event.userId)) {
      latestPromotionByUser.set(event.userId, event.reviewedAt);
    }
  }

  for (const collaborator of periodScopedRows) {
    const education = (collaborator.profile?.habilitacoesLiterarias || '').trim() || 'Não informado';
    educationMap.set(education, (educationMap.get(education) || 0) + 1);

    const area = (collaborator.team?.name || collaborator.profile?.funcao || 'Sem área').trim() || 'Sem área';
    if (!areaGenderMap.has(area)) {
      areaGenderMap.set(area, { Masculino: 0, Feminino: 0, Outro: 0, 'Não informado': 0 });
    }

    const genderBucket = areaGenderMap.get(area)!;
    const gender = normalizeGender(collaborator.profile?.genero);
    genderBucket[gender as keyof typeof genderBucket] += 1;

    const currentLevel = (collaborator.profile?.cargo || collaborator.profile?.funcao || 'Sem nível').trim() || 'Sem nível';
    const promotionDate = latestPromotionByUser.get(collaborator.id);
    const baseDate = promotionDate ? new Date(promotionDate) : parseIsoDate(collaborator.profile?.dataInicioContrato || '');

    if (baseDate) {
      if (!timeInLevelMap.has(currentLevel)) {
        timeInLevelMap.set(currentLevel, []);
      }

      timeInLevelMap.get(currentLevel)!.push(yearsBetween(baseDate));
    }
  }

  const educationDistribution = Array.from(educationMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const genderByArea = Array.from(areaGenderMap.entries())
    .map(([area, counts]) => ({
      area,
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const timeInCurrentLevelByCargo = Array.from(timeInLevelMap.entries())
    .map(([cargo, durations]) => ({
      cargo,
      averageYears: average(durations),
      people: durations.length,
    }))
    .sort((a, b) => b.people - a.people)
    .slice(0, 6);

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
    averages: {
      age: average(ageValues),
      tenure: average(tenureValues),
    },
    charts: {
      educationDistribution,
      genderByArea,
      timeInCurrentLevelByCargo,
    },
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

  const collaboratorRows = await prisma.user.findMany({
    where: collaboratorWhere,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        select: {
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      profile: {
        select: {
          nomeAbreviado: true,
          nomeCompleto: true,
          numeroMecanografico: true,
          genero: true,
          funcao: true,
          cargo: true,
          categoriaProfissional: true,
          localidade: true,
          workCountry: true,
          dataInicioContrato: true,
          tipoContrato: true,
        },
      },
    },
    orderBy: [{ username: 'asc' }],
  });

  const getDisplayName = (user: typeof collaboratorRows[number]) => (
    user.profile?.nomeAbreviado?.trim()
      || user.profile?.nomeCompleto?.trim()
      || user.username
  );

  const getUserTeams = (user: typeof collaboratorRows[number]) => {
    const map = new Map<string, { id: string; name: string }>();

    if (user.team?.id && user.team?.name) {
      map.set(user.team.id, { id: user.team.id, name: user.team.name });
    }

    for (const membership of user.teamMemberships) {
      if (membership.team?.id && membership.team?.name) {
        map.set(membership.team.id, { id: membership.team.id, name: membership.team.name });
      }
    }

    return Array.from(map.values());
  };

  const getHierarchyLevel = (user: typeof collaboratorRows[number]) => (
    user.profile?.cargo?.trim()
      || user.profile?.categoriaProfissional?.trim()
      || user.role
  );

  const getGeography = (user: typeof collaboratorRows[number]) => (
    user.profile?.localidade?.trim()
      || user.profile?.workCountry
      || 'Não informado'
  );

  const getFunction = (user: typeof collaboratorRows[number]) => (
    user.profile?.funcao?.trim()
      || 'Não informado'
  );

  const periodScopedRows = collaboratorRows.filter((item) => {
    if (!periodStartDate && !periodEndDate) {
      return true;
    }

    const contractStart = parseIsoDate(item.profile?.dataInicioContrato || '');
    if (!contractStart) {
      return false;
    }

    if (periodStartDate && contractStart < periodStartDate) {
      return false;
    }

    if (periodEndDate && contractStart > periodEndDate) {
      return false;
    }

    return true;
  });

  const filteredRows = periodScopedRows.filter((item) => {
    const teams = getUserTeams(item);

    if (filterTeamId && !teams.some((team) => team.id === filterTeamId)) {
      return false;
    }

    if (filterRole && item.role !== filterRole) {
      return false;
    }

    if (filterGender && normalizeGender(item.profile?.genero) !== filterGender) {
      return false;
    }

    if (filterFunction && getFunction(item) !== filterFunction) {
      return false;
    }

    if (filterContractTypes.length > 0 && !filterContractTypes.includes(item.profile?.tipoContrato?.trim() || '')) {
      return false;
    }

    if (filterGeography && getGeography(item) !== filterGeography) {
      return false;
    }

    if (filterLevel && getHierarchyLevel(item) !== filterLevel) {
      return false;
    }

    if (filterIsActive === 'active' && item.isActive === false) {
      return false;
    }

    if (filterIsActive === 'inactive' && item.isActive !== false) {
      return false;
    }

    if (!filterSearch) {
      return true;
    }

    const haystack = [
      getDisplayName(item),
      item.username,
      item.email,
      teams.map((team) => team.name).join(' '),
      getHierarchyLevel(item),
      getFunction(item),
      getGeography(item),
      item.profile?.numeroMecanografico || '',
    ].join(' ').toLowerCase();

    return haystack.includes(filterSearch);
  });

  const rows = filteredRows
    .map((item) => ({
      id: item.id,
      nome: getDisplayName(item),
      username: item.username,
      email: item.email,
      numeroMecanografico: item.profile?.numeroMecanografico || '',
      role: item.role,
      estado: item.isActive === false ? 'Inativo' : 'Ativo',
      equipa: getUserTeams(item).map((team) => team.name).join(' | ') || 'Sem equipa',
      nivel: getHierarchyLevel(item),
      funcao: getFunction(item),
      genero: normalizeGender(item.profile?.genero),
      geografia: getGeography(item),
      dataInicioContrato: item.profile?.dataInicioContrato || '',
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

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

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (!req.authUser!.isRootAccess && !await isAccessTotal(req.authUser!.id)) {
    const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'manage_user_active', userId);
    if (!canManageTarget) {
      return res.status(403).json({ message: 'Sem permissões para alterar este colaborador com as restrições atuais.' });
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: payload.data.isActive,
      deactivatedAt: payload.data.isActive ? null : new Date(),
    },
    select: {
      id: true,
      isActive: true,
      deactivatedAt: true,
      updatedAt: true,
    },
  });

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

  const existing = await prisma.team.findUnique({
    where: { id: teamId },
    select: { managerId: true },
  });

  await prisma.$transaction([
    prisma.teamMembership.deleteMany({ where: { teamId } }),
    prisma.user.updateMany({ where: { teamId }, data: { teamId: null } }),
    prisma.team.update({ where: { id: teamId }, data: { managerId: null, coordinatorId: null, parentTeamId: null } }),
    prisma.team.delete({ where: { id: teamId } }),
  ]);

  const previousLeaderId = existing?.managerId ?? null;
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

    const previousCargo = (existingProfileForHistory?.cargo ?? '').trim();
    const nextCargo = data.cargo === undefined ? previousCargo : (data.cargo ?? '').trim();

    await prisma.profile.upsert({
      where: { userId },
      update: {
        ...profilePayload,
        ...(data.localidade !== undefined ? { localidade: data.localidade } : {}),
      },
      create: {
        userId,
        ...profilePayload,
        workCountry: data.workCountry ?? 'PT',
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
      comprovativoCartaoCidadao: '',
      comprovativoIban: '',
      comprovativoCartaoContinente: '',
    };

    const BR_ONLY_FIELDS = {
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

    // Clear codigoPostal when moving to BR - CEP format is different, avoid stale PT postal code
    const extraClean = newCountry === 'BR' ? { codigoPostal: '' } : {};

    await prisma.profile.update({
      where: { userId },
      data: { ...fieldsToClean, ...extraClean },
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

  await prisma.user.delete({ where: { id: userId } });

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
    const personalEmail = normalizeTextField(data.personalEmail).toLowerCase();
    const workCountry = data.workCountry;
    const brWorkState = workCountry === 'BR' ? (data.brWorkState ?? null) : null;

    const existingActiveAdmission = await prisma.employeeAdmission.findFirst({
      where: {
        personalEmail,
        status: { in: ['INVITED', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED_PENDING_CONTRACT'] },
      },
      select: { id: true },
    });

    if (existingActiveAdmission) {
      return res.status(409).json({ message: 'Já existe um processo de admissão ativo para este email pessoal.' });
    }

    const token = buildAdmissionToken();
    const invitationLink = buildFrontendAdmissionUrl(token);
    const admission = await prisma.employeeAdmission.create({
      data: {
        fullName: normalizeTextField(data.fullName).replace(/\s+/g, ' '),
        personalEmail,
        workCountry,
        brWorkState,
        personalData: buildEmptyAdmissionPersonalData({
          fullName: normalizeTextField(data.fullName).replace(/\s+/g, ' '),
          personalEmail,
          workCountry,
          brWorkState,
        }) as Prisma.InputJsonValue,
        submissionTokenHash: hashAdmissionToken(token),
        tokenExpiresAt: getAdmissionExpiryDate(),
        lastInvitationSentAt: new Date(),
        invitedById: req.authUser!.id,
      },
      select: {
        id: true,
        fullName: true,
        personalEmail: true,
        workCountry: true,
        brWorkState: true,
        status: true,
        tokenExpiresAt: true,
      },
    });

    await sendAdmissionInviteEmail({
      personalEmail,
      fullName: admission.fullName,
      invitationLink,
    });

    return res.status(201).json({
      ...admission,
      invitationLinkPreview: process.env.NODE_ENV === 'production' ? undefined : invitationLink,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users/admissions/public/:token', async (req, res) => {
  try {
    const admission = await resolveAdmissionByTokenOrThrow(String(req.params.token));

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
    });
  } catch (error) {
    return res.status(404).json({ message: error instanceof Error ? error.message : 'Convite não encontrado.' });
  }
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
    const validationErrors = validateEmployeeAdmissionPersonalData(normalized, admission.workCountry);
    if (validationErrors.length > 0) {
      return res.status(400).json({ message: validationErrors[0] });
    }

    await prisma.employeeAdmission.update({
      where: { id: admission.id },
      data: {
        personalData: normalized as Prisma.InputJsonValue,
        status: 'SUBMITTED',
        reviewReason: '',
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedById: null,
      },
    });

    const reviewerIds = await resolveAdmissionReviewersByCountry(admission.workCountry);
    await notifyUsers(prisma, reviewerIds, 'Novo pedido de admissão', [
      `${admission.fullName} submeteu a ficha de admissão e está pronto para revisão.`,
      `País: ${admission.workCountry === 'BR' ? 'Brasil' : 'Portugal'}${admission.brWorkState ? ` (${admission.brWorkState})` : ''}`,
      `Email pessoal: ${admission.personalEmail}`,
      `ação: Abrir admissões|/admissoes`,
    ].join('\n'));

    return res.json({ success: true, message: 'Ficha submetida para revisão RH.' });
  } catch (error) {
    if (error instanceof Error && /Convite|expirou|disponível/.test(error.message)) {
      return res.status(404).json({ message: error.message });
    }
    return next(error);
  }
});

router.get('/users/admissions/review', requireAuth, async (req, res) => {
  const canReview = req.authUser!.isRootAccess || await hasPermission(req.authUser!.id, 'approve_profile_change');
  if (!canReview) {
    return res.status(403).json({ message: 'Sem permissões para consultar admissões.' });
  }

  const actorProfile = await prisma.profile.findUnique({ where: { userId: req.authUser!.id }, select: { workCountry: true } });
  const rows = await prisma.employeeAdmission.findMany({
    where: {
      status: { in: ['SUBMITTED', 'APPROVED_PENDING_CONTRACT'] },
      ...(req.authUser!.isRootAccess ? {} : { workCountry: actorProfile?.workCountry ?? 'PT' }),
    },
    orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      invitedBy: { select: { id: true, username: true, email: true, profile: { select: { nomeAbreviado: true, nomeCompleto: true } } } },
      reviewedBy: { select: { id: true, username: true, email: true, profile: { select: { nomeAbreviado: true, nomeCompleto: true } } } },
    },
  });

  return res.json(rows);
});

router.post('/users/admissions/:id/request-correction', requireAuth, async (req, res, next) => {
  try {
    const canReview = req.authUser!.isRootAccess || await hasPermission(req.authUser!.id, 'approve_profile_change');
    if (!canReview) {
      return res.status(403).json({ message: 'Sem permissões para devolver admissões.' });
    }

    const payload = employeeAdmissionCorrectionSchema.parse(req.body);
    const admission = await prisma.employeeAdmission.findUnique({ where: { id: String(req.params.id) } });
    if (!admission) {
      return res.status(404).json({ message: 'Pedido de admissão não encontrado.' });
    }

    const canReviewCountry = await canActorReviewAdmissionCountry(req.authUser!, admission.workCountry as 'PT' | 'BR');
    if (!canReviewCountry) {
      return res.status(403).json({ message: 'Sem permissões para devolver admissões deste país.' });
    }

    const token = buildAdmissionToken();
    const invitationLink = buildFrontendAdmissionUrl(token);
    await prisma.employeeAdmission.update({
      where: { id: admission.id },
      data: {
        status: 'CHANGES_REQUESTED',
        reviewReason: payload.reason,
        reviewedAt: new Date(),
        reviewedById: req.authUser!.id,
        submissionTokenHash: hashAdmissionToken(token),
        tokenExpiresAt: getAdmissionExpiryDate(),
        lastInvitationSentAt: new Date(),
      },
    });

    await sendAdmissionInviteEmail({
      personalEmail: admission.personalEmail,
      fullName: admission.fullName,
      invitationLink,
      reviewReason: payload.reason,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/users/admissions/:id/approve-personal', requireAuth, async (req, res, next) => {
  try {
    const canReview = req.authUser!.isRootAccess || await hasPermission(req.authUser!.id, 'approve_profile_change');
    if (!canReview) {
      return res.status(403).json({ message: 'Sem permissões para aprovar admissões.' });
    }

    const admission = await prisma.employeeAdmission.findUnique({ where: { id: String(req.params.id) } });
    if (!admission) {
      return res.status(404).json({ message: 'Pedido de admissão não encontrado.' });
    }

    const canReviewCountry = await canActorReviewAdmissionCountry(req.authUser!, admission.workCountry as 'PT' | 'BR');
    if (!canReviewCountry) {
      return res.status(403).json({ message: 'Sem permissões para aprovar admissões deste país.' });
    }

    if (admission.status !== 'SUBMITTED') {
      return res.status(409).json({ message: 'Este pedido não está pronto para aprovação dos dados pessoais.' });
    }

    await prisma.employeeAdmission.update({
      where: { id: admission.id },
      data: {
        status: 'APPROVED_PENDING_CONTRACT',
        reviewReason: '',
        reviewedAt: new Date(),
        reviewedById: req.authUser!.id,
      },
    });

    await notifyUsers(prisma, [req.authUser!.id], 'Admissão pronta para contrato', [
      `Os dados pessoais de ${admission.fullName} foram aprovados.`,
      'Passo seguinte: preencher dados contratuais e criar o utilizador.',
      `ação: Abrir admissões|/admissoes`,
    ].join('\n'));
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/users/admissions/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const canReview = req.authUser!.isRootAccess || await hasPermission(req.authUser!.id, 'approve_profile_change');
    if (!canReview) {
      return res.status(403).json({ message: 'Sem permissões para concluir admissões.' });
    }

    const admission = await prisma.employeeAdmission.findUnique({ where: { id: String(req.params.id) } });
    if (!admission) {
      return res.status(404).json({ message: 'Pedido de admissão não encontrado.' });
    }

    const canReviewCountry = await canActorReviewAdmissionCountry(req.authUser!, admission.workCountry as 'PT' | 'BR');
    if (!canReviewCountry) {
      return res.status(403).json({ message: 'Sem permissões para concluir admissões deste país.' });
    }

    if (admission.status !== 'APPROVED_PENDING_CONTRACT') {
      return res.status(409).json({ message: 'Os dados pessoais ainda não foram aprovados para este pedido.' });
    }

    const contract = employeeAdmissionContractSchema.parse(req.body);
    const createdUser = await createManagedUser({
      actorUserId: req.authUser!.id,
      username: contract.companyUsername,
      email: contract.companyEmail,
      fullName: admission.fullName,
      role: 'COLABORADOR',
      workCountry: admission.workCountry,
      profile: {
        ...((admission.personalData as Record<string, unknown>) ?? {}),
        cargo: contract.cargo,
        categoriaProfissional: contract.categoriaProfissional,
        numeroMecanografico: contract.numeroMecanografico,
        funcao: contract.funcao,
        dataInicioContrato: contract.dataInicioContrato,
        dataFimContrato: contract.dataFimContrato,
        tipoContrato: contract.tipoContrato,
        regimeHorario: contract.regimeHorario,
        workCountry: admission.workCountry,
        brWorkState: admission.brWorkState,
      },
    });

    await prisma.employeeAdmission.update({
      where: { id: admission.id },
      data: {
        status: 'COMPLETED',
        companyEmail: contract.companyEmail.trim().toLowerCase(),
        companyUsername: contract.companyUsername.trim().toLowerCase(),
        contractData: contract as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        completedById: req.authUser!.id,
      },
    });

    await sendTransactionalEmail({
      to: admission.personalEmail,
      subject: 'Smarter Hub · admissão concluída',
      text: [
        `Olá ${admission.fullName},`,
        '',
        'O teu processo de admissão foi concluído com sucesso.',
        `Username criado: ${contract.companyUsername.trim().toLowerCase()}`,
        `Email da empresa: ${contract.companyEmail.trim().toLowerCase()}`,
        '',
        'A autenticação no Smarter Hub segue a política definida pela empresa (Microsoft SSO ou credenciais geridas por RH).',
      ].join('\n'),
    });

    return res.status(201).json(createdUser);
  } catch (error) {
    return next(error);
  }
});

// ── LIST ALL ADMISSIONS (for RH / admin review page) ──────────────────────────
router.get('/users/admissions/list', requireAuth, async (req, res) => {
  const canView = req.authUser!.isRootAccess || await hasPermission(req.authUser!.id, 'approve_profile_change');
  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para consultar admissões.' });
  }

  const actorProfile = await prisma.profile.findUnique({ where: { userId: req.authUser!.id }, select: { workCountry: true } });
  const countryFilter = req.authUser!.isRootAccess ? {} : { workCountry: actorProfile?.workCountry ?? 'PT' };

  const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
  const statusValidation = rawStatus ? employeeAdmissionStatusSchema.safeParse(rawStatus) : null;
  if (statusValidation && !statusValidation.success) {
    return res.status(400).json({ message: 'Parâmetro status inválido.' });
  }

  const statusFilter = statusValidation
    ? { status: statusValidation.data as EmployeeAdmissionStatus }
    : {};

  const pageRaw = typeof req.query.page === 'string' ? req.query.page.trim() : '1';
  const pageSizeRaw = typeof req.query.pageSize === 'string' ? req.query.pageSize.trim() : '50';
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(pageSizeRaw)) {
    return res.status(400).json({ message: 'Parâmetros de paginação inválidos.' });
  }

  const page = Math.max(1, Number(pageRaw));
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw)));

  const where = { ...countryFilter, ...statusFilter };

  const [total, rows] = await Promise.all([
    prisma.employeeAdmission.count({ where }),
    prisma.employeeAdmission.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        invitedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
        reviewedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
        completedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
      },
    }),
  ]);

  return res.json({ total, page, pageSize, rows });
});

// ── GET SINGLE ADMISSION DETAIL ──────────────────────────────────────────────
router.get('/users/admissions/:id', requireAuth, async (req, res) => {
  const canView = req.authUser!.isRootAccess || await hasPermission(req.authUser!.id, 'approve_profile_change');
  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para consultar admissões.' });
  }

  const admission = await prisma.employeeAdmission.findUnique({
    where: { id: String(req.params.id) },
    include: {
      invitedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
      reviewedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
      completedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
    },
  });

  if (!admission) {
    return res.status(404).json({ message: 'Admissão não encontrada.' });
  }

  const actorProfile = await prisma.profile.findUnique({ where: { userId: req.authUser!.id }, select: { workCountry: true } });
  if (!req.authUser!.isRootAccess && admission.workCountry !== actorProfile?.workCountry) {
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

export { router as usersRouter };
