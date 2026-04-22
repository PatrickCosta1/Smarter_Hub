import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getApiBase, getBackendBase, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';
import { estadoCivilOptions, generoOptions, habilitacoesOptions, irsJovemOptions, parentescoOptions, regimeHorarioOptions, situacaoIrsOptions, tipoContratoOptions } from '../portal/data';
import { formatRoleLabel } from '../portal/labels';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import Toast from '../components/ui/Toast';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';
const PERMISSION_CATEGORIES = ['SYSTEM', 'USERS', 'TEAMS', 'VACATIONS', 'TRAININGS', 'PROFILE', 'RECEIPTS', 'NOTIFICATIONS'] as const;
type PermissionCategory = typeof PERMISSION_CATEGORIES[number];

type CollaboratorRow = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId?: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  updatedAt: string;
  team?: { id: string; name: string } | null;
  teamRole?: 'LEADER' | 'MEMBER' | null;
  managedTeams?: Array<{ id: string; name: string }>;
  teamMemberships?: Array<{
    teamId: string;
    team?: { id: string; name: string } | null;
  }>;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
    dataNascimento?: string;
    genero?: string;
    estadoCivil?: string;
    habilitacoesLiterarias?: string;
    curso?: string;
    faculdade?: string;
    nacionalidade?: string;
    emailPessoal?: string;
    telemovel?: string;
    githubUser?: string;
    moradaFiscal?: string;
    endereco?: string;
    cargo?: string;
    funcao?: string;
    codigoPostal?: string;
    matriculaCarro?: string;
    cartaoCidadao?: string;
    validadeCartaoCidadao?: string;
    nif?: string;
    niss?: string;
    iban?: string;
    situacaoIrs?: string;
    numeroDependentes?: string;
    irsJovem?: string;
    anoPrimeiroDesconto?: string;
    numeroCartaoContinente?: string;
    voucherNosData?: string;
    comprovativoMoradaFiscal?: string;
    comprovativoCartaoCidadao?: string;
    comprovativoIban?: string;
    comprovativoCartaoContinente?: string;
    contactoEmergenciaNome?: string;
    contactoEmergenciaParentesco?: string;
    contactoEmergenciaNumero?: string;
    dataInicioContrato?: string;
    dataFimContrato?: string;
    tipoContrato?: string;
    regimeHorario?: string;
    workCountry?: 'PT' | 'BR';
    localidade?: string;
  } | null;
};

type CollaboratorEditDraft = {
  role: CollaboratorRow['role'];
  teamId: string;
  isActive: boolean;
  workCountry: 'PT' | 'BR';
  nomeCompleto: string;
  nomeAbreviado: string;
  dataNascimento: string;
  genero: string;
  estadoCivil: string;
  habilitacoesLiterarias: string;
  curso: string;
  faculdade: string;
  nacionalidade: string;
  emailPessoal: string;
  telemovel: string;
  githubUser: string;
  moradaFiscal: string;
  endereco: string;
  localidade: string;
  codigoPostal: string;
  matriculaCarro: string;
  cartaoCidadao: string;
  validadeCartaoCidadao: string;
  nif: string;
  niss: string;
  iban: string;
  situacaoIrs: string;
  numeroDependentes: string;
  irsJovem: string;
  anoPrimeiroDesconto: string;
  numeroCartaoContinente: string;
  voucherNosData: string;
  comprovativoMoradaFiscal: string;
  comprovativoCartaoCidadao: string;
  comprovativoIban: string;
  comprovativoCartaoContinente: string;
  contactoEmergenciaNome: string;
  contactoEmergenciaParentesco: string;
  contactoEmergenciaNumero: string;
  cargo: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
};

function resolveStatusTone(message: string): 'success' | 'error' | 'info' {
  const normalized = message.toLowerCase();
  if (normalized.includes('falha') || normalized.includes('erro') || normalized.includes('não foi possível')) {
    return 'error';
  }

  if (normalized.includes('sucesso') || normalized.includes('atualiz') || normalized.includes('adicion') || normalized.includes('removid') || normalized.includes('reativad') || normalized.includes('desativad')) {
    return 'success';
  }

  return 'info';
}

const EDIT_PROFILE_FIELDS: Array<{ key: keyof CollaboratorEditDraft; label: string; section: 'identificacao' | 'contactos' | 'fiscal' | 'emergencia' | 'contrato' }> = [
  { key: 'nomeCompleto', label: 'Nome completo', section: 'identificacao' },
  { key: 'nomeAbreviado', label: 'Nome abreviado', section: 'identificacao' },
  { key: 'dataNascimento', label: 'Data de nascimento', section: 'identificacao' },
  { key: 'genero', label: 'Género', section: 'identificacao' },
  { key: 'estadoCivil', label: 'Estado civil', section: 'identificacao' },
  { key: 'habilitacoesLiterarias', label: 'Habilitações literárias', section: 'identificacao' },
  { key: 'curso', label: 'Curso', section: 'identificacao' },
  { key: 'faculdade', label: 'Faculdade', section: 'identificacao' },
  { key: 'nacionalidade', label: 'Nacionalidade', section: 'identificacao' },
  { key: 'emailPessoal', label: 'Email pessoal', section: 'contactos' },
  { key: 'telemovel', label: 'Telemóvel', section: 'contactos' },
  { key: 'githubUser', label: 'GitHub', section: 'contactos' },
  { key: 'moradaFiscal', label: 'Morada fiscal', section: 'contactos' },
  { key: 'endereco', label: 'Morada habitual', section: 'contactos' },
  { key: 'localidade', label: 'Localidade', section: 'contactos' },
  { key: 'codigoPostal', label: 'Código postal', section: 'contactos' },
  { key: 'matriculaCarro', label: 'Matrícula do carro', section: 'fiscal' },
  { key: 'cartaoCidadao', label: 'Cartão de cidadão', section: 'fiscal' },
  { key: 'validadeCartaoCidadao', label: 'Validade cartão de cidadão', section: 'fiscal' },
  { key: 'nif', label: 'NIF', section: 'fiscal' },
  { key: 'niss', label: 'NISS', section: 'fiscal' },
  { key: 'iban', label: 'IBAN', section: 'fiscal' },
  { key: 'situacaoIrs', label: 'Situação IRS', section: 'fiscal' },
  { key: 'numeroDependentes', label: 'Número de dependentes', section: 'fiscal' },
  { key: 'irsJovem', label: 'IRS jovem', section: 'fiscal' },
  { key: 'anoPrimeiroDesconto', label: 'Ano do primeiro desconto', section: 'fiscal' },
  { key: 'numeroCartaoContinente', label: 'Cartão Continente', section: 'fiscal' },
  { key: 'voucherNosData', label: 'Voucher NOS data', section: 'fiscal' },
  { key: 'comprovativoMoradaFiscal', label: 'Comprovativo morada fiscal', section: 'fiscal' },
  { key: 'comprovativoCartaoCidadao', label: 'Comprovativo cartão de cidadão', section: 'fiscal' },
  { key: 'comprovativoIban', label: 'Comprovativo IBAN', section: 'fiscal' },
  { key: 'comprovativoCartaoContinente', label: 'Comprovativo cartão Continente', section: 'fiscal' },
  { key: 'contactoEmergenciaNome', label: 'Nome contacto emergência', section: 'emergencia' },
  { key: 'contactoEmergenciaParentesco', label: 'Parentesco contacto emergência', section: 'emergencia' },
  { key: 'contactoEmergenciaNumero', label: 'Número contacto emergência', section: 'emergencia' },
  { key: 'cargo', label: 'Cargo', section: 'contrato' },
  { key: 'funcao', label: 'Função', section: 'contrato' },
  { key: 'dataInicioContrato', label: 'Data início contrato', section: 'contrato' },
  { key: 'dataFimContrato', label: 'Data fim contrato', section: 'contrato' },
  { key: 'tipoContrato', label: 'Tipo contrato', section: 'contrato' },
  { key: 'regimeHorario', label: 'Regime horário', section: 'contrato' },
];

const EMPTY_EDIT_DRAFT: CollaboratorEditDraft = {
  role: 'COLABORADOR',
  teamId: '',
  isActive: true,
  workCountry: 'PT',
  nomeCompleto: '',
  nomeAbreviado: '',
  dataNascimento: '',
  genero: '',
  estadoCivil: '',
  habilitacoesLiterarias: '',
  curso: '',
  faculdade: '',
  nacionalidade: '',
  emailPessoal: '',
  telemovel: '',
  githubUser: '',
  moradaFiscal: '',
  endereco: '',
  localidade: '',
  codigoPostal: '',
  matriculaCarro: '',
  cartaoCidadao: '',
  validadeCartaoCidadao: '',
  nif: '',
  niss: '',
  iban: '',
  situacaoIrs: '',
  numeroDependentes: '',
  irsJovem: '',
  anoPrimeiroDesconto: '',
  numeroCartaoContinente: '',
  voucherNosData: '',
  comprovativoMoradaFiscal: '',
  comprovativoCartaoCidadao: '',
  comprovativoIban: '',
  comprovativoCartaoContinente: '',
  contactoEmergenciaNome: '',
  contactoEmergenciaParentesco: '',
  contactoEmergenciaNumero: '',
  cargo: '',
  funcao: '',
  dataInicioContrato: '',
  dataFimContrato: '',
  tipoContrato: '',
  regimeHorario: '',
};

const CARGO_OPTIONS = [
  'Trainee',
  'Junior',
  'Associate',
  'Senior',
  'Lead',
  'Principal',
  'Director',
  'C Level',
];

const FUNCAO_OPTIONS = [
  'Administrative Assistant',
  'Business Analyst',
  'Business Consultant',
  'Business Controller',
  'CEO',
  'Communication Manager',
  'Communication Specialist',
  'Data Analyst',
  'Data Engineer',
  'Data Science Manager',
  'Data Scientist',
  'Delivery Director',
  'Delivery Manager',
  'DevOps Engineer',
  'DevOps Manager',
  'Estagiario',
  'Managing Director',
  'Operations & Control Director',
  'Operations & Control Manager',
  'People Director',
  'People Manager',
  'People Partner',
  'Pre-Sales Consultant',
  'Product Architect',
  'Product Director',
  'Product Manager',
  'Product Owner',
  'Project Manager',
  'Quality Analyst',
  'Quality Manager',
  'Sales Consultant',
  'Sales Director',
  'Sales Manager',
  'Scrum Master',
  'Service Analyst',
  'Service Director',
  'Service Engineer',
  'Service Manager',
  'Software Developer',
  'Software Engineer',
  'Strategic Solutions Consultant',
  'Technical Consultant',
  'UX UI Designer',
];

function buildEditDraftFromRow(item: CollaboratorRow): CollaboratorEditDraft {
  const profile = item.profile || {};
  return {
    role: item.role,
    teamId: item.teamId || '',
    isActive: item.isActive,
    workCountry: profile.workCountry || 'PT',
    nomeCompleto: profile.nomeCompleto || '',
    nomeAbreviado: profile.nomeAbreviado || '',
    dataNascimento: profile.dataNascimento || '',
    genero: profile.genero || '',
    estadoCivil: profile.estadoCivil || '',
    habilitacoesLiterarias: profile.habilitacoesLiterarias || '',
    curso: profile.curso || '',
    faculdade: profile.faculdade || '',
    nacionalidade: profile.nacionalidade || '',
    emailPessoal: profile.emailPessoal || '',
    telemovel: profile.telemovel || '',
    githubUser: profile.githubUser || '',
    moradaFiscal: profile.moradaFiscal || '',
    endereco: profile.endereco || '',
    localidade: profile.localidade || '',
    codigoPostal: profile.codigoPostal || '',
    matriculaCarro: profile.matriculaCarro || '',
    cartaoCidadao: profile.cartaoCidadao || '',
    validadeCartaoCidadao: profile.validadeCartaoCidadao || '',
    nif: profile.nif || '',
    niss: profile.niss || '',
    iban: profile.iban || '',
    situacaoIrs: profile.situacaoIrs || '',
    numeroDependentes: profile.numeroDependentes || '',
    irsJovem: profile.irsJovem || '',
    anoPrimeiroDesconto: profile.anoPrimeiroDesconto || '',
    numeroCartaoContinente: profile.numeroCartaoContinente || '',
    voucherNosData: profile.voucherNosData || '',
    comprovativoMoradaFiscal: profile.comprovativoMoradaFiscal || '',
    comprovativoCartaoCidadao: profile.comprovativoCartaoCidadao || '',
    comprovativoIban: profile.comprovativoIban || '',
    comprovativoCartaoContinente: profile.comprovativoCartaoContinente || '',
    contactoEmergenciaNome: profile.contactoEmergenciaNome || '',
    contactoEmergenciaParentesco: profile.contactoEmergenciaParentesco || '',
    contactoEmergenciaNumero: profile.contactoEmergenciaNumero || '',
    cargo: profile.cargo || '',
    funcao: profile.funcao || '',
    dataInicioContrato: profile.dataInicioContrato || '',
    dataFimContrato: profile.dataFimContrato || '',
    tipoContrato: profile.tipoContrato || '',
    regimeHorario: profile.regimeHorario || '',
  };
}

function getCollaboratorTeamInfo(item: CollaboratorRow) {
  const resolvedTeam = getCollaboratorTeams(item)[0] ?? null;

  if (!resolvedTeam) {
    return { name: '-', isLeader: false };
  }

  return { name: resolvedTeam.name, isLeader: resolvedTeam.isLeader };
}

function getCollaboratorPrimaryTeam(item: CollaboratorRow) {
  return getCollaboratorTeams(item)[0] ?? null;
}

function getCollaboratorTeams(item: CollaboratorRow) {
  const teamMap = new Map<string, { id: string; name: string; isLeader: boolean; isPrimary: boolean }>();
  const managedTeamIds = new Set((item.managedTeams || []).map((team) => team.id));

  const upsertTeam = (team: { id: string; name: string }, options?: { isLeader?: boolean; isPrimary?: boolean }) => {
    const existing = teamMap.get(team.id);
    if (!existing) {
      teamMap.set(team.id, {
        id: team.id,
        name: team.name,
        isLeader: Boolean(options?.isLeader),
        isPrimary: Boolean(options?.isPrimary),
      });
      return;
    }

    teamMap.set(team.id, {
      ...existing,
      isLeader: existing.isLeader || Boolean(options?.isLeader),
      isPrimary: existing.isPrimary || Boolean(options?.isPrimary),
    });
  };

  if (item.team?.id && item.team.name) {
    upsertTeam(item.team, {
      isPrimary: true,
      isLeader: item.teamRole === 'LEADER' || managedTeamIds.has(item.team.id),
    });
  }

  for (const membership of item.teamMemberships || []) {
    if (!membership.team?.id || !membership.team.name) {
      continue;
    }

    upsertTeam(membership.team, {
      isPrimary: item.teamId === membership.team.id,
      isLeader: managedTeamIds.has(membership.team.id),
    });
  }

  for (const managedTeam of item.managedTeams || []) {
    upsertTeam(managedTeam, {
      isPrimary: item.teamId === managedTeam.id,
      isLeader: true,
    });
  }

  return Array.from(teamMap.values()).sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) {
      return a.isPrimary ? -1 : 1;
    }
    if (a.isLeader !== b.isLeader) {
      return a.isLeader ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'pt-PT');
  });
}

type CollaboratorsResponse = {
  total: number;
  page: number;
  pageSize: number;
  rows: CollaboratorRow[];
};

type PermissionGrantUser = {
  id: string;
  username: string;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
  } | null;
};

type PermissionAssignment = {
  isEnabled: boolean;
  restrictedToTeams: string[];
  restrictedToCountries: Array<'PT' | 'BR'>;
  restrictedToLevels: string[];
  customRestrictions: unknown;
  notes: string | null;
  grantedBy?: PermissionGrantUser | null;
};

type PermissionItem = {
  id: string;
  code: string;
  label: string;
  description: string;
  category: PermissionCategory;
  assignment: PermissionAssignment | null;
};

type UserPermissionsResponse = {
  user: {
    id: string;
    username: string;
    email: string;
    isActive: boolean;
    isRootAccess: boolean;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  };
  accessTotal: boolean;
  permissions: PermissionItem[];
};

type CollaboratorDetailsCacheEntry = {
  selectedPermissions: PermissionItem[];
  selectedUserAccessTotal: boolean;
  permissionTeams: TeamOption[];
  customCargoOptions: CustomProfileOption[];
  customFuncaoOptions: CustomProfileOption[];
};

type TeamOption = {
  id: string;
  name: string;
};

type CollaboratorImportProfile = Partial<Record<Exclude<keyof CollaboratorEditDraft, 'role' | 'teamId' | 'isActive' | 'workCountry' | 'nomeCompleto'>, string>>;

type CollaboratorImportRow = {
  rowNumber: number;
  fullName: string;
  username: string;
  email: string;
  workCountry: 'PT' | 'BR';
  teamName: string;
  subTeamName: string;
  profile: CollaboratorImportProfile;
};

type CollaboratorImportIssue = {
  rowNumber: number;
  message: string;
};

type CollaboratorImportResultItem = {
  rowNumber: number;
  fullName: string;
  username: string;
  email: string;
  status: 'CREATED' | 'FAILED';
  message: string;
};

type CollaboratorImportResponse = {
  createdCount: number;
  failedCount: number;
  results: CollaboratorImportResultItem[];
};

type CustomProfileOption = {
  id: string;
  label: string;
  groupLabel?: string | null;
};

type PermissionDraft = {
  enabled: boolean;
  restrictedToTeams: string;
  restrictedToCountries: string;
  restrictedToLevels: string;
  customRestrictions: string;
  notes: string;
};

const EMPTY_PERMISSION_DRAFT: PermissionDraft = {
  enabled: false,
  restrictedToTeams: '',
  restrictedToCountries: '',
  restrictedToLevels: '',
  customRestrictions: '',
  notes: '',
};

const IMPORT_PROFILE_FIELD_KEYS = EDIT_PROFILE_FIELDS
  .filter((field) => field.key !== 'nomeCompleto'
    && field.key !== 'comprovativoMoradaFiscal'
    && field.key !== 'comprovativoCartaoCidadao'
    && field.key !== 'comprovativoIban'
    && field.key !== 'comprovativoCartaoContinente')
  .map((field) => field.key) as Array<Exclude<keyof CollaboratorEditDraft, 'role' | 'teamId' | 'isActive' | 'workCountry' | 'nomeCompleto'>>;

const IMPORT_FILE_ACCEPT = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

const IMPORT_TEMPLATE_FIELDS: Array<{ key: string; label: string; required?: boolean; example: string; aliases?: string[]; dropdownKey?: string }> = [
  { key: 'fullName', label: 'Nome completo', required: true, example: '', aliases: ['nomecompleto', 'fullname', 'nome'] },
  { key: 'username', label: 'Username', required: true, example: '', aliases: ['utilizador'] },
  { key: 'email', label: 'Email', required: true, example: '', aliases: ['emaillogin'] },
  { key: 'workCountry', label: 'País de trabalho', example: '', aliases: ['paisdetrabalho', 'workcountry', 'pais'], dropdownKey: 'workCountry' },
  { key: 'teamName', label: 'Equipa principal', example: '', aliases: ['equipa', 'team', 'teamname'], dropdownKey: 'teamName' },
  { key: 'subTeamName', label: 'Subequipa', example: '', aliases: ['subequipa', 'subteam', 'subteamname'], dropdownKey: 'subTeamName' },
  ...EDIT_PROFILE_FIELDS
    .filter((field) => field.key !== 'nomeCompleto'
      && field.key !== 'comprovativoMoradaFiscal'
      && field.key !== 'comprovativoCartaoCidadao'
      && field.key !== 'comprovativoIban'
      && field.key !== 'comprovativoCartaoContinente')
    .map((field) => ({
      key: field.key,
      label: field.label,
      example: '',
      aliases: [field.key],
      dropdownKey:
        field.key === 'genero' ? 'genero'
        : field.key === 'estadoCivil' ? 'estadoCivil'
        : field.key === 'habilitacoesLiterarias' ? 'habilitacoesLiterarias'
        : field.key === 'situacaoIrs' ? 'situacaoIrs'
        : field.key === 'irsJovem' ? 'irsJovem'
        : field.key === 'contactoEmergenciaParentesco' ? 'contactoEmergenciaParentesco'
        : field.key === 'tipoContrato' ? 'tipoContrato'
        : field.key === 'regimeHorario' ? 'regimeHorario'
        : field.key === 'cargo' ? 'cargo'
        : field.key === 'funcao' ? 'funcao'
        : undefined,
    })),
];

const IMPORT_FIELD_TARGETS = new Map<string, string>(
  IMPORT_TEMPLATE_FIELDS.flatMap((field) => {
    const candidates = [field.label, field.key, ...(field.aliases ?? [])];
    return candidates.map((candidate) => [normalizeImportHeader(candidate), field.key] as const);
  }),
);

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

function normalizeImportHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeImportText(value: string) {
  return value.replace(/^\uFEFF/, '').trim();
}

function toExcelColumnLetter(columnNumber: number) {
  let current = columnNumber;
  let result = '';
  while (current > 0) {
    const modulo = (current - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    current = Math.floor((current - modulo) / 26);
  }
  return result;
}

function toExcelDefinedName(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const fallback = normalized || 'TEAM';
  return `SUBTEAM_${fallback}`;
}

let excelJsModulePromise: Promise<any> | null = null;

async function loadExcelJsWorkbook() {
  if (!excelJsModulePromise) {
    excelJsModulePromise = (async () => {
      try {
        const browserEntry = 'exceljs/dist/exceljs.min.js';
        const browserModule = await import(/* @vite-ignore */ browserEntry);
        return browserModule.default ?? browserModule;
      } catch {
        const defaultModule = await import('exceljs');
        return defaultModule.default ?? defaultModule;
      }
    })();
  }

  return excelJsModulePromise;
}

function readSpreadsheetCellValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  if (typeof value === 'object') {
    const cell = value as {
      text?: string;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
    };

    if (typeof cell.text === 'string') {
      return cell.text.trim();
    }
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((item) => item.text ?? '').join('').trim();
    }
    if (cell.result != null) {
      return readSpreadsheetCellValue(cell.result);
    }
    if (typeof cell.hyperlink === 'string') {
      return cell.hyperlink.trim();
    }
  }

  return String(value).trim();
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((item) => normalizeImportText(item));
}

function parseDelimitedText(text: string) {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [] as string[][];
  }

  const firstLine = lines[0];
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

function createEmptyImportRow(rowNumber: number): CollaboratorImportRow {
  return {
    rowNumber,
    fullName: '',
    username: '',
    email: '',
    workCountry: 'PT',
    teamName: '',
    subTeamName: '',
    profile: {},
  };
}

function assignImportField(row: CollaboratorImportRow, targetKey: string, value: string) {
  if (!value) {
    return;
  }

  switch (targetKey) {
    case 'fullName':
      row.fullName = value.replace(/\s+/g, ' ').trim();
      return;
    case 'username':
      row.username = value.trim().toLowerCase();
      return;
    case 'email':
      row.email = value.trim().toLowerCase();
      return;
    case 'workCountry':
      row.workCountry = value.trim().toUpperCase() === 'BR' ? 'BR' : 'PT';
      return;
    case 'teamName':
      row.teamName = value.trim();
      return;
    case 'subTeamName':
      row.subTeamName = value.trim();
      return;
    default:
      if (IMPORT_PROFILE_FIELD_KEYS.includes(targetKey as Exclude<keyof CollaboratorEditDraft, 'role' | 'teamId' | 'isActive' | 'workCountry' | 'nomeCompleto'>)) {
        row.profile[targetKey as keyof CollaboratorImportProfile] = value.trim();
      }
  }
}

function validateImportRows(rows: CollaboratorImportRow[]) {
  const issues: CollaboratorImportIssue[] = [];
  const usernameCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();

  const onlyDigits = (value: string) => value.replace(/\D/g, '');

  const isValidIsoDate = (value: string) => {
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
  };

  const isValidNif = (value: string) => {
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
  };

  const isValidNiss = (value: string) => {
    const digits = onlyDigits(value);
    return /^\d{11}$/.test(digits);
  };

  const normalizeIban = (value: string) => value.replace(/\s+/g, '').toUpperCase();

  const isValidIban = (value: string) => {
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
  };

  const isValidPhone = (value: string) => {
    const compact = value.replace(/[\s().-]/g, '');
    if (!/^\+?\d+$/.test(compact)) {
      return false;
    }
    const digits = compact.replace(/^\+/, '');
    return digits.length >= 9 && digits.length <= 15;
  };

  const isNonNegativeInteger = (value: string) => /^\d+$/.test(value);

  const isReasonableYear = (value: string) => {
    if (!/^\d{4}$/.test(value)) {
      return false;
    }
    const year = Number(value);
    const currentYear = new Date().getFullYear();
    return year >= 1900 && year <= currentYear + 1;
  };

  for (const row of rows) {
    if (row.username) {
      usernameCounts.set(row.username, (usernameCounts.get(row.username) ?? 0) + 1);
    }
    if (row.email) {
      emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1);
    }
  }

  for (const row of rows) {
    if (!row.fullName) {
      issues.push({ rowNumber: row.rowNumber, message: 'Nome completo em falta.' });
    }
    if (!row.username) {
      issues.push({ rowNumber: row.rowNumber, message: 'Username em falta.' });
    }
    if (!row.email) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email em falta.' });
    }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email inválido.' });
    }
    if ((usernameCounts.get(row.username) ?? 0) > 1) {
      issues.push({ rowNumber: row.rowNumber, message: 'Username duplicado no ficheiro.' });
    }
    if ((emailCounts.get(row.email) ?? 0) > 1) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email duplicado no ficheiro.' });
    }

    const profile = row.profile;

    if (profile.nif && !isValidNif(profile.nif)) {
      issues.push({ rowNumber: row.rowNumber, message: 'NIF inválido. Deve conter 9 dígitos válidos.' });
    }

    if (profile.niss && !isValidNiss(profile.niss)) {
      issues.push({ rowNumber: row.rowNumber, message: 'NISS inválido. Deve conter 11 dígitos.' });
    }

    if (profile.iban && !isValidIban(profile.iban)) {
      issues.push({ rowNumber: row.rowNumber, message: 'IBAN inválido.' });
    }

    if (profile.emailPessoal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailPessoal)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Email pessoal inválido.' });
    }

    if (profile.contactoEmergenciaNumero && !isValidPhone(profile.contactoEmergenciaNumero)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Contacto de emergência inválido.' });
    }

    if (profile.numeroDependentes && !isNonNegativeInteger(profile.numeroDependentes)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Número de dependentes inválido. Usa apenas dígitos.' });
    }

    if (profile.anoPrimeiroDesconto && !isReasonableYear(profile.anoPrimeiroDesconto)) {
      issues.push({ rowNumber: row.rowNumber, message: 'Ano primeiro desconto inválido. Usa formato AAAA.' });
    }

    const dateFields: Array<[keyof CollaboratorImportProfile, string]> = [
      ['dataNascimento', 'Data de nascimento'],
      ['validadeCartaoCidadao', 'Validade do cartão de cidadão'],
      ['voucherNosData', 'Data voucher NOS'],
      ['dataInicioContrato', 'Data início contrato'],
      ['dataFimContrato', 'Data fim contrato'],
    ];

    for (const [key, label] of dateFields) {
      const rawValue = profile[key];
      if (!rawValue) {
        continue;
      }
      if (!isValidIsoDate(rawValue)) {
        issues.push({ rowNumber: row.rowNumber, message: `${label} inválida. Usa formato YYYY-MM-DD.` });
      }
    }

    if (profile.dataInicioContrato && profile.dataFimContrato
      && isValidIsoDate(profile.dataInicioContrato)
      && isValidIsoDate(profile.dataFimContrato)
      && profile.dataFimContrato < profile.dataInicioContrato) {
      issues.push({ rowNumber: row.rowNumber, message: 'Data fim contrato não pode ser anterior à data início contrato.' });
    }
  }

  if (rows.length > 200) {
    issues.push({ rowNumber: 1, message: 'Máximo suportado por importação: 200 linhas.' });
  }

  return issues;
}

function buildImportRowsFromMatrix(matrix: string[][]) {
  if (matrix.length === 0) {
    return { rows: [] as CollaboratorImportRow[], issues: [{ rowNumber: 1, message: 'O ficheiro está vazio.' }] as CollaboratorImportIssue[] };
  }

  const findHeaderRowIndex = () => {
    for (let index = 0; index < matrix.length; index += 1) {
      const recognized = matrix[index]
        .map((header) => IMPORT_FIELD_TARGETS.get(normalizeImportHeader(header)) ?? '')
        .filter(Boolean).length;
      if (recognized >= 3) {
        return index;
      }
    }
    return -1;
  };

  const headerRowIndex = findHeaderRowIndex();
  if (headerRowIndex < 0) {
    return {
      rows: [] as CollaboratorImportRow[],
      issues: [{ rowNumber: 1, message: 'Não foi possível identificar a linha de cabeçalhos no ficheiro.' }] as CollaboratorImportIssue[],
    };
  }

  const headerTargets = matrix[headerRowIndex].map((header) => IMPORT_FIELD_TARGETS.get(normalizeImportHeader(header)) ?? '');
  const rows = matrix
    .slice(headerRowIndex + 1)
    .map((cells, index) => {
      const row = createEmptyImportRow(headerRowIndex + index + 2);
      cells.forEach((cell, columnIndex) => {
        const targetKey = headerTargets[columnIndex];
        if (!targetKey) {
          return;
        }
        assignImportField(row, targetKey, normalizeImportText(cell));
      });
      return row;
    })
    .filter((row) => Boolean(row.fullName || row.username || row.email || row.teamName || row.subTeamName || Object.values(row.profile).some(Boolean)));

  const issues = validateImportRows(rows);
  return { rows, issues };
}

function normalizeUsernamePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function buildAutoUsername(firstName: string, lastName: string) {
  const first = normalizeUsernamePart(firstName);
  const last = normalizeUsernamePart(lastName);
  if (!first && !last) return '';
  if (!first) return last;
  if (!last) return first;
  return `${first}.${last}`;
}

function buildAutoEmailFromName(firstName: string, lastName: string) {
  const username = buildAutoUsername(firstName, lastName);
  if (!username) return '';
  return `${username}@tlantic.com`;
}

function normalizeDropdownValues(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, cleaned);
    }
  }
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'pt-PT'));
}

function normalizeFileUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${getBackendBase()}${trimmed}`;
  }

  if (trimmed.startsWith('uploads/')) {
    return `${getBackendBase()}/${trimmed}`;
  }

  return `${getBackendBase()}/uploads/${trimmed.replace(/^\/+/, '')}`;
}

function getDisplayName(item: CollaboratorRow) {
  const shortName = item.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = item?.profile?.nomeCompleto ?? '';
  return fullName || item.username;
}

function getGrantDisplayName(user?: PermissionGrantUser | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = user?.profile?.nomeCompleto ?? '';
  return fullName || user?.username || 'Sistema';
}

function normalizeList(input: string) {
  return input
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleCommaItem(source: string, item: string) {
  const normalized = normalizeList(source);
  return normalized.includes(item)
    ? normalized.filter((entry) => entry !== item).join(', ')
    : [...normalized, item].join(', ');
}

function parseJsonOrNull(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getPermissionCategoryLabel(category: PermissionCategory) {
  switch (category) {
    case 'SYSTEM': return 'Sistema';
    case 'USERS': return 'Utilizadores';
    case 'TEAMS': return 'Equipas';
    case 'VACATIONS': return 'Férias';
    case 'TRAININGS': return 'Formações';
    case 'PROFILE': return 'Perfil';
    case 'RECEIPTS': return 'Recibos';
    case 'NOTIFICATIONS': return 'Notificações';
    default: return category;
  }
}

function buildDraftFromAssignment(item: PermissionItem, forceEnabled = false): PermissionDraft {
  return {
    enabled: forceEnabled || item.assignment?.isEnabled || false,
    restrictedToTeams: item.assignment?.restrictedToTeams?.join(', ') ?? '',
    restrictedToCountries: item.assignment?.restrictedToCountries?.join(', ') ?? '',
    restrictedToLevels: item.assignment?.restrictedToLevels?.join(', ') ?? '',
    customRestrictions: item.assignment?.customRestrictions ? JSON.stringify(item.assignment.customRestrictions, null, 2) : '',
    notes: item.assignment?.notes ?? '',
  };
}

function formatDateForExport(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'colaborador';
}

function buildExportRows(item: CollaboratorRow) {
  const profile = item.profile || {};
  const teamInfo = getCollaboratorTeamInfo(item);

  return [
    { section: 'Conta', field: 'Nome', value: getDisplayName(item), note: '' },
    { section: 'Conta', field: 'Username', value: item.username, note: '' },
    { section: 'Conta', field: 'Email login', value: item.email, note: '' },
    { section: 'Conta', field: 'País de trabalho', value: profile.workCountry || 'PT', note: '' },
    { section: 'Conta', field: 'Equipa principal', value: teamInfo.name === '-' ? 'Sem equipa' : teamInfo.name, note: teamInfo.isLeader ? 'Colaborador com papel de chefia na equipa.' : '' },
    { section: 'Identificação', field: 'Nome completo', value: profile.nomeCompleto || '-', note: '' },
    { section: 'Identificação', field: 'Nome abreviado', value: profile.nomeAbreviado || '-', note: '' },
    { section: 'Identificação', field: 'Data de nascimento', value: formatDateForExport(profile.dataNascimento), note: '' },
    { section: 'Identificação', field: 'Género', value: profile.genero || '-', note: '' },
    { section: 'Identificação', field: 'Estado civil', value: profile.estadoCivil || '-', note: '' },
    { section: 'Identificação', field: 'Habilitações literárias', value: profile.habilitacoesLiterarias || '-', note: '' },
    { section: 'Identificação', field: 'Curso', value: profile.curso || '-', note: '' },
    { section: 'Identificação', field: 'Faculdade', value: profile.faculdade || '-', note: '' },
    { section: 'Identificação', field: 'Nacionalidade', value: profile.nacionalidade || '-', note: '' },
    { section: 'Contactos', field: 'Email pessoal', value: profile.emailPessoal || '-', note: '' },
    { section: 'Contactos', field: 'Telemóvel', value: profile.telemovel || '-', note: '' },
    { section: 'Contactos', field: 'GitHub', value: profile.githubUser || '-', note: '' },
    { section: 'Contactos', field: 'Morada fiscal', value: profile.moradaFiscal || '-', note: '' },
    { section: 'Contactos', field: 'Morada habitual', value: profile.endereco || '-', note: '' },
    { section: 'Contactos', field: 'Localidade', value: profile.localidade || '-', note: '' },
    { section: 'Contactos', field: 'Código postal', value: profile.codigoPostal || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Matrícula', value: profile.matriculaCarro || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Cartão de cidadão', value: profile.cartaoCidadao || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Validade cartão cidadão', value: formatDateForExport(profile.validadeCartaoCidadao), note: '' },
    { section: 'Fiscal e documentos', field: 'NIF', value: profile.nif || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'NISS', value: profile.niss || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'IBAN', value: profile.iban || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Situação IRS', value: profile.situacaoIrs || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Dependentes', value: profile.numeroDependentes || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'IRS jovem', value: profile.irsJovem || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Ano primeiro desconto', value: profile.anoPrimeiroDesconto || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Cartão Continente', value: profile.numeroCartaoContinente || '-', note: '' },
    { section: 'Fiscal e documentos', field: 'Voucher NOS data', value: profile.voucherNosData || '-', note: '' },
    { section: 'Emergência', field: 'Nome contacto', value: profile.contactoEmergenciaNome || '-', note: '' },
    { section: 'Emergência', field: 'Parentesco', value: profile.contactoEmergenciaParentesco || '-', note: '' },
    { section: 'Emergência', field: 'Número', value: profile.contactoEmergenciaNumero || '-', note: '' },
    { section: 'Contrato', field: 'Cargo', value: profile.cargo || '-', note: '' },
    { section: 'Contrato', field: 'Função', value: profile.funcao || '-', note: '' },
    { section: 'Contrato', field: 'Início contrato', value: formatDateForExport(profile.dataInicioContrato), note: '' },
    { section: 'Contrato', field: 'Fim contrato', value: formatDateForExport(profile.dataFimContrato), note: '' },
    { section: 'Contrato', field: 'Tipo contrato', value: profile.tipoContrato || '-', note: '' },
    { section: 'Contrato', field: 'Regime horário', value: profile.regimeHorario || '-', note: '' },
  ];
}

export default function CollaboratorsPage() {
  const { hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();
  const canView = isRootAccess || hasPermission('view_user_list');
  const canEditUser = isRootAccess || hasPermission('edit_user');
  const canManagePermissions = isRootAccess || hasPermission('manage_permissions');
  const canManageActive = isRootAccess || hasPermission('manage_user_active');

  const [rows, setRows] = useState<CollaboratorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | CollaboratorRow['role']>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [countryFilter, setCountryFilter] = useState<'ALL' | 'PT' | 'BR'>('ALL');
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'username' | 'email' | 'role'>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isLoadingExportCandidates, setIsLoadingExportCandidates] = useState(false);
  const [isExportingWorkbook, setIsExportingWorkbook] = useState(false);
  const [exportCandidates, setExportCandidates] = useState<CollaboratorRow[]>([]);
  const [exportSearch, setExportSearch] = useState('');
  const [selectedExportUserId, setSelectedExportUserId] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [activeConfirmTarget, setActiveConfirmTarget] = useState<CollaboratorRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<CollaboratorRow | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'ficha' | 'permissoes' | 'estado'>('ficha');
  const [permissionCategory, setPermissionCategory] = useState<PermissionCategory>('USERS');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [selectedUserAccessTotal, setSelectedUserAccessTotal] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionItem[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, PermissionDraft>>({});
  const [savingPermissionId, setSavingPermissionId] = useState<string | null>(null);
  const [isTogglingAccessTotal, setIsTogglingAccessTotal] = useState(false);
  const [selectedPermissionId, setSelectedPermissionId] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionTeams, setPermissionTeams] = useState<TeamOption[]>([]);
  const [pendingTeamToAdd, setPendingTeamToAdd] = useState('');
  const [editDraft, setEditDraft] = useState<CollaboratorEditDraft>(EMPTY_EDIT_DRAFT);
  const [isSavingEditDraft, setIsSavingEditDraft] = useState(false);
  const [customCargoOptions, setCustomCargoOptions] = useState<CustomProfileOption[]>([]);
  const [customFuncaoOptions, setCustomFuncaoOptions] = useState<CustomProfileOption[]>([]);
  const [isProfileOptionModalOpen, setIsProfileOptionModalOpen] = useState(false);
  const [profileOptionType, setProfileOptionType] = useState<'CARGO' | 'FUNCAO'>('CARGO');
  const [profileOptionLabel, setProfileOptionLabel] = useState('');
  const [profileOptionGroup, setProfileOptionGroup] = useState('');
  const [isSavingProfileOption, setIsSavingProfileOption] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUserDraft, setNewUserDraft] = useState({ fullName: '', username: '', email: '', workCountry: 'PT' as 'PT' | 'BR' });
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isParsingImportFile, setIsParsingImportFile] = useState(false);
  const [isImportingUsers, setIsImportingUsers] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<CollaboratorImportRow[]>([]);
  const [importIssues, setImportIssues] = useState<CollaboratorImportIssue[]>([]);
  const [importResults, setImportResults] = useState<CollaboratorImportResultItem[]>([]);
  const [credentialsDraft, setCredentialsDraft] = useState({ username: '', email: '' });
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const canManageProfileOptions = isRootAccess || isAccessTotal || hasPermission('manage_profile_dropdown_options');
  const canEditCredentials = Boolean(currentUser?.isRootAccess) || currentUser?.username === 't.people';
  const canCreateUser = Boolean(isAccessTotal);
  const collaboratorQueryInputRef = useRef<HTMLInputElement | null>(null);
  const collaboratorQueryRef = useRef(query);
  const detailsLoadControllerRef = useRef<AbortController | null>(null);
  const [detailsCacheByUserId, setDetailsCacheByUserId] = useState<Record<string, CollaboratorDetailsCacheEntry>>({});

  useEffect(() => {
    collaboratorQueryRef.current = query;
  }, [query]);

  const cargoDropdownOptions = useMemo(
    () => normalizeDropdownValues([
      ...CARGO_OPTIONS,
      ...rows.map((item) => item.profile?.cargo || ''),
      ...customCargoOptions.map((item) => item.label),
      editDraft.cargo,
    ]),
    [customCargoOptions, editDraft.cargo, rows],
  );

  const funcaoDropdownOptions = useMemo(
    () => normalizeDropdownValues([
      ...FUNCAO_OPTIONS,
      ...rows.map((item) => item.profile?.funcao || ''),
      ...customFuncaoOptions.map((item) => item.label),
      editDraft.funcao,
    ]),
    [customFuncaoOptions, editDraft.funcao, rows],
  );

  const hiddenFileInputId = (fieldKey: string) => `collaborator-${fieldKey}-file`;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const visibleRows = useMemo(
    () => rows.filter((item) => item.id !== currentUser?.id),
    [rows, currentUser?.id],
  );
  const visibleTotal = Math.max(0, total - (rows.some((item) => item.id === currentUser?.id) ? 1 : 0));
  const importPreviewRows = useMemo(() => importRows.slice(0, 8), [importRows]);
  const importCreatedCount = useMemo(() => importResults.filter((item) => item.status === 'CREATED').length, [importResults]);
  const importFailedCount = useMemo(() => importResults.filter((item) => item.status === 'FAILED').length, [importResults]);
  const categoryPermissions = useMemo(
    () => selectedPermissions.filter((item) => item.category === permissionCategory),
    [permissionCategory, selectedPermissions],
  );

  const filteredCategoryPermissions = useMemo(() => {
    const normalized = permissionSearch.trim().toLowerCase();
    if (!normalized) {
      return categoryPermissions;
    }

    return categoryPermissions.filter((item) =>
      `${item.label} ${item.description} ${item.code}`.toLowerCase().includes(normalized),
    );
  }, [categoryPermissions, permissionSearch]);

  const selectedPermission = useMemo(
    () => filteredCategoryPermissions.find((item) => item.id === selectedPermissionId) || filteredCategoryPermissions[0] || null,
    [filteredCategoryPermissions, selectedPermissionId],
  );

  const selectedPermissionDraft = selectedPermission
    ? (permissionDrafts[selectedPermission.id] ?? buildDraftFromAssignment(selectedPermission))
    : null;

  const selectedRestrictionCountries = selectedPermissionDraft ? normalizeList(selectedPermissionDraft.restrictedToCountries) : [];
  const selectedRestrictedTeamIds = selectedPermissionDraft ? normalizeList(selectedPermissionDraft.restrictedToTeams) : [];
  const selectedRowTeam = useMemo(() => {
    if (!selectedRow) {
      return null;
    }

    const resolvedTeam = getCollaboratorPrimaryTeam(selectedRow);
    return resolvedTeam ? { id: resolvedTeam.id, name: resolvedTeam.name } : null;
  }, [selectedRow]);
  const collaboratorTeamOptions = useMemo(() => {
    const options: TeamOption[] = [];

    if (selectedRowTeam) {
      options.push(selectedRowTeam);
    }

    for (const team of permissionTeams) {
      if (!options.some((item) => item.id === team.id)) {
        options.push(team);
      }
    }

    return options;
  }, [permissionTeams, selectedRowTeam]);
  const selectedRestrictedTeams = useMemo(
    () => permissionTeams.filter((team) => selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );
  const availableTeamsToAdd = useMemo(
    () => permissionTeams.filter((team) => !selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );
  const exportCandidatesFiltered = useMemo(() => {
    const normalized = exportSearch.trim().toLowerCase();
    const source = exportCandidates.filter((item) => item.id !== currentUser?.id);
    if (!normalized) {
      return source;
    }

    return source.filter((item) => {
      const teamInfo = getCollaboratorTeamInfo(item);
      return `${getDisplayName(item)} ${item.username} ${item.email} ${item.profile?.cargo || ''} ${item.profile?.funcao || ''} ${teamInfo.name}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [currentUser?.id, exportCandidates, exportSearch]);
  const selectedExportCandidate = useMemo(
    () => exportCandidatesFiltered.find((item) => item.id === selectedExportUserId) || null,
    [exportCandidatesFiltered, selectedExportUserId],
  );

  useEffect(() => {
    if (!isExportModalOpen) {
      return;
    }

    if (selectedExportUserId && exportCandidatesFiltered.some((item) => item.id === selectedExportUserId)) {
      return;
    }

    setSelectedExportUserId(exportCandidatesFiltered[0]?.id || '');
  }, [exportCandidatesFiltered, isExportModalOpen, selectedExportUserId]);

  useEffect(() => {
    if (filteredCategoryPermissions.length === 0) {
      setSelectedPermissionId(null);
      return;
    }

    if (!selectedPermissionId || !filteredCategoryPermissions.some((item) => item.id === selectedPermissionId)) {
      setSelectedPermissionId(filteredCategoryPermissions[0].id);
    }
  }, [filteredCategoryPermissions, selectedPermissionId]);

  useEffect(() => {
    if (!canView) {
      return;
    }

    const controller = new AbortController();
    void loadCollaborators(controller.signal);

    return () => {
      controller.abort();
    };
  }, [canView, page, pageSize, query, roleFilter, activeFilter, countryFilter, sortBy, sortDirection]);

  useEffect(() => {
    const syncQueryFromInput = () => {
      const inputValue = collaboratorQueryInputRef.current?.value ?? '';

      if (inputValue !== collaboratorQueryRef.current) {
        collaboratorQueryRef.current = inputValue;
        setPage(1);
        setQuery(inputValue);
      }
    };

    const timeoutId = window.setTimeout(syncQueryFromInput, 0);
    window.addEventListener('pageshow', syncQueryFromInput);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('pageshow', syncQueryFromInput);
    };
  }, []);

  useEffect(() => {
    return () => {
      detailsLoadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const parts = newUserDraft.fullName.trim().split(/\s+/).filter((p) => p.length > 0);
    const firstName = parts[0] || '';
    const lastName = parts[parts.length - 1] || '';
    setNewUserDraft((current) => ({
      ...current,
      username: buildAutoUsername(firstName, lastName),
      email: buildAutoEmailFromName(firstName, lastName),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newUserDraft.fullName]);

  useEffect(() => {
    if (!selectedRow) {
      setCredentialsDraft({ username: '', email: '' });
      return;
    }
    setCredentialsDraft({ username: selectedRow.username, email: selectedRow.email });
  }, [selectedRow]);

  async function loadCollaborators(signal?: AbortSignal) {
    setLoading(rows.length === 0);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);

      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (roleFilter !== 'ALL') {
        params.set('role', roleFilter);
      }
      if (activeFilter !== 'ALL') {
        params.set('active', activeFilter === 'ACTIVE' ? 'true' : 'false');
      }
      if (countryFilter !== 'ALL') {
        params.set('workCountry', countryFilter);
      }

      const data = await apiRequestCached<CollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
        headers: getAuthHeaders(),
        signal,
      }, 10000);

      setRows(data.rows);
      setTotal(data.total);
      setStatus('');
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      setStatus(error instanceof Error ? error.message : 'Falha ao carregar colaboradores.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  function buildCollaboratorsParams(targetPage: number, targetPageSize: number, targetSortBy = sortBy, targetSortDirection = sortDirection) {
    const params = new URLSearchParams();
    params.set('page', String(targetPage));
    params.set('pageSize', String(targetPageSize));
    params.set('sortBy', targetSortBy);
    params.set('sortDirection', targetSortDirection);

    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (roleFilter !== 'ALL') {
      params.set('role', roleFilter);
    }
    if (activeFilter !== 'ALL') {
      params.set('active', activeFilter === 'ACTIVE' ? 'true' : 'false');
    }
    if (countryFilter !== 'ALL') {
      params.set('workCountry', countryFilter);
    }

    return params;
  }

  async function loadExportCandidates() {
    setIsLoadingExportCandidates(true);

    try {
      const collected: CollaboratorRow[] = [];
      let currentPage = 1;
      const chunkSize = 100;
      let totalRows = 0;

      do {
        const params = buildCollaboratorsParams(currentPage, chunkSize, 'username', 'asc');
        const data = await apiRequestCached<CollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
          headers: getAuthHeaders(),
        }, 5000, true);

        totalRows = data.total;
        collected.push(...data.rows);
        currentPage += 1;
      } while (collected.length < totalRows && currentPage <= 10);

      setExportCandidates(collected);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar colaboradores para exportação.');
    } finally {
      setIsLoadingExportCandidates(false);
    }
  }

  function openExportModal() {
    setIsExportModalOpen(true);
    setExportSearch('');
    setSelectedExportUserId('');
    void loadExportCandidates();
  }

  async function exportSelectedCollaboratorWorkbook() {
    if (!selectedExportCandidate) {
      setStatus('Seleciona um colaborador para exportar.');
      return;
    }

    setIsExportingWorkbook(true);

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Ficha colaborador', {
        views: [{ state: 'frozen', ySplit: 9 }],
      });

      workbook.creator = 'Smarter Hub';
      workbook.created = new Date();

      worksheet.columns = [
        { header: 'Secção', key: 'section', width: 28 },
        { header: 'Campo', key: 'field', width: 34 },
        { header: 'Valor', key: 'value', width: 48 },
        { header: 'Observações', key: 'note', width: 46 },
      ];

      const collaboratorName = getDisplayName(selectedExportCandidate);

      const profile = selectedExportCandidate.profile || {};
      const teamInfo = getCollaboratorTeamInfo(selectedExportCandidate);

      worksheet.mergeCells('A1:B4');
      worksheet.mergeCells('C1:D2');
      worksheet.mergeCells('C3:D3');
      worksheet.mergeCells('A5:D5');

      const titleCell = worksheet.getCell('C1');
      titleCell.value = `Ficha de Colaborador · ${collaboratorName}`;
      titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F3B78' },
      };

      const subtitleCell = worksheet.getCell('C3');
      subtitleCell.value = 'Documento de consulta corporativa';
      subtitleCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F3B78' } };
      subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };
      subtitleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEAF2FF' },
      };

      const generatedAtCell = worksheet.getCell('A5');
      generatedAtCell.value = `Exportado em: ${new Intl.DateTimeFormat('pt-PT', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date())}`;
      generatedAtCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F3B78' } };
      generatedAtCell.alignment = { horizontal: 'left', vertical: 'middle' };
      generatedAtCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEAF2FF' },
      };

      const summaryHeaders = worksheet.addRow(['Nome', 'Email', 'Cargo', 'Função']);
      summaryHeaders.height = 20;
      summaryHeaders.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1B4F9A' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF4F8FF' },
        };
      });

      const summaryValues = worksheet.addRow([
        collaboratorName,
        selectedExportCandidate.email,
        profile.cargo || '-',
        profile.funcao || '-',
      ]);
      summaryValues.height = 20;
      summaryValues.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' },
        };
      });

      const summaryExtraHeaders = worksheet.addRow(['Equipa', 'País', 'Início contrato', 'Nacionalidade']);
      summaryExtraHeaders.height = 20;
      summaryExtraHeaders.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1B4F9A' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF4F8FF' },
        };
      });

      const summaryExtraValues = worksheet.addRow([
        teamInfo.name === '-' ? 'Sem equipa' : teamInfo.name,
        profile.workCountry || 'PT',
        formatDateForExport(profile.dataInicioContrato),
        profile.nacionalidade || '-',
      ]);
      summaryExtraValues.height = 20;
      summaryExtraValues.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' },
        };
      });

      worksheet.addRow([]);

      const headersRow = worksheet.addRow(['Secção', 'Campo', 'Valor', 'Observações']);
      headersRow.height = 22;
      headersRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1B4F9A' },
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF0E2E5A' } },
          left: { style: 'thin', color: { argb: 'FF0E2E5A' } },
          bottom: { style: 'thin', color: { argb: 'FF0E2E5A' } },
          right: { style: 'thin', color: { argb: 'FF0E2E5A' } },
        };
      });

      const exportRows = buildExportRows(selectedExportCandidate);
      exportRows.forEach((entry, index) => {
        const row = worksheet.addRow([entry.section, entry.field, entry.value, entry.note]);
        row.height = 21;

        row.eachCell((cell, colNumber) => {
          cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
          cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber === 3 ? 'left' : 'left',
            wrapText: true,
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD6E2F1' } },
            left: { style: 'thin', color: { argb: 'FFD6E2F1' } },
            bottom: { style: 'thin', color: { argb: 'FFD6E2F1' } },
            right: { style: 'thin', color: { argb: 'FFD6E2F1' } },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: index % 2 === 0 ? 'FFF8FBFF' : 'FFFFFFFF' },
          };
        });
      });

      worksheet.autoFilter = {
        from: { row: headersRow.number, column: 1 },
        to: { row: headersRow.number, column: 4 },
      };

      try {
        const logoResponse = await fetch('/logo.png');
        if (logoResponse.ok) {
          const logoBlob = await logoResponse.blob();
          const logoBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Falha a ler logo para exportação.'));
            reader.readAsDataURL(logoBlob);
          });

          const logoId = workbook.addImage({
            base64: logoBase64,
            extension: 'png',
          });

          worksheet.addImage(logoId, {
            tl: { col: 0.15, row: 0.15 },
            ext: { width: 260, height: 86 },
          });
        }
      } catch {
        // Se o logo não estiver disponível, mantém exportação sem bloquear o download.
      }

      const rawBuffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([rawBuffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `ficha_colaborador_${sanitizeFileName(collaboratorName)}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setIsExportModalOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao exportar ficheiro Excel.');
    } finally {
      setIsExportingWorkbook(false);
    }
  }

  async function toggleActive(item: CollaboratorRow) {
    setBusyUserId(item.id);
    try {
      await apiRequest(`/users/${item.id}/active`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isActive: !item.isActive }),
      });

      clearApiCache('/users/collaborators');
      await loadCollaborators();
      setStatus(item.isActive ? 'Colaborador desativado com sucesso.' : 'Colaborador reativado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao alterar estado do colaborador.');
    } finally {
      setBusyUserId(null);
    }
  }

  function openActiveConfirm(item: CollaboratorRow) {
    setActiveConfirmTarget(item);
  }

  async function confirmToggleActive() {
    if (!activeConfirmTarget) {
      return;
    }

    await toggleActive(activeConfirmTarget);
    setActiveConfirmTarget(null);
  }

  async function openDetails(item: CollaboratorRow, initialTab: 'ficha' | 'permissoes' | 'estado' = 'ficha') {
    detailsLoadControllerRef.current?.abort();

    setSelectedRow(item);
    setDetailsTab(initialTab);
    setIsDetailsOpen(true);
    setEditDraft(buildEditDraftFromRow(item));
    setPermissionSearch('');
    setPendingTeamToAdd('');

    const cached = detailsCacheByUserId[item.id];
    if (cached) {
      setIsLoadingDetails(false);
      setSelectedPermissions(cached.selectedPermissions);
      setSelectedUserAccessTotal(cached.selectedUserAccessTotal);
      setPermissionTeams(cached.permissionTeams);
      setCustomCargoOptions(cached.customCargoOptions);
      setCustomFuncaoOptions(cached.customFuncaoOptions);
      setPermissionDrafts(Object.fromEntries(cached.selectedPermissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, cached.selectedUserAccessTotal)])));
      setSelectedPermissionId(cached.selectedPermissions[0]?.id ?? null);
      return;
    }

    setIsLoadingDetails(true);
    setSelectedPermissions([]);
    setSelectedUserAccessTotal(false);
    setPermissionDrafts({});
    setPermissionTeams([]);
    setCustomCargoOptions([]);
    setCustomFuncaoOptions([]);
    setSelectedPermissionId(null);

    const controller = new AbortController();
    detailsLoadControllerRef.current = controller;

    try {
      const loadPermissionTeams = async () => {
        try {
          const adminTeams = await apiRequestCached<Array<{ id: string; name: string }>>('/admin/teams', {
            headers: getAuthHeaders(),
            signal: controller.signal,
          }, 8000, true);
          return (adminTeams || []).map((team) => ({ id: team.id, name: team.name }));
        } catch {
          try {
            const scopedTeams = await apiRequestCached<Array<{ id: string; name: string }>>('/teams', {
              headers: getAuthHeaders(),
              signal: controller.signal,
            }, 8000, true);
            return (scopedTeams || []).map((team) => ({ id: team.id, name: team.name }));
          } catch {
            return [];
          }
        }
      };

      const [details, permissionTeams, profileOptions] = await Promise.all([
        apiRequest<UserPermissionsResponse>(`/users/${item.id}/permissions`, {
          headers: getAuthHeaders(),
          signal: controller.signal,
        }),
        loadPermissionTeams(),
        apiRequestCached<{
          cargo?: CustomProfileOption[];
          funcao?: CustomProfileOption[];
        }>('/profile/options', {
          headers: getAuthHeaders(),
          signal: controller.signal,
        }, 8000, true),
      ]);

      if (controller.signal.aborted) {
        return;
      }

      const hasAccessTotal = Boolean(details.accessTotal);
      setSelectedPermissions(details.permissions);
      setSelectedUserAccessTotal(hasAccessTotal);
      setPermissionDrafts(Object.fromEntries(details.permissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, hasAccessTotal)])));
      setSelectedPermissionId(details.permissions[0]?.id ?? null);
      setPermissionSearch('');
      setPendingTeamToAdd('');

      setPermissionTeams(permissionTeams);
      setCustomCargoOptions(profileOptions.cargo ?? []);
      setCustomFuncaoOptions(profileOptions.funcao ?? []);
      setDetailsCacheByUserId((current) => ({
        ...current,
        [item.id]: {
          selectedPermissions: details.permissions,
          selectedUserAccessTotal: hasAccessTotal,
          permissionTeams,
          customCargoOptions: profileOptions.cargo ?? [],
          customFuncaoOptions: profileOptions.funcao ?? [],
        },
      }));
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(error instanceof Error ? error.message : 'Falha ao carregar detalhe do colaborador.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingDetails(false);
      }
      if (detailsLoadControllerRef.current === controller) {
        detailsLoadControllerRef.current = null;
      }
    }
  }

  function closeDetails() {
    detailsLoadControllerRef.current?.abort();
    detailsLoadControllerRef.current = null;
    setIsDetailsOpen(false);
  }

  async function openProfileOptionModal(type: 'CARGO' | 'FUNCAO') {
    if (!selectedRow || !canManageProfileOptions) {
      return;
    }

    setProfileOptionType(type);
    setProfileOptionLabel('');
    setProfileOptionGroup('');
    setIsProfileOptionModalOpen(true);
  }

  async function handleCreateProfileOption() {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const normalizedLabel = profileOptionLabel.trim().replace(/\s+/g, ' ');
    const normalizedGroup = profileOptionGroup.trim().replace(/\s+/g, ' ');

    if (!token || !normalizedLabel) {
      setStatus('Indica um valor válido para adicionar.');
      return;
    }

    setIsSavingProfileOption(true);

    try {
      const payload = await apiRequest<{ option?: { id: string; type: 'CARGO' | 'FUNCAO'; label: string; groupLabel?: string | null } }>('/profile/options', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          type: profileOptionType,
          label: normalizedLabel,
          groupLabel: profileOptionType === 'FUNCAO' ? normalizedGroup : undefined,
        }),
      });

      const created = payload.option;
      if (!created) {
        throw new Error('Não foi possível guardar o valor.');
      }

      if (created.type === 'CARGO') {
        setCustomCargoOptions((current) => [...current, { id: created.id, label: created.label, groupLabel: created.groupLabel }]);
      } else {
        setCustomFuncaoOptions((current) => [...current, { id: created.id, label: created.label, groupLabel: created.groupLabel }]);
      }

      setIsProfileOptionModalOpen(false);
      setStatus('Valor adicionado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível adicionar o valor.');
    } finally {
      setIsSavingProfileOption(false);
    }
  }

  async function saveCollaboratorDraft() {
    if (!selectedRow) {
      return;
    }

    setIsSavingEditDraft(true);
    try {
      await apiRequest(`/admin/users/${selectedRow.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          role: editDraft.role,
          teamId: editDraft.role === 'ADMIN' ? null : (editDraft.teamId || null),
          isActive: editDraft.isActive,
          workCountry: editDraft.workCountry,
          nomeCompleto: editDraft.nomeCompleto,
          nomeAbreviado: editDraft.nomeAbreviado,
          dataNascimento: editDraft.dataNascimento,
          genero: editDraft.genero,
          estadoCivil: editDraft.estadoCivil,
          habilitacoesLiterarias: editDraft.habilitacoesLiterarias,
          curso: editDraft.curso,
          faculdade: editDraft.faculdade,
          nacionalidade: editDraft.nacionalidade,
          emailPessoal: editDraft.emailPessoal,
          telemovel: editDraft.telemovel,
          githubUser: editDraft.githubUser,
          moradaFiscal: editDraft.moradaFiscal,
          endereco: editDraft.endereco,
          localidade: editDraft.localidade,
          codigoPostal: editDraft.codigoPostal,
          matriculaCarro: editDraft.matriculaCarro,
          cartaoCidadao: editDraft.cartaoCidadao,
          validadeCartaoCidadao: editDraft.validadeCartaoCidadao,
          nif: editDraft.nif,
          niss: editDraft.niss,
          iban: editDraft.iban,
          situacaoIrs: editDraft.situacaoIrs,
          numeroDependentes: editDraft.numeroDependentes,
          irsJovem: editDraft.irsJovem,
          anoPrimeiroDesconto: editDraft.anoPrimeiroDesconto,
          numeroCartaoContinente: editDraft.numeroCartaoContinente,
          voucherNosData: editDraft.voucherNosData,
          comprovativoMoradaFiscal: editDraft.comprovativoMoradaFiscal,
          comprovativoCartaoCidadao: editDraft.comprovativoCartaoCidadao,
          comprovativoIban: editDraft.comprovativoIban,
          comprovativoCartaoContinente: editDraft.comprovativoCartaoContinente,
          contactoEmergenciaNome: editDraft.contactoEmergenciaNome,
          contactoEmergenciaParentesco: editDraft.contactoEmergenciaParentesco,
          contactoEmergenciaNumero: editDraft.contactoEmergenciaNumero,
          cargo: editDraft.cargo,
          funcao: editDraft.funcao,
          dataInicioContrato: editDraft.dataInicioContrato,
          dataFimContrato: editDraft.dataFimContrato,
          tipoContrato: editDraft.tipoContrato,
          regimeHorario: editDraft.regimeHorario,
        }),
      });

      clearApiCache('/users/collaborators');
      await loadCollaborators();
      await openDetails(selectedRow, 'ficha');
      setStatus('Ficha atualizada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar ficha do colaborador.');
    } finally {
      setIsSavingEditDraft(false);
    }
  }

  async function savePermission(permission: PermissionItem) {
    if (!selectedRow) {
      return;
    }

    if (selectedUserAccessTotal) {
      setStatus('Revoga o acesso total para editar permissões individuais.');
      return;
    }

    const draft = permissionDrafts[permission.id] ?? EMPTY_PERMISSION_DRAFT;
    setSavingPermissionId(permission.id);

    try {
      if (!draft.enabled && permission.assignment) {
        await apiRequest(`/users/${selectedRow.id}/permissions/${permission.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
      } else if (draft.enabled) {
        const body = {
          permissionId: permission.id,
          isEnabled: true,
          restrictedToTeams: normalizeList(draft.restrictedToTeams),
          restrictedToCountries: normalizeList(draft.restrictedToCountries)
            .map((item) => item.toUpperCase())
            .filter((item): item is 'PT' | 'BR' => item === 'PT' || item === 'BR'),
          restrictedToLevels: normalizeList(draft.restrictedToLevels),
          customRestrictions: parseJsonOrNull(draft.customRestrictions),
          notes: draft.notes,
          reason: `Atualização pela gestão de colaboradores para ${selectedRow.username}.`,
        };

        if (permission.assignment) {
          await apiRequest(`/users/${selectedRow.id}/permissions/${permission.id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest(`/users/${selectedRow.id}/permissions`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        }
      }

      clearApiCache();
      await openDetails(selectedRow);
      setStatus('Permissão atualizada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar permissão.');
    } finally {
      setSavingPermissionId(null);
    }
  }

  async function toggleAccessTotalForSelected(enable: boolean, reason?: string) {
    if (!selectedRow) {
      return false;
    }

    const targetUser = selectedRow;

    if (enable === selectedUserAccessTotal) {
      return false;
    }

    setIsTogglingAccessTotal(true);
    try {
      const result = await apiRequest<{ success: boolean; accessTotal: boolean }>(`/users/${targetUser.id}/access-total`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          isEnabled: enable,
          reason: reason?.trim() || undefined,
        }),
      });

      const refreshedDetails = await apiRequest<UserPermissionsResponse>(`/users/${targetUser.id}/permissions`, {
        headers: getAuthHeaders(),
      });

      const refreshedAccessTotal = Boolean(refreshedDetails.accessTotal ?? result.accessTotal);
      const refreshedPermissions = refreshedDetails.permissions;

      clearApiCache();
      setSelectedUserAccessTotal(refreshedAccessTotal);
      setSelectedPermissions(refreshedPermissions);
      setPermissionDrafts(Object.fromEntries(refreshedPermissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, refreshedAccessTotal)])));
      setSelectedPermissionId((current) => {
        if (current && refreshedPermissions.some((permission) => permission.id === current)) {
          return current;
        }
        return refreshedPermissions[0]?.id ?? null;
      });
      setDetailsCacheByUserId((current) => {
        const cached = current[targetUser.id];
        return {
          ...current,
          [targetUser.id]: {
            selectedPermissions: refreshedPermissions,
            selectedUserAccessTotal: refreshedAccessTotal,
            permissionTeams: cached?.permissionTeams ?? permissionTeams,
            customCargoOptions: cached?.customCargoOptions ?? customCargoOptions,
            customFuncaoOptions: cached?.customFuncaoOptions ?? customFuncaoOptions,
          },
        };
      });
      setStatus(enable ? 'Acesso total concedido.' : 'Acesso total revogado.');
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar acesso total.');
      return false;
    } finally {
      setIsTogglingAccessTotal(false);
    }
  }

  function addTeamRestriction(teamId: string) {
    if (!selectedPermission || !selectedPermissionDraft || !teamId) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToTeams: toggleCommaItem(selectedPermissionDraft.restrictedToTeams, teamId),
      },
    }));
    setPendingTeamToAdd('');
  }

  function removeTeamRestriction(teamId: string) {
    if (!selectedPermission || !selectedPermissionDraft) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToTeams: toggleCommaItem(selectedPermissionDraft.restrictedToTeams, teamId),
      },
    }));
  }

  function renderEditFieldControl(fieldKey: keyof CollaboratorEditDraft) {
    const isComprovativoField = fieldKey === 'comprovativoMoradaFiscal'
      || fieldKey === 'comprovativoCartaoCidadao'
      || fieldKey === 'comprovativoIban'
      || fieldKey === 'comprovativoCartaoContinente';

    const value = editDraft[fieldKey] as string;

    const onChangeValue = (nextValue: string) => {
      setEditDraft((current) => ({ ...current, [fieldKey]: nextValue }));
    };

    if (fieldKey === 'genero') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {generoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'estadoCivil') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {estadoCivilOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'habilitacoesLiterarias') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {habilitacoesOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'situacaoIrs') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {situacaoIrsOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'irsJovem') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {irsJovemOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'contactoEmergenciaParentesco') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {parentescoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'validadeCartaoCidadao') {
      return (
        <input
          type="date"
          value={value}
          onChange={(event) => onChangeValue(event.target.value)}
          disabled={!canEditUser}
        />
      );
    }

    if (fieldKey === 'tipoContrato') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {tipoContratoOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'regimeHorario') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {regimeHorarioOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'cargo') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {cargoDropdownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (fieldKey === 'funcao') {
      return (
        <select value={value} onChange={(event) => onChangeValue(event.target.value)} disabled={!canEditUser}>
          <option value="">Selecionar</option>
          {funcaoDropdownOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }

    if (isComprovativoField) {
      const comprovativoUrl = normalizeFileUrl(value);
      return (
        <div className="collaborator-proof-field">
          <div className="collaborator-proof-field__actions">
            {comprovativoUrl ? (
              <a href={comprovativoUrl} target="_blank" rel="noreferrer" className="collaborator-proof-link">
                Ver atual
              </a>
            ) : (
              <span className="collaborator-proof-link collaborator-proof-link--empty">Sem comprovativo</span>
            )}

            <label className="collaborator-proof-upload">
              <span>Anexar novo</span>
              <input
                id={hiddenFileInputId(fieldKey)}
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => void handleCollaboratorFileChange(fieldKey, event)}
                onClick={(event) => {
                  event.currentTarget.value = '';
                }}
                disabled={!canEditUser || isSavingEditDraft}
              />
            </label>
          </div>
        </div>
      );
    }

    return (
      <input
        type="text"
        value={value}
        onChange={(event) => onChangeValue(event.target.value)}
        disabled={!canEditUser}
      />
    );
  }

  async function handleCollaboratorFileChange(field: keyof CollaboratorEditDraft, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${getApiBase()}/files/upload`, {
        method: 'POST',
        headers: authHeaders(token),
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Falha ao carregar ficheiro.');
      }

      const payload = (await response.json()) as { link?: string; linkPath?: string };
      setEditDraft((current) => ({
        ...current,
        [field]: payload.linkPath || payload.link || '',
      }));
      setStatus('Comprovativo carregado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar comprovativo.');
    }
  }

  function openImportModal() {
    setIsImportModalOpen(true);
    setImportFileName('');
    setImportRows([]);
    setImportIssues([]);
    setImportResults([]);
  }

  function closeImportModal() {
    setIsImportModalOpen(false);
    setImportFileName('');
    setImportRows([]);
    setImportIssues([]);
    setImportResults([]);
  }

  async function parseImportFile(file: File) {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.csv')) {
      const text = await file.text();
      return buildImportRowsFromMatrix(parseDelimitedText(text));
    }

    const ExcelJS = await loadExcelJsWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.getWorksheet('Importacao')
      ?? workbook.worksheets.find((sheet: any) => /^importa[cç][aã]o$/i.test(sheet.name))
      ?? workbook.worksheets.find((sheet: any) => !/^instrucoes$/i.test(sheet.name) && !/^listas$/i.test(sheet.name) && sheet.actualRowCount > 0)
      ?? workbook.worksheets.find((sheet: any) => sheet.actualRowCount > 0);

    if (!worksheet) {
      return {
        rows: [] as CollaboratorImportRow[],
        issues: [{ rowNumber: 1, message: 'O ficheiro Excel não contém folhas com dados.' }] as CollaboratorImportIssue[],
      };
    }

    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row: any) => {
      const values: string[] = [];
      const totalCells = Math.max(row.cellCount, Array.isArray(row.values) ? row.values.length - 1 : 0);
      for (let columnIndex = 1; columnIndex <= totalCells; columnIndex += 1) {
        values.push(readSpreadsheetCellValue(row.getCell(columnIndex).value));
      }
      if (values.some((item) => item.trim().length > 0)) {
        matrix.push(values);
      }
    });

    return buildImportRowsFromMatrix(matrix);
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsParsingImportFile(true);
    setImportResults([]);

    try {
      const parsed = await parseImportFile(file);
      setImportFileName(file.name);
      setImportRows(parsed.rows);
      setImportIssues(parsed.issues);

      if (parsed.rows.length === 0) {
        setStatus('O ficheiro não contém linhas válidas para importação.');
      } else if (parsed.issues.length > 0) {
        setStatus('Foram detetados problemas no ficheiro. Corrige-os antes de importar.');
      } else {
        setStatus('Ficheiro preparado para importação.');
      }
    } catch (error) {
      setImportFileName('');
      setImportRows([]);
      setImportIssues([]);
      setStatus(error instanceof Error ? error.message : 'Falha ao ler ficheiro de importação.');
    } finally {
      setIsParsingImportFile(false);
      event.target.value = '';
    }
  }

  async function downloadImportTemplate() {
    try {
      const ExcelJS = await loadExcelJsWorkbook();
      const workbook = new ExcelJS.Workbook();
      const [teamData, profileOptionsData] = await Promise.allSettled([
        apiRequestCached<Array<{ id: string; name: string; parentTeamId?: string | null }>>('/admin/teams', { headers: getAuthHeaders() }, 8000, true),
        apiRequestCached<{ cargo?: CustomProfileOption[]; funcao?: CustomProfileOption[] }>('/profile/options', { headers: getAuthHeaders() }, 8000, true),
      ]);

      const teams = teamData.status === 'fulfilled' ? teamData.value : [];
      const profileOptions = profileOptionsData.status === 'fulfilled' ? profileOptionsData.value : {};
      const cargoValues = normalizeDropdownValues([
        ...CARGO_OPTIONS,
        ...((profileOptions.cargo ?? []).map((item) => item.label)),
      ]);
      const funcaoValues = normalizeDropdownValues([
        ...FUNCAO_OPTIONS,
        ...((profileOptions.funcao ?? []).map((item) => item.label)),
      ]);

      const instructionsSheet = workbook.addWorksheet('Instrucoes');
      instructionsSheet.columns = [
        { header: 'Tema', key: 'topic', width: 30 },
        { header: 'Detalhe', key: 'detail', width: 95 },
      ];
      instructionsSheet.addRows([
        { topic: 'Objetivo', detail: 'Preencher novos colaboradores para criação em massa no SMARTER HUB.' },
        { topic: 'Folha de preenchimento', detail: 'Usa apenas a folha "Importacao" para inserir dados.' },
        { topic: 'Campos obrigatórios', detail: 'Nome completo, Username e Email.' },
        { topic: 'Dropdowns', detail: 'Campos com lista têm validação automática (país, equipa e campos de domínio).' },
        { topic: 'Equipa', detail: 'Seleciona Equipa principal. Se existir subequipa, preencher também o campo Subequipa com valor da lista.' },
        { topic: 'Comprovativos', detail: 'Campos de comprovativos não fazem parte da importação. Devem ser anexados depois na ficha de cada colaborador.' },
        { topic: 'Limite', detail: 'Máximo de 200 linhas por importação.' },
      ]);
      instructionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      instructionsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D75' } };

      const worksheet = workbook.addWorksheet('Importacao');
      worksheet.columns = IMPORT_TEMPLATE_FIELDS.map((field) => ({
        header: field.label,
        key: field.key,
        width: Math.max(18, field.label.length + 6),
      }));

      const requirementRow = worksheet.getRow(1);
      requirementRow.values = IMPORT_TEMPLATE_FIELDS.map((field) => (field.required ? 'Obrigatório' : 'Opcional'));
      requirementRow.font = { bold: true, color: { argb: 'FF123D75' } };
      requirementRow.alignment = { vertical: 'middle', horizontal: 'center' };
      requirementRow.eachCell((cell: any, columnNumber: number) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: IMPORT_TEMPLATE_FIELDS[columnNumber - 1]?.required ? 'FFE6F4EA' : 'FFF4F7FB' },
        };
      });

      const headerRow = worksheet.getRow(2);
      headerRow.values = IMPORT_TEMPLATE_FIELDS.map((field) => (field.required ? `${field.label} *` : field.label));
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D75' } };

      worksheet.addRow(Object.fromEntries(IMPORT_TEMPLATE_FIELDS.map((field) => [field.key, field.example])));
      worksheet.views = [{ state: 'frozen', ySplit: 2 }];

      const listsSheet = workbook.addWorksheet('Listas');
      const listDefinitions: Array<{ key: string; title: string; values: string[] }> = [
        { key: 'workCountry', title: 'País de trabalho', values: ['PT', 'BR'] },
        { key: 'teamName', title: 'Equipa principal', values: teams.filter((team) => !team.parentTeamId).map((team) => team.name).sort((a, b) => a.localeCompare(b, 'pt-PT')) },
        { key: 'subTeamName', title: 'Subequipa', values: teams.filter((team) => Boolean(team.parentTeamId)).map((team) => team.name).sort((a, b) => a.localeCompare(b, 'pt-PT')) },
        { key: 'genero', title: 'Género', values: [...generoOptions] },
        { key: 'estadoCivil', title: 'Estado civil', values: [...estadoCivilOptions] },
        { key: 'habilitacoesLiterarias', title: 'Habilitações literárias', values: [...habilitacoesOptions] },
        { key: 'situacaoIrs', title: 'Situação IRS', values: [...situacaoIrsOptions] },
        { key: 'irsJovem', title: 'IRS Jovem', values: [...irsJovemOptions] },
        { key: 'contactoEmergenciaParentesco', title: 'Parentesco', values: [...parentescoOptions] },
        { key: 'tipoContrato', title: 'Tipo de contrato', values: [...tipoContratoOptions] },
        { key: 'regimeHorario', title: 'Regime horário', values: [...regimeHorarioOptions] },
        { key: 'cargo', title: 'Cargo', values: cargoValues },
        { key: 'funcao', title: 'Função', values: funcaoValues },
      ];

      const listRanges = new Map<string, string>();
      listDefinitions.forEach((definition, listIndex) => {
        const column = listIndex + 1;
        const columnLetter = toExcelColumnLetter(column);
        listsSheet.getCell(1, column).value = definition.title;
        listsSheet.getCell(1, column).font = { bold: true };

        const values = definition.values.length > 0 ? definition.values : [''];
        values.forEach((value, valueIndex) => {
          listsSheet.getCell(valueIndex + 2, column).value = value;
        });

        listRanges.set(definition.key, `=Listas!$${columnLetter}$2:$${columnLetter}$${values.length + 1}`);
      });

      const teamToSubTeams = new Map<string, string[]>();
      for (const team of teams) {
        if (!team.parentTeamId) {
          continue;
        }
        const parent = teams.find((candidate) => candidate.id === team.parentTeamId);
        if (!parent) {
          continue;
        }
        const current = teamToSubTeams.get(parent.name) ?? [];
        current.push(team.name);
        teamToSubTeams.set(parent.name, current);
      }

      const placeholderColumn = toExcelColumnLetter(listDefinitions.length + 1);
      listsSheet.getCell(`${placeholderColumn}1`).value = 'placeholder';
      listsSheet.getCell(`${placeholderColumn}2`).value = '';

      let namedRangeColumn = listDefinitions.length + 2;
      for (const [parentTeamName, subTeams] of teamToSubTeams.entries()) {
        const sortedSubTeams = [...subTeams].sort((a, b) => a.localeCompare(b, 'pt-PT'));
        const colLetter = toExcelColumnLetter(namedRangeColumn);
        listsSheet.getCell(`${colLetter}1`).value = parentTeamName;
        sortedSubTeams.forEach((subTeamName, index) => {
          listsSheet.getCell(`${colLetter}${index + 2}`).value = subTeamName;
        });
        workbook.definedNames.add(`Listas!$${colLetter}$2:$${colLetter}$${sortedSubTeams.length + 1}`, toExcelDefinedName(parentTeamName));
        namedRangeColumn += 1;
      }

      listsSheet.state = 'veryHidden';

      const teamColumnIndex = IMPORT_TEMPLATE_FIELDS.findIndex((field) => field.key === 'teamName') + 1;
      const subTeamColumnIndex = IMPORT_TEMPLATE_FIELDS.findIndex((field) => field.key === 'subTeamName') + 1;
      const teamColumnLetter = toExcelColumnLetter(teamColumnIndex);
      const subTeamColumnLetter = toExcelColumnLetter(subTeamColumnIndex);

      IMPORT_TEMPLATE_FIELDS.forEach((field, index) => {
        if (!field.dropdownKey) {
          return;
        }
        const formula = listRanges.get(field.dropdownKey);
        if (!formula) {
          return;
        }
        const columnLetter = toExcelColumnLetter(index + 1);
        for (let rowIndex = 3; rowIndex <= 2002; rowIndex += 1) {
          const isSubTeamColumn = columnLetter === subTeamColumnLetter;
          worksheet.getCell(`${columnLetter}${rowIndex}`).dataValidation = isSubTeamColumn
            ? {
                type: 'list',
                allowBlank: true,
                formulae: [
                  `=IF($${teamColumnLetter}${rowIndex}="",Listas!$${placeholderColumn}$2:$${placeholderColumn}$2,INDIRECT("SUBTEAM_"&UPPER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($${teamColumnLetter}${rowIndex}," ","_"),"-","_"),".","_"),"/","_"))))`,
                ],
                showErrorMessage: true,
                errorTitle: 'Subequipa inválida',
                error: 'Escolhe uma subequipa pertencente à equipa principal selecionada.',
              }
            : {
                type: 'list',
                allowBlank: true,
                formulae: [formula],
                showErrorMessage: true,
                errorTitle: 'Valor inválido',
                error: 'Escolhe um valor da lista disponível.',
              };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'modelo_importacao_colaboradores.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Falha ao gerar modelo de importacao XLSX', error);
      setStatus(error instanceof Error ? error.message : 'Falha ao gerar modelo de importação.');
    }
  }

  async function importUsersFromFile() {
    if (importRows.length === 0) {
      setStatus('Escolhe um ficheiro com linhas válidas para importar.');
      return;
    }

    if (importIssues.length > 0) {
      setStatus('Corrige os problemas do ficheiro antes de iniciar a importação.');
      return;
    }

    setIsImportingUsers(true);

    try {
      const response = await apiRequest<CollaboratorImportResponse>('/users/import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          rows: importRows.map((row) => ({
            fullName: row.fullName,
            username: row.username,
            email: row.email,
            workCountry: row.workCountry,
            teamName: row.teamName || undefined,
            subTeamName: row.subTeamName || undefined,
            profile: row.profile,
          })),
        }),
      });

      setImportResults(response.results);
      clearApiCache('/users/collaborators');
      await loadCollaborators();

      if (response.failedCount === 0) {
        setStatus(`${response.createdCount} colaborador(es) criado(s) com sucesso.`);
        closeImportModal();
      } else {
        setStatus(`${response.createdCount} criado(s) e ${response.failedCount} falhado(s). Revê o resultado abaixo.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao importar colaboradores.');
    } finally {
      setIsImportingUsers(false);
    }
  }

  function openCreateModal() {
    setNewUserDraft({ fullName: '', username: '', email: '', workCountry: 'PT' });
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setNewUserDraft({ fullName: '', username: '', email: '', workCountry: 'PT' });
  }

  async function createUser() {
    const parts = newUserDraft.fullName.trim().split(/\s+/).filter((p) => p.length > 0);
    const firstName = parts[0] || '';
    const lastName = parts[parts.length - 1] || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const username = newUserDraft.username.trim().toLowerCase();
    const email = newUserDraft.email.trim().toLowerCase();
    const workCountry = newUserDraft.workCountry;

    if (!firstName || !lastName || !username || !email) {
      setStatus('Preenche nome completo, username e email.');
      return;
    }

    setIsCreatingUser(true);
    try {
      await apiRequest<{ id: string; username: string; email: string }>('/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ fullName, username, email, role: 'COLABORADOR', workCountry }),
      });
      clearApiCache('/users/collaborators');
      closeCreateModal();
      setStatus('Novo utilizador criado com sucesso.');
      void loadCollaborators();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao criar utilizador.');
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function saveCredentials() {
    if (!selectedRow) return;
    const username = credentialsDraft.username.trim().toLowerCase();
    const email = credentialsDraft.email.trim().toLowerCase();

    if (!username || !email) {
      setStatus('Username e email são obrigatórios.');
      return;
    }

    const payload: { username?: string; email?: string } = {};
    if (username !== selectedRow.username) payload.username = username;
    if (email !== selectedRow.email) payload.email = email;

    if (Object.keys(payload).length === 0) {
      setStatus('Sem alterações para guardar.');
      return;
    }

    setIsSavingCredentials(true);
    try {
      await apiRequest(`/admin/users/${selectedRow.id}/credentials`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      clearApiCache('/users/collaborators');
      void loadCollaborators();
      setStatus('Credenciais atualizadas com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar credenciais.');
    } finally {
      setIsSavingCredentials(false);
    }
  }

  if (!canView) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área está disponível para Admin e RH (Coordenador).</p>
        </article>
      </section>
    );
  }

  return (
    <section className="trainings-shell">

      <section className="trainings-list-card">
        <div className="people-page-header">
          <div>
            <h3>Colaboradores</h3>
            <p>Gestão de pessoas, permissões e credenciais de acesso.</p>
          </div>
          <div className="people-page-header__actions">
            {canCreateUser && (
              <Button type="button" variant="primary" onClick={openCreateModal}>+ Novo utilizador</Button>
            )}
            {canCreateUser && (
              <Button type="button" variant="secondary" onClick={openImportModal}>Importar em massa</Button>
            )}
            <Button type="button" variant="primary" onClick={openExportModal}>
            Exportar
          </Button>
          </div>
        </div>

        <div className="collaborators-filter-grid">
          <label>
            <span>Pesquisar</span>
            <input
              ref={collaboratorQueryInputRef}
              type="search"
              value={query}
              autoComplete="off"
              onChange={(event) => { setPage(1); setQuery(event.target.value); }}
              placeholder="Nome, username, email, cargo, função..."
            />
          </label>

          <label>
            <span>Role</span>
            <select value={roleFilter} onChange={(event) => { setPage(1); setRoleFilter(event.target.value as 'ALL' | CollaboratorRow['role']); }}>
              <option value="ALL">Todas</option>
              <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
              <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
              <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
              <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
            </select>
          </label>

          <label>
            <span>Estado</span>
            <select value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE'); }}>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
              <option value="ALL">Todos</option>
            </select>
          </label>

          <label>
            <span>País</span>
            <select value={countryFilter} onChange={(event) => { setPage(1); setCountryFilter(event.target.value as 'ALL' | 'PT' | 'BR'); }}>
              <option value="ALL">Todos</option>
              <option value="PT">Portugal</option>
              <option value="BR">Brasil</option>
            </select>
          </label>

          <label>
            <span>Ordenar por</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'createdAt' | 'updatedAt' | 'username' | 'email' | 'role')}>
              <option value="updatedAt">Atualização</option>
              <option value="createdAt">Criação</option>
              <option value="username">Username</option>
              <option value="email">Email</option>
              <option value="role">Role</option>
            </select>
          </label>

          <label>
            <span>Direção</span>
            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}>
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </label>

          <label>
            <span>Tamanho página</span>
            <select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>

        <div className="collaborators-table">
          <DataTable
            columns={[
            { key: 'name', header: 'Colaborador', render: (item: CollaboratorRow) => <span className="collaborator-cell-text" title={getDisplayName(item)}>{getDisplayName(item)}</span> },
            { key: 'email', header: 'Email', render: (item: CollaboratorRow) => <span className="table-nowrap">{item.email}</span> },
            {
              key: 'team',
              header: 'Equipa',
              render: (item: CollaboratorRow) => {
                const teams = getCollaboratorTeams(item);
                if (teams.length === 0) {
                  return <span className="collaborator-cell-text">-</span>;
                }

                const mainTeam = teams[0];
                const extraTeams = teams.slice(1);
                const fullTeamList = teams
                  .map((team) => `${team.isLeader ? 'Chefe · ' : ''}${team.name}`)
                  .join(' • ');

                return (
                  <div className="collaborator-team-cell" title={fullTeamList}>
                    <span className={`collaborator-team-chip${mainTeam.isLeader ? ' is-leader' : ''}`}>
                      {mainTeam.isLeader ? 'Chefe · ' : ''}{mainTeam.name}
                    </span>
                    {extraTeams.length > 0 && (
                      <span className="collaborator-team-more">+{extraTeams.length}</span>
                    )}
                  </div>
                );
              },
            },
            { key: 'country', header: 'País', render: (item: CollaboratorRow) => <Badge tone="neutral">{item.profile?.workCountry || 'PT'}</Badge> },
            {
              key: 'state',
              header: 'Estado',
              render: (item: CollaboratorRow) => (
                <Badge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (item: CollaboratorRow) => (
                <div className="collaborators-actions">
                  <Button type="button" size="sm" variant="primary" onClick={() => void openDetails(item)}>Editar</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void openDetails(item, 'permissoes')} disabled={!canManagePermissions}>Permissões</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.isActive ? 'danger' : 'secondary'}
                    isLoading={busyUserId === item.id}
                    onClick={() => openActiveConfirm(item)}
                    disabled={!canManageActive}
                  >
                    {item.isActive ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ),
              align: 'right',
            },
            ]}
            rows={visibleRows}
            rowKey={(item) => item.id}
            emptyMessage="Sem colaboradores para os filtros aplicados."
            loading={loading}
            loadingLines={4}
            ariaLabel="Lista de colaboradores"
          />
        </div>

        <div className="trainings-form-actions trainings-form-actions--between">
          <small>Resultados: {visibleTotal}</small>
          <div className="trainings-form-actions__group">
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Anterior</Button>
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Seguinte</Button>
          </div>
        </div>
      </section>

      <Modal
        open={isDetailsOpen}
        title={selectedRow ? getDisplayName(selectedRow) : 'Colaborador'}
        onClose={closeDetails}
        width="min(1360px, 97vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={closeDetails}>Fechar</Button>
            {detailsTab === 'ficha' && canEditUser && (
              <Button type="button" variant="primary" isLoading={isSavingEditDraft} disabled={isSavingEditDraft} onClick={() => void saveCollaboratorDraft()}>
                Guardar ficha
              </Button>
            )}
          </div>
        }
      >
        <section className="collaborator-modal-shell">
          <nav className="collaborator-modal-tabs">
            <button type="button" className={detailsTab === 'ficha' ? 'is-active' : ''} onClick={() => setDetailsTab('ficha')}>1. Ficha</button>
            <button type="button" className={detailsTab === 'permissoes' ? 'is-active' : ''} onClick={() => setDetailsTab('permissoes')}>2. Permissões</button>
            <button type="button" className={detailsTab === 'estado' ? 'is-active' : ''} onClick={() => setDetailsTab('estado')}>3. Estado</button>
          </nav>

          {selectedRow && detailsTab === 'ficha' && (
            <section className="cm-panel">
              <div className="cm-identity-bar">
                <div className="cm-avatar">{getDisplayName(selectedRow).charAt(0).toUpperCase()}</div>
                <div className="cm-identity-info">
                  <strong>{getDisplayName(selectedRow)}</strong>
                  <span>@{selectedRow.username} · {selectedRow.email}</span>
                </div>
                <div className="cm-identity-badges">
                  <Badge tone="info">{formatRoleLabel(selectedRow.role)}</Badge>
                  <Badge tone="neutral">{selectedRow.profile?.workCountry || 'PT'}</Badge>
                  <Badge tone={selectedRow.isActive ? 'success' : 'danger'}>{selectedRow.isActive ? 'Ativo' : 'Inativo'}</Badge>
                </div>
                {canManageProfileOptions && (
                  <div className="cm-identity-actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => void openProfileOptionModal('CARGO')}>+ Cargo</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void openProfileOptionModal('FUNCAO')}>+ Função</Button>
                  </div>
                )}
              </div>

              <div className="cm-edit-body">
                <article className="cm-section">
                  <h5 className="cm-section-title">Conta</h5>
                  <div className="collaborator-edit-grid collaborator-edit-grid--top">
                    <label>
                      <span>Username</span>
                      <input
                        type="text"
                        value={canEditCredentials ? credentialsDraft.username : selectedRow.username}
                        onChange={(e) => setCredentialsDraft((c) => ({ ...c, username: e.target.value }))}
                        disabled={!canEditCredentials}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      <span>Email login</span>
                      <input
                        type="email"
                        value={canEditCredentials ? credentialsDraft.email : selectedRow.email}
                        onChange={(e) => setCredentialsDraft((c) => ({ ...c, email: e.target.value }))}
                        disabled={!canEditCredentials}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <select value={editDraft.role} onChange={(event) => setEditDraft((current) => ({ ...current, role: event.target.value as CollaboratorRow['role'] }))} disabled={!canEditUser}>
                        <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
                        <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
                        <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
                        <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
                      </select>
                    </label>
                    <label>
                      <span>País de trabalho</span>
                      <select value={editDraft.workCountry} onChange={(event) => setEditDraft((current) => ({ ...current, workCountry: event.target.value as 'PT' | 'BR' }))} disabled={!canEditUser}>
                        <option value="PT">Portugal</option>
                        <option value="BR">Brasil</option>
                      </select>
                    </label>
                    <label>
                      <span>Equipa principal</span>
                      <select value={editDraft.teamId} onChange={(event) => setEditDraft((current) => ({ ...current, teamId: event.target.value }))} disabled={!canEditUser || editDraft.role === 'ADMIN'}>
                        <option value="">Sem equipa</option>
                        {collaboratorTeamOptions.map((team) => (
                          <option key={team.id} value={team.id}>{team.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Estado da conta</span>
                      <select value={editDraft.isActive ? 'ACTIVE' : 'INACTIVE'} onChange={(event) => setEditDraft((current) => ({ ...current, isActive: event.target.value === 'ACTIVE' }))} disabled={!canEditUser || selectedRow.username === 't.people'}>
                        <option value="ACTIVE">Ativa</option>
                        <option value="INACTIVE">Inativa</option>
                      </select>
                    </label>
                  </div>
                  {canEditCredentials && (
                    <div className="cm-inline-action">
                      <Button type="button" size="sm" variant="secondary" isLoading={isSavingCredentials} onClick={() => void saveCredentials()}>
                        Guardar credenciais
                      </Button>
                      <small>Altera username e email de acesso ao sistema.</small>
                    </div>
                  )}
                </article>

                {['identificacao', 'contactos', 'fiscal', 'emergencia', 'contrato'].map((section) => (
                  <article key={section} className="cm-section">
                    <h5 className="cm-section-title">{section === 'identificacao' ? 'Identificação' : section === 'contactos' ? 'Contactos e moradas' : section === 'fiscal' ? 'Fiscal e documentos' : section === 'emergencia' ? 'Emergência' : 'Contrato'}</h5>
                    <div className="collaborator-edit-grid">
                      {EDIT_PROFILE_FIELDS.filter((field) => field.section === section).map((field) => (
                        <label key={field.key}>
                          <span>{field.label}</span>
                          {renderEditFieldControl(field.key)}
                        </label>
                      ))}
                    </div>
                  </article>
                ))}

                {!canEditUser && <p className="cm-no-permission">Sem permissões para editar dados deste colaborador.</p>}
              </div>
            </section>
          )}

          {selectedRow && detailsTab === 'permissoes' && (
            <section className="cm-panel">
              {isLoadingDetails ? (
                <Skeleton lines={3} />
              ) : (
                <>
                  {selectedUserAccessTotal && (
                    <div className="cm-access-total-banner">
                      <div className="cm-access-total-banner__info">
                        <strong>Acesso total ativo</strong>
                        <span>Este utilizador tem acesso efetivo a todas as permissões do sistema. As configurações individuais estão suspensas.</span>
                      </div>
                      {canManagePermissions && selectedRow.username !== 't.people' && (
                        <Button type="button" size="sm" variant="ghost" isLoading={isTogglingAccessTotal} disabled={isTogglingAccessTotal} onClick={() => void toggleAccessTotalForSelected(false)}>
                          Revogar
                        </Button>
                      )}
                    </div>
                  )}
                  {!selectedUserAccessTotal && canManagePermissions && selectedRow.username !== 't.people' && (
                    <div className="cm-perms-top-bar">
                      <Button type="button" size="sm" variant="secondary" isLoading={isTogglingAccessTotal} disabled={isTogglingAccessTotal} onClick={() => void toggleAccessTotalForSelected(true)}>
                        Dar acesso total
                      </Button>
                    </div>
                  )}

                  <div className="cm-perms-body">
                    <aside className="cm-perm-categories">
                      {PERMISSION_CATEGORIES.map((item) => (
                        <button key={item} type="button" className={item === permissionCategory ? 'is-active' : ''} onClick={() => setPermissionCategory(item)}>
                          {getPermissionCategoryLabel(item)}
                        </button>
                      ))}
                    </aside>

                    <div className="cm-perm-main">
                      <div className="cm-perm-list">
                        <input
                          type="search"
                          className="cm-perm-search"
                          placeholder="Pesquisar permissão..."
                          value={permissionSearch}
                          onChange={(event) => setPermissionSearch(event.target.value)}
                        />
                        <div className="cm-perm-items">
                          {filteredCategoryPermissions.length === 0 && (
                            <EmptyState title="Sem permissões" message="Escolhe outra categoria." />
                          )}
                          {filteredCategoryPermissions.map((permission) => {
                            const draft = permissionDrafts[permission.id] ?? buildDraftFromAssignment(permission);
                            const effectiveEnabled = selectedUserAccessTotal || draft.enabled;
                            return (
                              <button
                                key={permission.id}
                                type="button"
                                className={`cm-perm-item${selectedPermission?.id === permission.id ? ' is-selected' : ''}${effectiveEnabled ? ' is-on' : ''}`}
                                onClick={() => setSelectedPermissionId(permission.id)}
                              >
                                <strong>{permission.label}</strong>
                                <span>{effectiveEnabled ? '● Ativa' : '○ Inativa'}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="cm-perm-editor">
                        {!selectedPermission || !selectedPermissionDraft ? (
                          <p className="cm-perm-empty">Seleciona uma permissão para configurar.</p>
                        ) : (
                          <>
                            <header className="cm-perm-editor-head">
                              <h5>{selectedPermission.label}</h5>
                              <p>{selectedPermission.description}</p>
                            </header>

                            <div className="cm-perm-editor-form">
                              <div className="cm-perm-field cm-perm-field--toggle">
                                <span>Estado</span>
                                <div className="cm-toggle-btns">
                                  <button type="button" className={selectedPermissionDraft.enabled ? 'is-on' : ''} onClick={() => setPermissionDrafts((current) => ({ ...current, [selectedPermission.id]: { ...selectedPermissionDraft, enabled: true } }))} disabled={!canManagePermissions || selectedUserAccessTotal}>Ativa</button>
                                  <button type="button" className={!selectedPermissionDraft.enabled ? 'is-on' : ''} onClick={() => setPermissionDrafts((current) => ({ ...current, [selectedPermission.id]: { ...selectedPermissionDraft, enabled: false } }))} disabled={!canManagePermissions || selectedUserAccessTotal}>Inativa</button>
                                </div>
                              </div>

                              <div className="cm-perm-field">
                                <span>Países</span>
                                <div className="cm-token-pills">
                                  {['PT', 'BR'].map((country) => (
                                    <button
                                      key={country}
                                      type="button"
                                      className={selectedRestrictionCountries.includes(country) ? 'is-on' : ''}
                                      onClick={() => setPermissionDrafts((current) => ({
                                        ...current,
                                        [selectedPermission.id]: {
                                          ...selectedPermissionDraft,
                                          restrictedToCountries: toggleCommaItem(selectedPermissionDraft.restrictedToCountries, country),
                                        },
                                      }))}
                                      disabled={!canManagePermissions || selectedUserAccessTotal}
                                    >
                                      {country}
                                    </button>
                                  ))}
                                </div>
                                <small>Vazio = todos os países.</small>
                              </div>

                              <div className="cm-perm-field">
                                <span>Equipas</span>
                                <div className="collab-team-selector">
                                  <select value={pendingTeamToAdd} onChange={(event) => setPendingTeamToAdd(event.target.value)} disabled={!canManagePermissions || selectedUserAccessTotal || availableTeamsToAdd.length === 0}>
                                    <option value="">Selecionar equipa</option>
                                    {availableTeamsToAdd.map((team) => (
                                      <option key={team.id} value={team.id}>{team.name}</option>
                                    ))}
                                  </select>
                                  <Button type="button" size="sm" variant="secondary" onClick={() => addTeamRestriction(pendingTeamToAdd)} disabled={!canManagePermissions || selectedUserAccessTotal || !pendingTeamToAdd}>+</Button>
                                </div>
                                {selectedRestrictedTeams.length > 0 && (
                                  <div className="collab-team-chips">
                                    {selectedRestrictedTeams.map((team) => (
                                      <button key={team.id} type="button" className="collab-team-chip" onClick={() => removeTeamRestriction(team.id)} disabled={!canManagePermissions || selectedUserAccessTotal}>
                                        {team.name} ×
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <small>Vazio = todas as equipas.</small>
                              </div>

                              <div className="cm-perm-field">
                                <span>Notas</span>
                                <input
                                  type="text"
                                  value={selectedPermissionDraft.notes}
                                  onChange={(event) => setPermissionDrafts((current) => ({
                                    ...current,
                                    [selectedPermission.id]: { ...selectedPermissionDraft, notes: event.target.value },
                                  }))}
                                  placeholder="Contexto opcional"
                                  disabled={!canManagePermissions || selectedUserAccessTotal}
                                />
                              </div>
                            </div>

                            <div className="cm-perm-editor-footer">
                              <small>Por: {getGrantDisplayName(selectedPermission.assignment?.grantedBy)}</small>
                              <Button type="button" variant="primary" size="sm" isLoading={savingPermissionId === selectedPermission.id} onClick={() => void savePermission(selectedPermission)} disabled={!canManagePermissions || selectedUserAccessTotal}>
                                Guardar
                              </Button>
                            </div>
                            {selectedUserAccessTotal && <small className="cm-perm-disabled-hint">Revoga o acesso total para editar permissões individuais.</small>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {selectedRow && detailsTab === 'estado' && (
            <section className="cm-panel cm-panel--estado">
              {isLoadingDetails ? (
                <Skeleton lines={3} />
              ) : (
                <>
                  <div className="cm-status-cards">
                    <div className={`cm-status-card${selectedRow.isActive ? ' cm-status-card--active' : ' cm-status-card--inactive'}`}>
                      <span>Conta</span>
                      <strong>{selectedRow.isActive ? 'Ativa' : 'Inativa'}</strong>
                    </div>
                    <div className={`cm-status-card${selectedUserAccessTotal ? ' cm-status-card--total' : ''}`}>
                      <span>Acesso total</span>
                      <strong>{selectedUserAccessTotal ? 'Ativo' : 'Inativo'}</strong>
                    </div>
                    <div className="cm-status-card">
                      <span>Última atualização</span>
                      <strong>{new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(selectedRow.updatedAt))}</strong>
                    </div>
                  </div>
                  <div className="cm-status-actions">
                    <Button
                      type="button"
                      variant={selectedRow.isActive ? 'danger' : 'primary'}
                      onClick={() => openActiveConfirm(selectedRow)}
                      disabled={!canManageActive || selectedRow.username === 't.people'}
                    >
                      {selectedRow.isActive ? 'Desativar conta' : 'Reativar conta'}
                    </Button>
                    {canManagePermissions && selectedRow.username !== 't.people' && !selectedUserAccessTotal && (
                      <Button type="button" variant="secondary" size="sm" isLoading={isTogglingAccessTotal} disabled={isTogglingAccessTotal} onClick={() => void toggleAccessTotalForSelected(true)}>
                        Dar acesso total
                      </Button>
                    )}
                    {canManagePermissions && selectedRow.username !== 't.people' && selectedUserAccessTotal && (
                      <Button type="button" variant="ghost" size="sm" isLoading={isTogglingAccessTotal} disabled={isTogglingAccessTotal} onClick={() => void toggleAccessTotalForSelected(false)}>
                        Revogar acesso total
                      </Button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </section>
      </Modal>

      <Modal
        open={isExportModalOpen}
        title="Exportar ficha de colaborador"
        onClose={() => setIsExportModalOpen(false)}
        width="min(980px, 96vw)"
        showCloseButton={false}
        footer={(
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setIsExportModalOpen(false)} disabled={isExportingWorkbook}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              isLoading={isExportingWorkbook}
              disabled={!selectedExportCandidate || isLoadingExportCandidates || isExportingWorkbook}
              onClick={() => void exportSelectedCollaboratorWorkbook()}
            >
              Exportar Excel
            </Button>
          </div>
        )}
      >
        <div className="collaborator-export-modal">
          <label className="collaborator-export-modal__search">
            <span>Pesquisar colaborador</span>
            <input
              type="search"
              value={exportSearch}
              placeholder="Nome, username, email, cargo, função, equipa..."
              onChange={(event) => setExportSearch(event.target.value)}
            />
          </label>

          {isLoadingExportCandidates ? (
            <Skeleton lines={4} />
          ) : exportCandidatesFiltered.length === 0 ? (
            <EmptyState
              title="Sem colaboradores para exportação."
              message="Ajusta os filtros da listagem ou a pesquisa da janela de exportação."
            />
          ) : (
            <div className="collaborator-export-modal__layout">
              <aside className="collaborator-export-list" aria-label="Selecionar colaborador para exportação">
                {exportCandidatesFiltered.map((item) => {
                  const teamInfo = getCollaboratorTeamInfo(item);
                  const isSelected = selectedExportUserId === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`collaborator-export-item${isSelected ? ' is-selected' : ''}`}
                      onClick={() => setSelectedExportUserId(item.id)}
                    >
                      <strong>{getDisplayName(item)}</strong>
                      <span>{item.email}</span>
                      <small>{item.profile?.cargo || '-'} · {teamInfo.name === '-' ? 'Sem equipa' : teamInfo.name}</small>
                    </button>
                  );
                })}
              </aside>

              <section className="collaborator-export-preview" aria-live="polite">
                {selectedExportCandidate ? (
                  <>
                    <h4>{getDisplayName(selectedExportCandidate)}</h4>
                    <p>{selectedExportCandidate.email}</p>
                    <div className="collaborator-export-preview__grid">
                      <article>
                        <span>Cargo</span>
                        <strong>{selectedExportCandidate.profile?.cargo || '-'}</strong>
                      </article>
                      <article>
                        <span>Função</span>
                        <strong>{selectedExportCandidate.profile?.funcao || '-'}</strong>
                      </article>
                      <article>
                        <span>País</span>
                        <strong>{selectedExportCandidate.profile?.workCountry || 'PT'}</strong>
                      </article>
                      <article>
                        <span>Equipa</span>
                        <strong>{getCollaboratorTeamInfo(selectedExportCandidate).name === '-' ? 'Sem equipa' : getCollaboratorTeamInfo(selectedExportCandidate).name}</strong>
                      </article>
                    </div>
                    <small>O ficheiro inclui logo, resumo executivo e detalhe da ficha por secções para leitura profissional.</small>
                  </>
                ) : (
                  <EmptyState
                    title="Seleciona um colaborador"
                    message="Escolhe um registo na lista para preparar a exportação."
                  />
                )}
              </section>
            </div>
          )}
        </div>
      </Modal>

      {canCreateUser && (
        <Modal
          open={isImportModalOpen}
          title="Importação em massa de colaboradores"
          onClose={closeImportModal}
          width="min(1180px, 96vw)"
          showCloseButton={false}
          footer={(
            <div className="modal-footer-split">
              <Button type="button" variant="ghost" onClick={closeImportModal} disabled={isImportingUsers || isParsingImportFile}>
                Fechar
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isImportingUsers}
                disabled={isParsingImportFile || isImportingUsers || importRows.length === 0 || importIssues.length > 0}
                onClick={() => void importUsersFromFile()}
              >
                Importar {importRows.length > 0 ? `${importRows.length} linha(s)` : ''}
              </Button>
            </div>
          )}
        >
          <div className="collaborator-import-modal">
            <div className="collaborator-import-modal__hero">
              <div>
                <strong>Excel ou CSV da ficha</strong>
                <p>Importa novos colaboradores em lote a partir de um ficheiro com dados da ficha. Campos de comprovativos não entram neste processo e devem ser anexados depois na ficha individual. Esta ação está disponível apenas para quem tem acesso total.</p>
              </div>
              <div className="collaborator-import-modal__hero-actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => void downloadImportTemplate()}>
                  Descarregar modelo XLSX
                </Button>
                <label className="collaborator-import-upload">
                  <span>{isParsingImportFile ? 'A ler ficheiro...' : 'Escolher ficheiro'}</span>
                  <input type="file" accept={IMPORT_FILE_ACCEPT} onChange={(event) => void handleImportFileChange(event)} disabled={isParsingImportFile || isImportingUsers} />
                </label>
              </div>
            </div>

            <div className="collaborator-import-meta">
              <article>
                <span>Ficheiro</span>
                <strong>{importFileName || 'Nenhum selecionado'}</strong>
              </article>
              <article>
                <span>Linhas preparadas</span>
                <strong>{importRows.length}</strong>
              </article>
              <article>
                <span>Problemas locais</span>
                <strong>{importIssues.length}</strong>
              </article>
            </div>

            {importIssues.length > 0 && (
              <div className="collaborator-import-issues">
                <strong>Corrigir antes de importar</strong>
                <div className="collaborator-import-issues__list">
                  {importIssues.slice(0, 20).map((issue) => (
                    <p key={`${issue.rowNumber}-${issue.message}`}>Linha {issue.rowNumber}: {issue.message}</p>
                  ))}
                  {importIssues.length > 20 && <p>+ {importIssues.length - 20} problema(s) adicional(is)</p>}
                </div>
              </div>
            )}

            <div className="collaborator-import-preview">
              <div className="collaborator-import-preview__head">
                <strong>Pré-visualização</strong>
                <span>{importRows.length > 8 ? `A mostrar 8 de ${importRows.length} linhas` : `${importRows.length} linha(s)`}</span>
              </div>
              {importRows.length === 0 ? (
                <EmptyState title="Sem dados carregados" message="Seleciona um ficheiro Excel ou CSV para validar o conteúdo antes da importação." />
              ) : (
                <div className="collaborator-import-preview__table-wrap">
                  <table className="collaborator-import-preview__table">
                    <thead>
                      <tr>
                        <th>Linha</th>
                        <th>Nome</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>País</th>
                        <th>Equipa</th>
                        <th>Subequipa</th>
                        <th>Cargo</th>
                        <th>Função</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.map((row) => (
                        <tr key={`${row.rowNumber}-${row.username}-${row.email}`}>
                          <td>{row.rowNumber}</td>
                          <td>{row.fullName}</td>
                          <td>{row.username}</td>
                          <td>{row.email}</td>
                          <td>{row.workCountry}</td>
                          <td>{row.teamName || 'Sem equipa'}</td>
                          <td>{row.subTeamName || '-'}</td>
                          <td>{row.profile.cargo || '-'}</td>
                          <td>{row.profile.funcao || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {importResults.length > 0 && (
              <div className="collaborator-import-results">
                <div className="collaborator-import-results__head">
                  <strong>Resultado da execução</strong>
                  <span>{importCreatedCount} criado(s) · {importFailedCount} falhado(s)</span>
                </div>
                <div className="collaborator-import-results__list">
                  {importResults.map((item) => (
                    <article key={`${item.rowNumber}-${item.username}-${item.status}`} className={`collaborator-import-result${item.status === 'CREATED' ? ' is-success' : ' is-failed'}`}>
                      <div>
                        <strong>Linha {item.rowNumber} · {item.fullName || item.username || item.email}</strong>
                        <p>{item.username} · {item.email}</p>
                      </div>
                      <span>{item.message}</span>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      <Modal
        open={isProfileOptionModalOpen}
        title={profileOptionType === 'CARGO' ? 'Adicionar novo cargo' : 'Adicionar nova função'}
        onClose={() => setIsProfileOptionModalOpen(false)}
        width="520px"
        footer={(
          <div className="profile-option-modal__footer">
            <Button type="button" variant="ghost" onClick={() => setIsProfileOptionModalOpen(false)} disabled={isSavingProfileOption}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" isLoading={isSavingProfileOption} onClick={() => void handleCreateProfileOption()}>
              Guardar
            </Button>
          </div>
        )}
      >
        <div className="profile-option-modal">
          <label>
            <span>Tipo</span>
            <select value={profileOptionType} onChange={(event) => setProfileOptionType(event.target.value as 'CARGO' | 'FUNCAO')} disabled={isSavingProfileOption}>
              <option value="CARGO">Cargo</option>
              <option value="FUNCAO">Função</option>
            </select>
          </label>

          <label>
            <span>Nome</span>
            <input
              type="text"
              value={profileOptionLabel}
              disabled={isSavingProfileOption}
              placeholder={profileOptionType === 'CARGO' ? 'Ex.: Staff Engineer' : 'Ex.: Data Governance Specialist'}
              onChange={(event) => setProfileOptionLabel(event.target.value)}
            />
          </label>

          {profileOptionType === 'FUNCAO' && (
            <label>
              <span>Grupo (opcional)</span>
              <input
                type="text"
                value={profileOptionGroup}
                disabled={isSavingProfileOption}
                placeholder="Ex.: Produto"
                onChange={(event) => setProfileOptionGroup(event.target.value)}
              />
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(activeConfirmTarget)}
        title={activeConfirmTarget?.isActive ? 'Confirmar desativação' : 'Confirmar reativação'}
        onClose={() => setActiveConfirmTarget(null)}
        width="min(640px, 92vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setActiveConfirmTarget(null)}>Cancelar</Button>
            <Button
              type="button"
              variant={activeConfirmTarget?.isActive ? 'danger' : 'primary'}
              isLoading={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
              disabled={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
              onClick={() => void confirmToggleActive()}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>
            {activeConfirmTarget?.isActive
              ? `Isto vai desativar a conta de ${getDisplayName(activeConfirmTarget)}.`
              : `Isto vai reativar a conta de ${activeConfirmTarget ? getDisplayName(activeConfirmTarget) : 'este colaborador'}.`}
          </p>
        </div>
      </Modal>

      {canCreateUser && (
        <Modal
          open={isCreateModalOpen}
          title="Novo utilizador"
          onClose={closeCreateModal}
          width="min(700px, 94vw)"
          footer={
            <div className="modal-footer-split">
              <Button type="button" variant="ghost" onClick={closeCreateModal} disabled={isCreatingUser}>Cancelar</Button>
              <Button type="button" variant="primary" isLoading={isCreatingUser} onClick={() => void createUser()}>Criar utilizador</Button>
            </div>
          }
        >
          <form className="trainings-form" onSubmit={(e) => { e.preventDefault(); void createUser(); }}>
            <label>
              <span>Nome completo</span>
              <input
                type="text"
                value={newUserDraft.fullName}
                onChange={(e) => setNewUserDraft((c) => ({ ...c, fullName: e.target.value }))}
                placeholder="Ex.: Ana Rodrigues"
                autoComplete="off"
                disabled={isCreatingUser}
              />
              <small>O username e email são derivados automaticamente.</small>
            </label>
            <label>
              <span>Username</span>
              <input
                type="text"
                value={newUserDraft.username}
                onChange={(e) => setNewUserDraft((c) => ({ ...c, username: e.target.value }))}
                placeholder="ana.rodrigues"
                autoComplete="off"
                disabled={isCreatingUser}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={newUserDraft.email}
                onChange={(e) => setNewUserDraft((c) => ({ ...c, email: e.target.value }))}
                placeholder="ana.rodrigues@tlantic.com"
                autoComplete="off"
                disabled={isCreatingUser}
              />
            </label>
            <label>
              <span>País de trabalho</span>
              <select
                value={newUserDraft.workCountry}
                onChange={(e) => setNewUserDraft((c) => ({ ...c, workCountry: e.target.value as 'PT' | 'BR' }))}
                disabled={isCreatingUser}
              >
                <option value="PT">Portugal</option>
                <option value="BR">Brasil</option>
              </select>
            </label>
          </form>
        </Modal>
      )}

      <Toast show={Boolean(status)} tone={resolveStatusTone(status)} message={status} />
    </section>
  );
}
