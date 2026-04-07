import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyUsersByRole } from "../lib/notifications.js";

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

router.put("/profile/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.authUser!.id;
    const normalizedPayload = normalizeProfilePayload(req.body);
    const data = updateProfileSchema.parse(normalizedPayload) as Record<string, unknown>;

    if (!['COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
      delete data.workCountry;
    }

    if (req.authUser?.role === 'COLABORADOR') {
      const currentProfile = await prisma.profile.findUnique({
        where: { userId },
      });

      const changedKeys = getChangedKeys(currentProfile as Record<string, unknown> | null, data as Record<string, unknown>);

      if (changedKeys.length === 0) {
        return res.status(400).json({ message: 'Não existem alterações para submeter.' });
      }

      const summary = `Pedido de alteração de ficha: ${changedKeys.join(', ')}`;

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

      await notifyUsersByRole(prisma, ['MANAGER', 'COORDENADOR', 'ADMIN'], 'Pedido de alteração de ficha', `${req.authUser.username} submeteu um pedido: ${summary}`);

      return res.json({ pending: true, message: 'Pedido enviado para aprovação.' });
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
  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }

  const requests = await prisma.profileChangeRequest.findMany({
    where: { status: 'PENDING' },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          profile: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(requests);
});

router.post('/profile/requests/:id/approve', requireAuth, async (req, res) => {
  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ message: 'Sem permissões para aprovar pedidos.' });
  }

  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: String(req.params.id), status: 'PENDING' },
  });

  if (!request) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
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
      message: 'O teu pedido de alteração de ficha foi aprovado.',
    },
  });

  return res.json({ success: true });
});

router.post('/profile/requests/:id/reject', requireAuth, async (req, res) => {
  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ message: 'Sem permissões para recusar pedidos.' });
  }

  const validation = reviewRequestSchema.safeParse(req.body);
  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: String(req.params.id), status: 'PENDING' },
  });

  if (!request) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
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
      title: 'Pedido de alteração recusado',
      message: `O teu pedido de alteração de ficha foi recusado. ${reason}`,
    },
  });

  return res.json({ success: true });
});

export { router as profileRouter };
