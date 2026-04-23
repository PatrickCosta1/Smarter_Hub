import { Router } from "express";
import { z } from "zod";
import { Prisma, ProfileOptionType } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  canReviewAccessTotalHierarchy,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from "../lib/permission-engine.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyUsersByPermission } from "../lib/notifications.js";
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

function normalizeDropdownOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeDropdownOptionKey(value: string) {
  return normalizeDropdownOptionLabel(value).toLowerCase();
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
  "cartaoCidadao",
  "nif",
  "niss",
  "iban",
  "situacaoIrs",
  "numeroDependentes",
  "irsJovem",
  "anoPrimeiroDesconto",
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
  "funcao",
  "nacionalidade",
  "dataInicioContrato",
  "dataFimContrato",
  "tipoContrato",
  "regimeHorario",
  "validadeCartaoCidadao",
  "githubUser",
  "workCountry",
] as const;

function normalizeProfilePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload invalido.");
  }

  const source = payload as Record<string, unknown>;
  const normalized: Partial<Record<(typeof profileFields)[number], string>> = {};

  profileFields.forEach((field) => {
    if (!(field in source)) {
      return;
    }

    const rawValue = source[field];
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
  cartaoCidadao: requiredStringField('Cartão de cidadão'),
  nif: z.string().min(1, 'NIF é obrigatório.').regex(/^\d{9}$/, 'NIF deve ter 9 dígitos.'),
  niss: z.string().min(1, 'NISS é obrigatório.').regex(/^\d+$/, 'NISS deve conter apenas dígitos.'),
  iban: z.string().min(1, 'IBAN é obrigatório.').regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'IBAN inválido.'),
  situacaoIrs: requiredStringField('Situação IRS'),
  numeroDependentes: z.string().min(1, 'Número de dependentes é obrigatório.').regex(/^\d+$/, 'Deve ser um número inteiro.'),
  irsJovem: requiredStringField('IRS Jovem'),
  anoPrimeiroDesconto: z.string().min(1, 'Ano do primeiro desconto é obrigatório.').regex(/^\d{4}$/, 'Deve ser um ano com 4 dígitos.'),
  contactoEmergenciaNome: requiredStringField('Contacto de emergência - nome'),
  contactoEmergenciaParentesco: requiredStringField('Contacto de emergência - parentesco'),
  contactoEmergenciaNumero: requiredStringField('Contacto de emergência - número'),

  // OPTIONAL FIELDS
  curso: optionalStringField,
  faculdade: optionalStringField,
  matriculaCarro: optionalStringField,
  numeroCartaoContinente: optionalStringField,
  voucherNosData: optionalStringField,
  comprovativoMoradaFiscal: optionalStringField,
  comprovativoCartaoCidadao: optionalStringField,
  comprovativoIban: optionalStringField,
  comprovativoCartaoContinente: optionalStringField,
  cargo: optionalStringField,
  categoriaProfissional: optionalStringField,
  funcao: optionalStringField,
  nacionalidade: optionalStringField,
  dataInicioContrato: optionalStringField,
  dataFimContrato: optionalStringField,
  tipoContrato: optionalStringField,
  regimeHorario: optionalStringField,
  validadeCartaoCidadao: optionalStringField,
  githubUser: optionalStringField,
  workCountry: z.enum(['PT', 'BR']).optional(),
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
  cartaoCidadao: 'Cartão de cidadão',
  nif: 'NIF',
  niss: 'NISS',
  iban: 'IBAN',
  situacaoIrs: 'Situação IRS',
  numeroDependentes: 'Número de dependentes',
  irsJovem: 'IRS Jovem',
  anoPrimeiroDesconto: 'Ano do primeiro desconto',
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
  funcao: 'Função',
  nacionalidade: 'Nacionalidade',
  dataInicioContrato: 'Data de início do contrato',
  dataFimContrato: 'Data de fim do contrato',
  tipoContrato: 'Tipo de contrato',
  regimeHorario: 'Regime horário',
  validadeCartaoCidadao: 'Validade do cartão de cidadão',
  githubUser: 'GitHub',
  workCountry: 'País de trabalho',
};

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

router.get("/profile/me", requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const profile = await prisma.profile.findUnique({
    where: { userId }
  });

  if (!profile) {
    return res.status(404).json({ message: "Perfil nao encontrado." });
  }

  return res.json(profile);
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

      await notifyUsersByPermission(prisma, ['approve_profile_change'], 'Pedido de alteração de ficha', notificationMessage);

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
  if (!await hasPermission(req.authUser!.id, 'approve_profile_change')) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }
  timer.mark('check-permission');

  const scope = await getPermissionScope(req.authUser!.id, 'approve_profile_change');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }
  timer.mark('resolve-scope');

  const userScopeWhere = buildUserWhereFromScope(scope);

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
  timer.mark('enrich-response');
  timer.done({ count: enriched.length });

  return res.json(enriched);
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

  const limit = Math.min(500, Math.max(10, Number(typeof req.query.limit === 'string' ? req.query.limit : '200') || 200));

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

    return {
      ...item,
      changedFields: Object.keys(requestedData),
      approvedFieldNames: Object.keys(approvedFields),
      rejectedFieldNames: Object.keys(rejectedFields),
      requestedData,
      approvedFields,
      rejectedFields,
      requesterName: resolveRequesterDisplayName(item.user.profile),
    };
  }));
});

router.post('/profile/requests/:id/approve', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'approve_profile_change')) {
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

  const canReviewTarget = targetUser?.hasAccessTotal
    ? await canReviewAccessTotalHierarchy(req.authUser!.id, request.userId)
    : await canAccessUserByPermission(req.authUser!.id, 'approve_profile_change', request.userId);
  if (!canReviewTarget && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para aprovar este pedido com as restrições atuais.' });
  }

  const reviewType = validation.success ? validation.data.reviewType || 'FULL_APPROVE' : 'FULL_APPROVE';
  const reason = validation.success ? validation.data.reason?.trim() || 'Pedido aprovado.' : 'Pedido aprovado.';
  const rejectedFields = validation.success ? validation.data.rejectedFields || {} : {};

  // CASE 1: Aprovação completa
  if (reviewType === 'FULL_APPROVE') {
    const requestedData = request.requestedData as Record<string, unknown>;

    await prisma.profile.upsert({
      where: { userId: request.userId },
      update: requestedData,
      create: {
        userId: request.userId,
        ...requestedData,
      },
    });

    await prisma.profileChangeRequest.update({
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

    await prisma.notification.create({
      data: {
        userId: request.userId,
        title: 'Pedido de alteração aprovado',
        message: 'A ficha foi atualizada com sucesso.',
      },
    });
  }
  // CASE 2: Rejeição parcial (alguns campos rejeitados)
  else if (reviewType === 'PARTIAL_REJECT') {
    const requestedData = request.requestedData as Record<string, unknown>;
    const approvedFields: Record<string, unknown> = {};

    // Separar campos aprovados dos rejeitados
    Object.entries(requestedData).forEach(([field, value]) => {
      if (!rejectedFields[field]) {
        approvedFields[field] = value;
      }
    });

    // Aplicar apenas os campos aprovados
    if (Object.keys(approvedFields).length > 0) {
      await prisma.profile.upsert({
        where: { userId: request.userId },
        update: approvedFields,
        create: {
          userId: request.userId,
          ...approvedFields,
        },
      });
    }

    // Montar mensagem detalhada de rejeição
    const rejectedFieldsList = Object.entries(rejectedFields)
      .map(([field, observation]) => `- ${friendlyProfileFieldLabels[field as keyof typeof friendlyProfileFieldLabels] || field}: ${observation}`)
      .join('\n');

    const notificationMessage = `O teu pedido de alteração foi parcialmente rejeitado. Os seguintes campos foram rejeitados:\n${rejectedFieldsList}`;

    await prisma.profileChangeRequest.update({
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

    await prisma.notification.create({
      data: {
        userId: request.userId,
        title: 'Pedido de alteração parcialmente rejeitado',
        message: notificationMessage,
      },
    });
  }
  // CASE 3: (O endpoint de reject anterior permanece com full rejection)

  return res.json({ success: true });
});

router.post('/profile/requests/:id/reject', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'approve_profile_change')) {
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

  const canReviewTarget = targetUser?.hasAccessTotal
    ? await canReviewAccessTotalHierarchy(req.authUser!.id, request.userId)
    : await canAccessUserByPermission(req.authUser!.id, 'approve_profile_change', request.userId);
  if (!canReviewTarget && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para recusar este pedido com as restrições atuais.' });
  }

  const reason = validation.success ? validation.data.reason?.trim() || 'Pedido recusado.' : 'Pedido recusado.';

  await prisma.profileChangeRequest.update({
    where: { id: request.id },
    data: {
      status: 'REJECTED',
      reviewedBy: { connect: { id: req.authUser!.id } },
      reviewedAt: new Date(),
      reviewReason: reason,
    },
  });

  await prisma.notification.create({
    data: {
      userId: request.userId,
      title: 'Pedido de alteração de ficha recusado',
      message: `O teu pedido de alteração de ficha foi recusado. ${reason}`,
    },
  });

  return res.json({ success: true });
});

export { router as profileRouter };
