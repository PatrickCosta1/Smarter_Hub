import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from "../lib/permission-engine.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyUsersByPermission } from "../lib/notifications.js";

const router = Router();

const profileFields = [
  "primeiroNome",
  "apelido",
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
  "funcao",
  "dataInicioContrato",
  "dataFimContrato",
  "remuneracao",
  "tipoContrato",
  "regimeHorario",
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

const updateProfileSchema = z.object({
  primeiroNome: optionalStringField,
  apelido: optionalStringField,
  nomeAbreviado: optionalStringField,
  dataNascimento: optionalStringField,
  genero: optionalStringField,
  estadoCivil: optionalStringField,
  habilitacoesLiterarias: optionalStringField,
  curso: optionalStringField,
  faculdade: optionalStringField,
  emailPessoal: optionalStringField,
  telemovel: optionalStringField,
  moradaFiscal: optionalStringField,
  endereco: optionalStringField,
  localidade: optionalStringField,
  codigoPostal: optionalStringField,
  matriculaCarro: optionalStringField,
  cartaoCidadao: optionalStringField,
  nif: optionalStringField,
  niss: optionalStringField,
  iban: optionalStringField,
  situacaoIrs: optionalStringField,
  numeroDependentes: optionalStringField,
  irsJovem: optionalStringField,
  anoPrimeiroDesconto: optionalStringField,
  numeroCartaoContinente: optionalStringField,
  voucherNosData: optionalStringField,
  comprovativoMoradaFiscal: optionalStringField,
  comprovativoCartaoCidadao: optionalStringField,
  comprovativoIban: optionalStringField,
  comprovativoCartaoContinente: optionalStringField,
  contactoEmergenciaNome: optionalStringField,
  contactoEmergenciaParentesco: optionalStringField,
  contactoEmergenciaNumero: optionalStringField,
  cargo: optionalStringField,
  funcao: optionalStringField,
  dataInicioContrato: optionalStringField,
  dataFimContrato: optionalStringField,
  remuneracao: optionalStringField,
  tipoContrato: optionalStringField,
  regimeHorario: optionalStringField,
  workCountry: z.enum(['PT', 'BR']).optional(),
});

const reviewRequestSchema = z.object({
  reason: z.string().optional(),
});

const friendlyProfileFieldLabels: Partial<Record<(typeof profileFields)[number], string>> = {
  primeiroNome: 'Primeiro nome',
  apelido: 'Apelido',
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
  funcao: 'Função',
  dataInicioContrato: 'Data de início do contrato',
  dataFimContrato: 'Data de fim do contrato',
  remuneracao: 'Remuneração',
  tipoContrato: 'Tipo de contrato',
  regimeHorario: 'Regime horário',
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
      field: label,
      oldValue: normalizeFieldValue(baseline[key]),
      newValue: normalizeFieldValue(next[key]),
    };
  });
}

function resolveRequesterDisplayName(
  profile: { nomeAbreviado?: string | null; primeiroNome?: string | null; apelido?: string | null } | null | undefined,
) {
  const shortName = String(profile?.nomeAbreviado ?? '').trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${String(profile?.primeiroNome ?? '').trim()} ${String(profile?.apelido ?? '').trim()}`.trim();
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
  const userId = req.authUser!.id;

  const request = await prisma.profileChangeRequest.findFirst({
    where: { userId, status: 'PENDING' },
    select: {
      id: true,
      changesSummary: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res.json({
    pending: Boolean(request),
    request,
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

    if (!canEditGlobalProfileFields) {
      delete data.workCountry;
    }

    if (req.authUser!.role === 'COLABORADOR' && canRequestProfileChange) {
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

      const existingRequest = await prisma.profileChangeRequest.findFirst({
        where: { userId, status: 'PENDING' },
      });

      if (existingRequest) {
        await prisma.profileChangeRequest.update({
          where: { id: existingRequest.id },
          data: {
            requestedData: data as unknown as object,
            changesSummary: summary,
            reviewedById: null,
            reviewedAt: null,
            reviewReason: '',
          },
        });
      } else {
        await prisma.profileChangeRequest.create({
          data: {
            userId,
            requestedData: data as unknown as object,
            changesSummary: summary,
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

    return res.json(profile);
  } catch (error) {
    return next(error);
  }
});

router.get('/profile/requests', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'approve_profile_change')) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'approve_profile_change');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }

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
              primeiroNome: true,
              apelido: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const enriched = await Promise.all(requests.map(async (request) => {
    const currentProfile = await prisma.profile.findUnique({
      where: { userId: request.userId },
    });

    const requestedData = (request.requestedData as Record<string, unknown>) ?? {};
    const changedKeys = getChangedKeys(currentProfile as Record<string, unknown> | null, requestedData);

    return {
      ...request,
      requesterName: resolveRequesterDisplayName(request.user.profile),
      changeDetails: buildProfileChangeDetails(currentProfile as Record<string, unknown> | null, requestedData, changedKeys),
    };
  }));

  return res.json(enriched);
});

router.post('/profile/requests/:id/approve', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'approve_profile_change')) {
    return res.status(403).json({ message: 'Sem permissões para aprovar pedidos.' });
  }

  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: String(req.params.id), status: 'PENDING' },
  });

  if (!request) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  const canReviewTarget = await canAccessUserByPermission(req.authUser!.id, 'approve_profile_change', request.userId);
  if (!canReviewTarget && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para aprovar este pedido com as restrições atuais.' });
  }

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
      reviewedById: req.authUser!.id,
      reviewedAt: new Date(),
      reviewReason: 'Pedido aprovado.',
    },
  });

  await prisma.notification.create({
    data: {
      userId: request.userId,
      title: 'Pedido de alteração aprovado',
      message: 'A ficha foi atualizada.',
    },
  });

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

  const canReviewTarget = await canAccessUserByPermission(req.authUser!.id, 'approve_profile_change', request.userId);
  if (!canReviewTarget && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para recusar este pedido com as restrições atuais.' });
  }

  const reason = validation.success ? validation.data.reason?.trim() || 'Pedido recusado.' : 'Pedido recusado.';

  await prisma.profileChangeRequest.update({
    where: { id: request.id },
    data: {
      status: 'REJECTED',
      reviewedById: req.authUser!.id,
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
