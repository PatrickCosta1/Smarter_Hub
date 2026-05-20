import { Router } from "express";
import { z } from "zod";
import { Prisma, ProfileOptionType } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { getUserProfile } from "../services/profile/get-profile.service.js";
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  canReviewAccessTotalHierarchy,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from "../lib/permission-engine.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyUsers } from "../lib/notifications.js";
import {
  markCitizenCardExpiryNotificationsAsRead,
  shouldAutoResolveCitizenCardExpiryNotification,
} from '../lib/citizen-card-expiry-notifications.js';
import { createRequestTimer } from '../lib/request-timing.js';

const router = Router();

const defaultCargoOptions = [
  'Trainee',
  'Junior',
  'Associate',
  'Senior',
  'Lead',
  'Principal',
  'Director',
  'C Level',
];

const defaultFuncaoOptions = [
  { label: 'Administrative Assistant', groupLabel: 'Gestão e suporte' },
  { label: 'Business Analyst', groupLabel: 'Negócio e análise' },
  { label: 'Business Consultant', groupLabel: 'Negócio e análise' },
  { label: 'Business Controller', groupLabel: 'Negócio e análise' },
  { label: 'CEO', groupLabel: 'Direção' },
  { label: 'Communication Manager', groupLabel: 'Comunicação' },
  { label: 'Communication Specialist', groupLabel: 'Comunicação' },
  { label: 'Data Analyst', groupLabel: 'Dados e engenharia' },
  { label: 'Data Engineer', groupLabel: 'Dados e engenharia' },
  { label: 'Data Science Manager', groupLabel: 'Dados e engenharia' },
  { label: 'Data Scientist', groupLabel: 'Dados e engenharia' },
  { label: 'Delivery Director', groupLabel: 'Direção' },
  { label: 'Delivery Manager', groupLabel: 'Operações e delivery' },
  { label: 'DevOps Engineer', groupLabel: 'Dados e engenharia' },
  { label: 'DevOps Manager', groupLabel: 'Operações e delivery' },
  { label: 'Estagiario', groupLabel: 'Estágio' },
  { label: 'Managing Director', groupLabel: 'Direção' },
  { label: 'Operations & Control Director', groupLabel: 'Operações e control' },
  { label: 'Operations & Control Manager', groupLabel: 'Operações e control' },
  { label: 'People Director', groupLabel: 'Pessoas e cultura' },
  { label: 'People Manager', groupLabel: 'Pessoas e cultura' },
  { label: 'People Partner', groupLabel: 'Pessoas e cultura' },
  { label: 'Pre-Sales Consultant', groupLabel: 'Pré-venda e consultoria' },
  { label: 'Product Architect', groupLabel: 'Produto' },
  { label: 'Product Director', groupLabel: 'Produto' },
  { label: 'Product Manager', groupLabel: 'Produto' },
  { label: 'Product Owner', groupLabel: 'Produto' },
  { label: 'Project Manager', groupLabel: 'Gestão de projeto' },
  { label: 'Quality Analyst', groupLabel: 'Qualidade' },
  { label: 'Quality Manager', groupLabel: 'Qualidade' },
  { label: 'Sales Consultant', groupLabel: 'Comercial' },
  { label: 'Sales Director', groupLabel: 'Comercial' },
  { label: 'Sales Manager', groupLabel: 'Comercial' },
  { label: 'Scrum Master', groupLabel: 'Gestão de projeto' },
  { label: 'Service Analyst', groupLabel: 'Serviço' },
  { label: 'Service Director', groupLabel: 'Serviço' },
  { label: 'Service Engineer', groupLabel: 'Serviço' },
  { label: 'Service Manager', groupLabel: 'Serviço' },
  { label: 'Software Developer', groupLabel: 'Tecnologia' },
  { label: 'Software Engineer', groupLabel: 'Tecnologia' },
  { label: 'Strategic Solutions Consultant', groupLabel: 'Pré-venda e consultoria' },
  { label: 'Technical Consultant', groupLabel: 'Pré-venda e consultoria' },
  { label: 'UX UI Designer', groupLabel: 'Produto' },
];

function isPendingProfileRequestConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('ProfileChangeRequest_userId_pending_unique');
}

const defaultOptionsByType: Record<ProfileOptionType, Array<{ label: string; groupLabel?: string }>> = {
  CARGO: defaultCargoOptions.map((label) => ({ label })),
  FUNCAO: defaultFuncaoOptions,
};

const SENSITIVE_PROFILE_CHANGE_FIELDS = new Set([
  'dataNascimento',
  'emailPessoal',
  'telemovel',
  'moradaFiscal',
  'endereco',
  'localidade',
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
  'criminalRecordUrl',
]);

function normalizeDropdownOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeDropdownOptionKey(value: string) {
  return normalizeDropdownOptionLabel(value).toLowerCase();
}

function canViewSensitiveProfileChangeFields(isRootAccess: boolean, isAccessTotalFlag: boolean) {
  return isRootAccess || isAccessTotalFlag;
}

function redactProfileChangeRecord(
  payload: Record<string, unknown>,
  canViewSensitiveFields: boolean,
) {
  if (canViewSensitiveFields) {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      SENSITIVE_PROFILE_CHANGE_FIELDS.has(key) ? '[oculto]' : value,
    ]),
  );
}

function redactProfileChangeDetails(
  details: Array<{ fieldKey: string; field: string; oldValue: string; newValue: string }>,
  canViewSensitiveFields: boolean,
) {
  if (canViewSensitiveFields) {
    return details;
  }

  return details.map((detail) => (
    SENSITIVE_PROFILE_CHANGE_FIELDS.has(detail.fieldKey)
      ? { ...detail, oldValue: '[oculto]', newValue: '[oculto]' }
      : detail
  ));
}

const profileDropdownOptionSchema = z.object({
  type: z.nativeEnum(ProfileOptionType),
  label: z.string().min(2).max(80),
  groupLabel: z.string().max(60).optional(),
});

async function canManageProfileDropdownOptions(userId: string, isRootAccessFlag: boolean) {
  if (isRootAccessFlag) {
    return true;
  }

  if (await isAccessTotal(userId)) {
    return true;
  }

  return hasPermission(userId, 'manage_profile_dropdown_options');
}

router.get('/profile/options', requireAuth, async (req, res) => {
  const customOptions = await prisma.profileDropdownOption.findMany({
    where: { isActive: true },
    select: {
      id: true,
      type: true,
      label: true,
      groupLabel: true,
    },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  });

  return res.json({
    cargo: customOptions
      .filter((option) => option.type === 'CARGO')
      .map((option) => ({ id: option.id, label: option.label, groupLabel: option.groupLabel })),
    funcao: customOptions
      .filter((option) => option.type === 'FUNCAO')
      .map((option) => ({ id: option.id, label: option.label, groupLabel: option.groupLabel })),
  });
});

router.post('/profile/options', requireAuth, async (req, res) => {
  const allowed = await canManageProfileDropdownOptions(req.authUser!.id, req.authUser!.isRootAccess);
  if (!allowed) {
    return res.status(403).json({ message: 'Sem permissões para gerir cargos e funções.' });
  }

  const parsed = profileDropdownOptionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Payload inválido.', issues: parsed.error.issues });
  }

  const normalizedLabel = normalizeDropdownOptionLabel(parsed.data.label);
  const normalizedKey = normalizeDropdownOptionKey(parsed.data.label);
  const normalizedGroupLabel = normalizeDropdownOptionLabel(parsed.data.groupLabel || '');

  if (!normalizedLabel) {
    return res.status(400).json({ message: 'Indica um valor válido.' });
  }

  const defaultsForType = defaultOptionsByType[parsed.data.type];
  const existsInDefaults = defaultsForType.some((item) => normalizeDropdownOptionKey(item.label) === normalizedKey);
  if (existsInDefaults) {
    return res.status(409).json({ message: 'Esse valor já existe na lista base.' });
  }

  const existing = await prisma.profileDropdownOption.findUnique({
    where: {
      type_normalizedValue: {
        type: parsed.data.type,
        normalizedValue: normalizedKey,
      },
    },
  });

  if (existing?.isActive) {
    return res.status(409).json({ message: 'Esse valor já existe.' });
  }

  if (existing && !existing.isActive) {
    const restored = await prisma.profileDropdownOption.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        label: normalizedLabel,
        groupLabel: normalizedGroupLabel || null,
      },
      select: {
        id: true,
        type: true,
        label: true,
        groupLabel: true,
      },
    });

    return res.status(201).json({ option: restored });
  }

  const created = await prisma.profileDropdownOption.create({
    data: {
      type: parsed.data.type,
      label: normalizedLabel,
      normalizedValue: normalizedKey,
      groupLabel: normalizedGroupLabel || null,
      createdById: req.authUser!.id,
    },
    select: {
      id: true,
      type: true,
      label: true,
      groupLabel: true,
    },
  });

  return res.status(201).json({ option: created });
});

const profileFields = [
  "nomeCompleto",
  "nomeAbreviado",
  "dataNascimento",
  "genero",
  "estadoCivil",
  "habilitacoesLiterarias",
  "curso",
  "faculdade",
  "emailPessoal",
  "telemovel",
  "moradaFiscal",
  "endereco",
  "localidade",
  "codigoPostal",
  "matriculaCarro",
  "localNascimentoPais",
  "localNascimentoCidade",
  "nomePai",
  "nomeMae",
  "cartaoCidadao",
  "validadeCartaoCidadao",
  "nif",
  "cpf",
  "pis",
  "ctps",
  "ctpsSerie",
  "ctpsDataExpedicao",
  "rg",
  "rgOrgaoEmissor",
  "rgDataExpedicao",
  "cnh",
  "cnhCategoria",
  "cnhDataValidade",
  "tituloEleitor",
  "zonaEleitoral",
  "secaoEleitoral",
  "certificadoReservista",
  "niss",
  "iban",
  "situacaoIrs",
  "numeroDependentes",
  "declaracaoIrs",
  "irsJovem",
  "anoPrimeiroDesconto",
  "primeiroEmprego",
  "recebeAposentadoria",
  "recebeSeguroDesemprego",
  "valeTransporte",
  "numeroCartaoContinente",
  "voucherNosData",
  "comprovativoMoradaFiscal",
  "comprovativoCartaoCidadao",
  "comprovativoIban",
  "comprovativoCartaoContinente",
  "contactoEmergenciaNome",
  "contactoEmergenciaParentesco",
  "contactoEmergenciaNumero",
  "cargo",
  "categoriaProfissional",
  "numeroMecanografico",
  "funcao",
  "nacionalidade",
  "dataInicioContrato",
  "dataFimContrato",
  "tipoContrato",
  "regimeHorario",
  "githubUser",
  "workCountry",
  "brWorkState",
  "photoUrl",
  "certificadoHabilitacoesUrl",
  "cartaConducaoUrl",
  "criminalRecordUrl",
] as const;

function normalizeProfilePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload invalido.");
  }

  const source = payload as Record<string, unknown>;
  const normalized: Partial<Record<(typeof profileFields)[number], unknown>> = {};

  profileFields.forEach((field) => {
    if (!(field in source)) {
      return;
    }

    const rawValue = source[field];
    if (
      field === 'primeiroEmprego'
      || field === 'recebeAposentadoria'
      || field === 'recebeSeguroDesemprego'
      || field === 'valeTransporte'
    ) {
      normalized[field] = rawValue === true;
      return;
    }

    normalized[field] = rawValue == null ? "" : String(rawValue);
  });

  return normalized;
}

const optionalStringField = z.union([z.string(), z.null()]).transform((value) => value ?? '').optional();

// Campos obrigatórios com validação de formato
const requiredStringField = (label: string) => z.string().min(1, `${label} é obrigatório.`);

const updateProfileSchema = z.object({
  // REQUIRED FIELDS - Sincronizado com frontend validateProfile()
  nomeCompleto: requiredStringField('Nome completo'),
  nomeAbreviado: requiredStringField('Nome abreviado'),
  dataNascimento: requiredStringField('Data de nascimento'),
  genero: requiredStringField('Género'),
  estadoCivil: requiredStringField('Estado civil'),
  habilitacoesLiterarias: requiredStringField('Habilitações literárias'),
  emailPessoal: z.string().min(1, 'Email pessoal é obrigatório.').email('Email pessoal inválido.'),
  telemovel: requiredStringField('Telemóvel'),
  moradaFiscal: requiredStringField('Morada fiscal'),
  endereco: requiredStringField('Endereço'),
  localidade: requiredStringField('Localidade'),
  codigoPostal: requiredStringField('Código postal'),
  contactoEmergenciaNome: requiredStringField('Contacto de emergência - nome'),
  contactoEmergenciaParentesco: requiredStringField('Contacto de emergência - parentesco'),
  contactoEmergenciaNumero: requiredStringField('Contacto de emergência - número'),

  // OPTIONAL FIELDS
  curso: optionalStringField,
  faculdade: optionalStringField,
  matriculaCarro: optionalStringField,
  localNascimentoPais: optionalStringField,
  localNascimentoCidade: optionalStringField,
  nomePai: optionalStringField,
  nomeMae: optionalStringField,
  cartaoCidadao: optionalStringField,
  validadeCartaoCidadao: optionalStringField,
  nif: optionalStringField,
  cpf: optionalStringField,
  pis: optionalStringField,
  ctps: optionalStringField,
  ctpsSerie: optionalStringField,
  ctpsDataExpedicao: optionalStringField,
  rg: optionalStringField,
  rgOrgaoEmissor: optionalStringField,
  rgDataExpedicao: optionalStringField,
  cnh: optionalStringField,
  cnhCategoria: optionalStringField,
  cnhDataValidade: optionalStringField,
  tituloEleitor: optionalStringField,
  zonaEleitoral: optionalStringField,
  secaoEleitoral: optionalStringField,
  certificadoReservista: optionalStringField,
  niss: optionalStringField,
  iban: optionalStringField,
  situacaoIrs: optionalStringField,
  numeroDependentes: optionalStringField,
  declaracaoIrs: optionalStringField,
  irsJovem: optionalStringField,
  anoPrimeiroDesconto: optionalStringField,
  primeiroEmprego: z.boolean().optional(),
  recebeAposentadoria: z.boolean().optional(),
  recebeSeguroDesemprego: z.boolean().optional(),
  valeTransporte: z.boolean().optional(),
  numeroCartaoContinente: optionalStringField,
  voucherNosData: optionalStringField,
  comprovativoMoradaFiscal: optionalStringField,
  comprovativoCartaoCidadao: optionalStringField,
  comprovativoIban: optionalStringField,
  comprovativoCartaoContinente: optionalStringField,
  cargo: optionalStringField,
  categoriaProfissional: optionalStringField,
  numeroMecanografico: optionalStringField,
  funcao: optionalStringField,
  nacionalidade: optionalStringField,
  dataInicioContrato: optionalStringField,
  dataFimContrato: optionalStringField,
  tipoContrato: optionalStringField,
  regimeHorario: optionalStringField,
  githubUser: optionalStringField,
  workCountry: z.enum(['PT', 'BR']).optional(),
  brWorkState: z.enum(['SP', 'RS']).or(z.literal('')).optional().transform((value) => value || undefined),
  photoUrl: optionalStringField,
  certificadoHabilitacoesUrl: optionalStringField,
  cartaConducaoUrl: optionalStringField,
  criminalRecordUrl: optionalStringField,
}).superRefine((data, ctx) => {
  const country = data.workCountry === 'BR' ? 'BR' : 'PT';

  const requireNonEmpty = (field: keyof typeof data, label: string) => {
    if (String(data[field] ?? '').trim()) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field as string],
      message: `${label} é obrigatório.`,
    });
  };

  if (country === 'PT') {
    requireNonEmpty('cartaoCidadao', 'Cartão de cidadão');
    requireNonEmpty('nif', 'NIF');
    requireNonEmpty('niss', 'NISS');
    requireNonEmpty('iban', 'IBAN');
    requireNonEmpty('situacaoIrs', 'Situação IRS');
    requireNonEmpty('numeroDependentes', 'Número de dependentes');
    requireNonEmpty('declaracaoIrs', 'Declaração IRS');
    requireNonEmpty('irsJovem', 'IRS Jovem');
    requireNonEmpty('anoPrimeiroDesconto', 'Ano do primeiro desconto');

    if (String(data.nif ?? '').trim() && !/^\d{9}$/.test(String(data.nif ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nif'], message: 'NIF deve ter 9 dígitos.' });
    }

    if (String(data.niss ?? '').trim() && !/^\d+$/.test(String(data.niss ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['niss'], message: 'NISS deve conter apenas dígitos.' });
    }

    if (String(data.iban ?? '').trim() && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(String(data.iban ?? '').trim().toUpperCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['iban'], message: 'IBAN inválido.' });
    }

    if (String(data.numeroDependentes ?? '').trim() && !/^\d+$/.test(String(data.numeroDependentes ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numeroDependentes'], message: 'Deve ser um número inteiro.' });
    }

    if (String(data.anoPrimeiroDesconto ?? '').trim() && !/^\d{4}$/.test(String(data.anoPrimeiroDesconto ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['anoPrimeiroDesconto'], message: 'Deve ser um ano com 4 dígitos.' });
    }
  }

  if (country === 'BR') {
    requireNonEmpty('cpf', 'CPF');
    requireNonEmpty('pis', 'PIS');
    requireNonEmpty('ctps', 'CTPS');
    requireNonEmpty('ctpsSerie', 'Série da CTPS');
    requireNonEmpty('ctpsDataExpedicao', 'Data de expedição da CTPS');
    requireNonEmpty('rg', 'RG');
    requireNonEmpty('rgOrgaoEmissor', 'Órgão emissor do RG');
    requireNonEmpty('rgDataExpedicao', 'Data de expedição do RG');
    requireNonEmpty('localNascimentoPais', 'País de nascimento');
    requireNonEmpty('localNascimentoCidade', 'Cidade de nascimento');
    requireNonEmpty('nomePai', 'Nome do pai');
    requireNonEmpty('nomeMae', 'Nome da mãe');
    requireNonEmpty('brWorkState', 'Estado de trabalho (BR)');

    if (data.primeiroEmprego == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primeiroEmprego'], message: 'Primeiro emprego é obrigatório.' });
    }

    if (data.recebeAposentadoria == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recebeAposentadoria'], message: 'Campo obrigatório.' });
    }

    if (data.recebeSeguroDesemprego == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recebeSeguroDesemprego'], message: 'Campo obrigatório.' });
    }

    if (data.valeTransporte == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valeTransporte'], message: 'Campo obrigatório.' });
    }

    if (String(data.cpf ?? '').trim() && !/^\d{11}$/.test(String(data.cpf ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cpf'], message: 'CPF deve ter 11 dígitos.' });
    }

    if (String(data.pis ?? '').trim() && !/^\d{11}$/.test(String(data.pis ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pis'], message: 'PIS deve ter 11 dígitos.' });
    }

    if (String(data.codigoPostal ?? '').trim() && !/^\d{5}-?\d{3}$/.test(String(data.codigoPostal ?? '').trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['codigoPostal'], message: 'CEP inválido. Use 00000-000.' });
    }
  }
});

const reviewRequestSchema = z.object({
  reason: z.string().optional(),
  reviewType: z.enum(['FULL_APPROVE', 'FULL_REJECT', 'PARTIAL_REJECT']).optional(),
  rejectedFields: z.record(z.string(), z.string()).optional(), // {"fieldName": "observações"}
});

const friendlyProfileFieldLabels: Partial<Record<(typeof profileFields)[number], string>> = {
  nomeCompleto: 'Nome completo',
  nomeAbreviado: 'Nome abreviado',
  dataNascimento: 'Data de nascimento',
  genero: 'Género',
  estadoCivil: 'Estado civil',
  habilitacoesLiterarias: 'Habilitações literárias',
  curso: 'Curso',
  faculdade: 'Faculdade',
  emailPessoal: 'Email pessoal',
  telemovel: 'Telemóvel',
  moradaFiscal: 'Morada fiscal',
  endereco: 'Endereço',
  localidade: 'Localidade',
  codigoPostal: 'Código postal',
  matriculaCarro: 'Matrícula',
  localNascimentoPais: 'País de nascimento',
  localNascimentoCidade: 'Cidade de nascimento',
  nomePai: 'Nome do pai',
  nomeMae: 'Nome da mãe',
  cartaoCidadao: 'Cartão de cidadão',
  nif: 'NIF',
  cpf: 'CPF',
  pis: 'PIS',
  ctps: 'CTPS',
  ctpsSerie: 'Série da CTPS',
  ctpsDataExpedicao: 'Data de expedição da CTPS',
  rg: 'RG',
  rgOrgaoEmissor: 'Órgão emissor do RG',
  rgDataExpedicao: 'Data de expedição do RG',
  cnh: 'CNH',
  cnhCategoria: 'Categoria da CNH',
  cnhDataValidade: 'Data de validade da CNH',
  tituloEleitor: 'Título de eleitor',
  zonaEleitoral: 'Zona eleitoral',
  secaoEleitoral: 'Seção eleitoral',
  certificadoReservista: 'Certificado de reservista',
  niss: 'NISS',
  iban: 'IBAN',
  situacaoIrs: 'Situação IRS',
  numeroDependentes: 'Número de dependentes',
  declaracaoIrs: 'Declaração IRS',
  irsJovem: 'IRS Jovem',
  anoPrimeiroDesconto: 'Ano do primeiro desconto',
  primeiroEmprego: 'Primeiro emprego',
  recebeAposentadoria: 'Recebe aposentadoria',
  recebeSeguroDesemprego: 'Recebe seguro de desemprego',
  valeTransporte: 'Vale transporte',
  numeroCartaoContinente: 'Número do cartão continente',
  voucherNosData: 'Voucher NOS',
  comprovativoMoradaFiscal: 'Comprovativo da morada fiscal',
  comprovativoCartaoCidadao: 'Comprovativo do cartão de cidadão',
  comprovativoIban: 'Comprovativo do IBAN',
  comprovativoCartaoContinente: 'Comprovativo do cartão continente',
  contactoEmergenciaNome: 'Contacto de emergência - nome',
  contactoEmergenciaParentesco: 'Contacto de emergência - parentesco',
  contactoEmergenciaNumero: 'Contacto de emergência - número',
  cargo: 'Cargo',
  categoriaProfissional: 'Categoria profissional',
  numeroMecanografico: 'Número mecanográfico',
  funcao: 'Função',
  nacionalidade: 'Nacionalidade',
  dataInicioContrato: 'Data de início do contrato',
  dataFimContrato: 'Data de fim do contrato',
  tipoContrato: 'Tipo de contrato',
  regimeHorario: 'Regime horário',
  validadeCartaoCidadao: 'Validade do cartão de cidadão',
  githubUser: 'GitHub',
  workCountry: 'País de trabalho',
  brWorkState: 'Estado de trabalho (BR)',
  photoUrl: 'Foto de utilizador',
  certificadoHabilitacoesUrl: 'Certificado de habilitações',
  cartaConducaoUrl: 'Carta de condução',
  criminalRecordUrl: 'Registo criminal',
};

async function resolveProfileRequestApproverIds(requesterUserId: string) {
  const requester = await prisma.user.findUnique({
    where: { id: requesterUserId },
    select: { id: true, hasAccessTotal: true },
  });

  if (!requester) {
    return [] as string[];
  }

  const candidates = await prisma.user.findMany({
    where: {
      id: { not: requesterUserId },
      isActive: true,
      OR: [
        { isRootAccess: true },
        { hasAccessTotal: true },
        { username: { equals: 't.people', mode: 'insensitive' } },
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
    select: {
      id: true,
      username: true,
      isRootAccess: true,
      hasAccessTotal: true,
    },
  });

  const approverIds: string[] = [];
  for (const candidate of candidates) {
    const candidateIsTPeople = candidate.username.toLowerCase() === 't.people';

    if (candidate.isRootAccess) {
      approverIds.push(candidate.id);
      continue;
    }

    if (requester.hasAccessTotal && !candidateIsTPeople) {
      if (!candidate.hasAccessTotal) {
        continue;
      }

      const canReview = await canReviewAccessTotalHierarchy(candidate.id, requesterUserId);
      if (!canReview) {
        continue;
      }
    }

    const canReviewByPermission = await canAccessUserByPermission(candidate.id, 'approve_profile_change', requesterUserId);
    if (canReviewByPermission) {
      approverIds.push(candidate.id);
    }
  }

  return Array.from(new Set(approverIds));
}

function formatChangedKeys(keys: string[]) {
  return keys.map((key) => friendlyProfileFieldLabels[key as (typeof profileFields)[number]] ?? key).join(', ');
}

function normalizeFieldValue(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '(vazio)';
  }

  if (text.length > 90) {
    return `${text.slice(0, 87)}...`;
  }

  return text;
}

type ProfileChangeDetail = {
  fieldKey: string;
  field: string;
  oldValue: string;
  newValue: string;
};

function buildProfileChangeDetails(
  current: Record<string, unknown> | null,
  next: Record<string, unknown>,
  changedKeys: string[],
): ProfileChangeDetail[] {
  const baseline = current ?? {};

  return changedKeys.map((key) => {
    const label = friendlyProfileFieldLabels[key as (typeof profileFields)[number]] ?? key;
    return {
      fieldKey: key,
      field: label,
      oldValue: normalizeFieldValue(baseline[key]),
      newValue: normalizeFieldValue(next[key]),
    };
  });
}

function resolveRequesterDisplayName(
  profile: { nomeAbreviado?: string | null; nomeCompleto?: string | null } | null | undefined,
) {
  const shortName = String(profile?.nomeAbreviado ?? '').trim();
  if (shortName) {
    return shortName;
  }

  const fullName = String(profile?.nomeCompleto ?? '').trim();
  if (fullName) {
    return fullName;
  }

  return 'Colaborador';
}

function buildProfileChangeMessage(
  requesterName: string,
  current: Record<string, unknown> | null,
  next: Record<string, unknown>,
  changedKeys: string[],
) {
  const header = `${requesterName} efetuou um pedido de alteração de ficha.`;
  const lines = buildProfileChangeDetails(current, next, changedKeys).map((item) => `- ${item.field}: ${item.oldValue} -> ${item.newValue}`);

  return [header, ...lines].join('\n');
}

function getChangedKeys(current: Record<string, unknown> | null, next: Record<string, unknown>) {
  const baseline = current ?? {};

  return Object.keys(next).filter((key) => String(baseline[key] ?? '') !== String(next[key] ?? ''));
}

const VOUCHER_NOS_COOLDOWN_YEARS = 2;
const TPEOPLE_USERNAME = 't.people';

function formatDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateOnly(value: string) {
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function addYears(date: Date, years: number) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function normalizeContractType(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

router.get("/profile/me", requireAuth, async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const profile = await getUserProfile(userId);
    return res.json(profile);
  } catch (error) {
    return res.status(404).json({ message: "Perfil não encontrado." });
  }
});

router.post('/profile/me/voucher-nos/request', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      profile: {
        select: {
          nomeAbreviado: true,
          nomeCompleto: true,
          tipoContrato: true,
          voucherNosData: true,
        },
      },
    },
  });

  if (!user || !user.profile) {
    return res.status(404).json({ message: 'Perfil não encontrado.' });
  }

  if (normalizeContractType(user.profile.tipoContrato) !== 'sem termo') {
    return res.status(403).json({ message: 'O voucher NOS só pode ser pedido por colaboradores com contrato sem termo.' });
  }

  const today = toDateOnly(new Date());
  const lastRequestDate = parseDateOnly(user.profile.voucherNosData);

  if (lastRequestDate) {
    const nextEligibleDate = addYears(lastRequestDate, VOUCHER_NOS_COOLDOWN_YEARS);
    if (today < nextEligibleDate) {
      return res.status(409).json({
        message: `Já existe um pedido de voucher NOS. Novo pedido apenas após ${formatDateOnly(nextEligibleDate)}.`,
        lastRequestDate: formatDateOnly(lastRequestDate),
        nextEligibleDate: formatDateOnly(nextEligibleDate),
      });
    }
  }

  const recipients = await prisma.user.findMany({
    where: {
      username: {
        equals: TPEOPLE_USERNAME,
        mode: 'insensitive',
      },
      isActive: true,
    },
    select: { id: true },
  });

  if (recipients.length === 0) {
    return res.status(503).json({ message: 'Conta t.people não encontrada ou inativa. Contacte o administrador.' });
  }

  const requestDate = formatDateOnly(today);
  const nextEligibleDate = formatDateOnly(addYears(today, VOUCHER_NOS_COOLDOWN_YEARS));
  const requesterName = resolveRequesterDisplayName(user.profile) || user.username;

  await prisma.profile.upsert({
    where: { userId },
    update: { voucherNosData: requestDate },
    create: {
      userId,
      voucherNosData: requestDate,
    },
  });

  await prisma.notification.createMany({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      title: 'Pedido de emissão de voucher NOS',
      message: `${requesterName} solicitou emissão do voucher NOS em ${requestDate}. Próxima elegibilidade: ${nextEligibleDate}.`,
    })),
  });

  await prisma.notification.create({
    data: {
      userId,
      title: 'Pedido de voucher NOS submetido',
      message: `Pedido enviado para t.people em ${requestDate}. Próxima elegibilidade em ${nextEligibleDate}.`,
    },
  });

  return res.status(201).json({
    message: 'Pedido de emissão enviado para t.people.',
    lastRequestDate: requestDate,
    nextEligibleDate,
  });
});

router.get('/profile/requests/me', requireAuth, async (req, res) => {
  const timer = createRequestTimer('GET /profile/requests/me');
  const userId = req.authUser!.id;

  const request = await prisma.profileChangeRequest.findFirst({
    where: { userId, status: 'PENDING' },
    select: {
      id: true,
      changesSummary: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      requestedData: true,
    },
  });
  timer.mark('find-pending-request');

  if (!request) {
    timer.done({ pending: false });
    return res.json({ pending: false, request: null });
  }

  const currentProfile = await prisma.profile.findUnique({ where: { userId } });
  timer.mark('load-current-profile');
  const requestedData = (request.requestedData as Record<string, unknown>) ?? {};
  const changedKeys = getChangedKeys(currentProfile as Record<string, unknown> | null, requestedData);
  const changeDetails = buildProfileChangeDetails(currentProfile as Record<string, unknown> | null, requestedData, changedKeys);
  timer.mark('build-change-details');
  timer.done({ pending: true, changedKeys: changedKeys.length });

  return res.json({
    pending: true,
    request: {
      id: request.id,
      changesSummary: request.changesSummary,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      changeDetails,
    },
  });
});

router.put("/profile/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.authUser!.id;
    const normalizedPayload = normalizeProfilePayload(req.body);
    const data = updateProfileSchema.parse(normalizedPayload) as Record<string, unknown>;
    const canEditOwnProfile = await hasPermission(userId, 'edit_profile');
    const canRequestProfileChange = await hasPermission(userId, 'request_profile_change');
    const canEditOtherProfiles = await hasPermission(userId, 'edit_other_profile');
    const canEditGlobalProfileFields = req.authUser?.isRootAccess || await isAccessTotal(userId);
    const mustRequestProfileChange = !req.authUser?.isRootAccess && canEditGlobalProfileFields;

    if (!canEditGlobalProfileFields) {
      delete data.workCountry;
      delete data.brWorkState;
    } else if ((data.workCountry as string | undefined) !== 'BR') {
      data.brWorkState = null;
    }

    if (mustRequestProfileChange || (req.authUser!.role === 'COLABORADOR' && canRequestProfileChange)) {
      const currentProfile = await prisma.profile.findUnique({
        where: { userId },
      });

      const changedKeys = getChangedKeys(currentProfile as Record<string, unknown> | null, data as Record<string, unknown>);

      if (changedKeys.length === 0) {
        return res.status(400).json({ message: 'Não existem alterações para submeter.' });
      }

      const requesterName = resolveRequesterDisplayName(currentProfile);
      const summary = `Pedido de alteração de ficha: ${formatChangedKeys(changedKeys)}`;
      const notificationMessage = buildProfileChangeMessage(
        requesterName,
        currentProfile as Record<string, unknown> | null,
        data as Record<string, unknown>,
        changedKeys,
      );

      try {
        await prisma.profileChangeRequest.create({
          data: {
            userId,
            requestedData: data as unknown as object,
            changesSummary: summary,
          },
        });
      } catch (error) {
        if (!isPendingProfileRequestConflict(error)) {
          throw error;
        }

        const existingRequest = await prisma.profileChangeRequest.findFirst({
          where: { userId, status: 'PENDING' },
          select: { id: true },
        });

        if (!existingRequest) {
          throw error;
        }

        await prisma.profileChangeRequest.update({
          where: { id: existingRequest.id },
          data: {
            requestedData: data as unknown as object,
            changesSummary: summary,
            reviewedBy: { disconnect: true },
            reviewedAt: null,
            reviewReason: '',
          },
        });
      }

      const approverIds = await resolveProfileRequestApproverIds(userId);
      if (approverIds.length > 0) {
        await notifyUsers(prisma, approverIds, 'Pedido de alteração de ficha', notificationMessage);
      }

      await prisma.notification.create({
        data: {
          userId,
          title: 'Pedido de alteração submetido',
          message: 'Pedido de alteração enviado para validação.',
        },
      });

      if (shouldAutoResolveCitizenCardExpiryNotification(data as Record<string, unknown>)) {
        await markCitizenCardExpiryNotificationsAsRead(prisma, userId);
      }

      return res.json({ pending: true, message: 'Pedido enviado para aprovação.' });
    }

    if (!canEditOwnProfile && !canEditOtherProfiles) {
      return res.status(403).json({ message: 'Sem permissões para editar ficha.' });
    }

    const profile = await prisma.profile.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        ...data
      }
    });

    if (shouldAutoResolveCitizenCardExpiryNotification(data as Record<string, unknown>)) {
      await markCitizenCardExpiryNotificationsAsRead(prisma, userId);
    }

    return res.json(profile);
  } catch (error) {
    return next(error);
  }
});

router.get('/profile/requests', requireAuth, async (req, res) => {
  const timer = createRequestTimer('GET /profile/requests');
  const actorIsTPeople = (req.authUser?.username ?? '').toLowerCase() === 't.people';
  if (!actorIsTPeople && !await hasPermission(req.authUser!.id, 'approve_profile_change')) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }
  timer.mark('check-permission');

  const scope = actorIsTPeople
    ? null
    : await getPermissionScope(req.authUser!.id, 'approve_profile_change');
  if (!scope) {
    if (!actorIsTPeople) {
      return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
    }
  }
  timer.mark('resolve-scope');

  const userScopeWhere = scope ? buildUserWhereFromScope(scope) : null;
  const actorHasAccessTotal = Boolean(req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id));

  const requests = await prisma.profileChangeRequest.findMany({
    where: {
      status: 'PENDING',
      ...(userScopeWhere ? { user: userScopeWhere } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          hasAccessTotal: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  timer.mark('load-requests');

  const currentProfiles = await prisma.profile.findMany({
    where: {
      userId: {
        in: requests.map((request) => request.userId),
      },
    },
  });
  timer.mark('load-current-profiles');
  const profileByUserId = new Map(currentProfiles.map((item) => [item.userId, item]));

  const enriched = requests.map((request) => {
    const currentProfile = profileByUserId.get(request.userId) ?? null;

    const requestedData = (request.requestedData as Record<string, unknown>) ?? {};
    const changedKeys = getChangedKeys(currentProfile as Record<string, unknown> | null, requestedData);

    return {
      ...request,
      requesterName: resolveRequesterDisplayName(request.user.profile),
      changeDetails: buildProfileChangeDetails(currentProfile as Record<string, unknown> | null, requestedData, changedKeys),
    };
  });

  const filteredEnriched = [] as typeof enriched;
  for (const request of enriched) {
    if (request.user.hasAccessTotal && !req.authUser!.isRootAccess && !actorIsTPeople) {
      if (!actorHasAccessTotal) {
        continue;
      }

      const canReview = await canReviewAccessTotalHierarchy(req.authUser!.id, request.userId);
      if (!canReview) {
        continue;
      }
    }

    filteredEnriched.push(request);
  }
  timer.mark('enrich-response');
  timer.done({ count: filteredEnriched.length });

  return res.json(filteredEnriched);
});

router.get('/profile/requests/history', requireAuth, async (req, res) => {
  const canReview = await hasPermission(req.authUser!.id, 'approve_profile_change');
  const canViewUsers = await hasPermission(req.authUser!.id, 'view_user_list');

  if (!req.authUser!.isRootAccess && !canReview && !canViewUsers) {
    return res.status(403).json({ message: 'Sem permissões para consultar histórico de alterações de ficha.' });
  }

  const reviewScope = canReview ? await getPermissionScope(req.authUser!.id, 'approve_profile_change') : null;
  const usersScope = canViewUsers ? await getPermissionScope(req.authUser!.id, 'view_user_list') : null;
  const scope = reviewScope || usersScope;

  if (!req.authUser!.isRootAccess && !scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar histórico de alterações de ficha.' });
  }

  const userScopeWhere = req.authUser!.isRootAccess
    ? null
    : buildUserWhereFromScope(scope!);

  const rawLimit = typeof req.query.limit === 'string' ? req.query.limit.trim() : '200';
  if (!/^\d+$/.test(rawLimit)) {
    return res.status(400).json({ message: 'Parâmetro limit inválido.' });
  }

  const limit = Math.min(500, Math.max(10, Number(rawLimit)));
  const canViewSensitiveFields = canViewSensitiveProfileChangeFields(req.authUser!.isRootAccess, Boolean(req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id)));

  const requests = await prisma.profileChangeRequest.findMany({
    where: {
      status: { in: ['APPROVED', 'PARTIALLY_REJECTED', 'REJECTED'] },
      reviewedAt: { not: null },
      ...(userScopeWhere ? { user: userScopeWhere } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
        },
      },
      reviewedBy: {
        select: {
          id: true,
          username: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
        },
      },
    },
    orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return res.json(requests.map((item) => {
    const requestedData = (item.requestedData as Record<string, unknown>) ?? {};
    const approvedFields = (item.approvedFields as Record<string, unknown>) ?? {};
    const rejectedFields = (item.rejectedFields as Record<string, unknown>) ?? {};
    const redactedRequestedData = redactProfileChangeRecord(requestedData, canViewSensitiveFields);
    const redactedApprovedFields = redactProfileChangeRecord(approvedFields, canViewSensitiveFields);
    const redactedRejectedFields = redactProfileChangeRecord(rejectedFields, canViewSensitiveFields);
    const changedFieldNames = Object.keys(redactedRequestedData);
    const approvedFieldNames = Object.keys(redactedApprovedFields);
    const rejectedFieldNames = Object.keys(redactedRejectedFields);

    return {
      ...item,
      changedFields: changedFieldNames,
      approvedFieldNames,
      rejectedFieldNames,
      requestedData: redactedRequestedData,
      approvedFields: redactedApprovedFields,
      rejectedFields: redactedRejectedFields,
      requesterName: resolveRequesterDisplayName(item.user.profile),
    };
  }));
});

router.post('/profile/requests/:id/approve', requireAuth, async (req, res) => {
  const actorIsTPeople = (req.authUser?.username ?? '').toLowerCase() === 't.people';
  if (!actorIsTPeople && !await hasPermission(req.authUser!.id, 'approve_profile_change')) {
    return res.status(403).json({ message: 'Sem permissões para aprovar pedidos.' });
  }

  const validation = reviewRequestSchema.safeParse(req.body);
  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: String(req.params.id), status: 'PENDING' },
  });

  if (!request) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { hasAccessTotal: true },
  });

  const actorHasAccessTotal = Boolean(req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id));

  let canReviewTarget = false;
  if (targetUser?.hasAccessTotal) {
    if (req.authUser!.isRootAccess || actorIsTPeople) {
      canReviewTarget = true;
    } else if (actorHasAccessTotal) {
      canReviewTarget = await canReviewAccessTotalHierarchy(req.authUser!.id, request.userId);
    }
  } else {
    canReviewTarget = await canAccessUserByPermission(req.authUser!.id, 'approve_profile_change', request.userId);
  }

  if (!canReviewTarget && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para aprovar este pedido com as restrições atuais.' });
  }

  const reviewType = validation.success ? validation.data.reviewType || 'FULL_APPROVE' : 'FULL_APPROVE';
  const reason = validation.success ? validation.data.reason?.trim() || 'Pedido aprovado.' : 'Pedido aprovado.';
  const rejectedFields = validation.success ? validation.data.rejectedFields || {} : {};

  // CASE 1: Aprovação completa
  if (reviewType === 'FULL_APPROVE') {
    const requestedData = request.requestedData as Record<string, unknown>;

    // Aplicar alterações ao perfil e marcar pedido como aprovado atomicamente
    await prisma.$transaction(async (tx) => {
      await tx.profile.upsert({
        where: { userId: request.userId },
        update: requestedData,
        create: {
          userId: request.userId,
          ...requestedData,
        },
      });

      await tx.profileChangeRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          approvedFields: requestedData as Prisma.InputJsonValue,
          rejectedFields: {},
          reviewedBy: { connect: { id: req.authUser!.id } },
          reviewedAt: new Date(),
          reviewReason: 'Pedido aprovado.',
        },
      });
    });

    await prisma.notification.create({
      data: {
        userId: request.userId,
        title: 'Pedido de alteração aprovado',
        message: [
          'Resultado: pedido de alteração de ficha aprovado.',
          'A ficha foi atualizada com sucesso.',
          `Decisor: ${req.authUser?.username || 'Aprovador'}.`,
          'Ação: consulta a tua ficha para validar os novos dados.',
        ].join('\n'),
      },
    });
  }
  // CASE 2: Rejeição parcial (alguns campos rejeitados)
  else if (reviewType === 'PARTIAL_REJECT') {
    const requestedData = request.requestedData as Record<string, unknown>;
    const approvedFields: Record<string, unknown> = {};

    // Separar campos aprovados dos rejeitados
    Object.entries(requestedData).forEach(([field, value]) => {
      if (!(field in rejectedFields)) {
        approvedFields[field] = value;
      }
    });

    // Calcular quais campos realmente mudaram face ao perfil atual
    const currentProfile = await prisma.profile.findUnique({ where: { userId: request.userId } }) as Record<string, unknown> | null;
    const changedApprovedFields = Object.keys(approvedFields).filter((f) => {
      const current = currentProfile?.[f];
      const requested = requestedData[f];
      if (current === undefined && (requested === null || requested === '' || requested === undefined)) return false;
      return String(current ?? '') !== String(requested ?? '');
    });

    // Montar mensagem detalhada de rejeição
    const approvedFieldsList = changedApprovedFields
      .map((f) => `✓ ${friendlyProfileFieldLabels[f as keyof typeof friendlyProfileFieldLabels] || f}`)
      .join('\n');

    const rejectedFieldsDetail = Object.entries(rejectedFields)
      .map(([f, obs]) => `✗ ${friendlyProfileFieldLabels[f as keyof typeof friendlyProfileFieldLabels] || f}: ${obs}`)
      .join('\n');

    // Aplicar campos aprovados e atualizar estado do pedido atomicamente
    await prisma.$transaction(async (tx) => {
      if (Object.keys(approvedFields).length > 0) {
        await tx.profile.upsert({
          where: { userId: request.userId },
          update: approvedFields,
          create: {
            userId: request.userId,
            ...approvedFields,
          },
        });
      }

      await tx.profileChangeRequest.update({
        where: { id: request.id },
        data: {
          status: 'PARTIALLY_REJECTED',
          approvedFields: approvedFields as Prisma.InputJsonValue,
          rejectedFields: rejectedFields as Prisma.InputJsonValue,
          reviewedBy: { connect: { id: req.authUser!.id } },
          reviewedAt: new Date(),
          reviewReason: `Parcialmente rejeitado: ${Object.keys(rejectedFields).join(', ')}`,
        },
      });
    });

    await prisma.notification.create({
      data: {
        userId: request.userId,
        title: 'Pedido de alteração parcialmente rejeitado',
        message: [
          'Resultado: pedido de alteração de ficha parcialmente rejeitado.',
          ...(approvedFieldsList ? [`Campos aprovados (já aplicados):\n${approvedFieldsList}`] : []),
          ...(rejectedFieldsDetail ? [`Campos recusados (não aplicados):\n${rejectedFieldsDetail}`] : []),
          `Decisor: ${req.authUser?.username || 'Aprovador'}.`,
          'Ação: revê as observações, corrige os campos recusados e submete nova versão.',
        ].join('\n'),
      },
    });
  }
  // CASE 3: (O endpoint de reject anterior permanece com full rejection)

  return res.json({ success: true });
});

router.post('/profile/requests/:id/reject', requireAuth, async (req, res) => {
  const actorIsTPeople = (req.authUser?.username ?? '').toLowerCase() === 't.people';
  if (!actorIsTPeople && !await hasPermission(req.authUser!.id, 'approve_profile_change')) {
    return res.status(403).json({ message: 'Sem permissões para recusar pedidos.' });
  }

  const validation = reviewRequestSchema.safeParse(req.body);
  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: String(req.params.id), status: 'PENDING' },
  });

  if (!request) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { hasAccessTotal: true },
  });

  const actorHasAccessTotal = Boolean(req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id));

  let canReviewTarget = false;
  if (targetUser?.hasAccessTotal) {
    if (req.authUser!.isRootAccess || actorIsTPeople) {
      canReviewTarget = true;
    } else if (actorHasAccessTotal) {
      canReviewTarget = await canReviewAccessTotalHierarchy(req.authUser!.id, request.userId);
    }
  } else {
    canReviewTarget = await canAccessUserByPermission(req.authUser!.id, 'approve_profile_change', request.userId);
  }

  if (!canReviewTarget && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para recusar este pedido com as restrições atuais.' });
  }

  const reason = validation.success ? validation.data.reason?.trim() || 'Pedido recusado.' : 'Pedido recusado.';

  await prisma.$transaction(async (tx) => {
    await tx.profileChangeRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewedBy: { connect: { id: req.authUser!.id } },
        reviewedAt: new Date(),
        reviewReason: reason,
      },
    });

    await tx.notification.create({
      data: {
        userId: request.userId,
        title: 'Pedido de alteração de ficha recusado',
        message: [
          'Resultado: pedido de alteração de ficha recusado.',
          `Motivo: ${reason}`,
          `Decisor: ${req.authUser?.username || 'Aprovador'}.`,
          'Ação: ajusta os dados e volta a submeter quando necessário.',
        ].join('\n'),
      },
    });
  });

  return res.json({ success: true });
});

export { router as profileRouter };
