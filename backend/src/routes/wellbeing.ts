import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendTransactionalEmail } from '../lib/email.js';
import { notifyUsers } from '../lib/notifications.js';
import { canAccessUserByPermission, hasPermission } from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const WELLBEING_SETTING_KEY = 'wellbeing_page_content_v1';
const TPEOPLE_USERNAME = 't.people';

const wellbeingFileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  fileName: z.string().trim().min(1).max(260),
  linkPath: z.string().trim().min(1).max(400),
  link: z.string().trim().min(1).max(800),
});

const wellbeingResourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(['pdf', 'form']),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(600).default(''),
  buttonLabel: z.string().trim().max(80).default(''),
  files: z.array(wellbeingFileSchema).max(20).default([]),
});

const wellbeingSectionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(600).default(''),
  resources: z.array(wellbeingResourceSchema).max(20),
});

const wellbeingContentSchema = z.object({
  heroTitle: z.string().trim().min(1).max(160),
  heroDescription: z.string().trim().max(800).default(''),
  sections: z.object({
    PT: wellbeingSectionSchema,
    BR: wellbeingSectionSchema,
  }),
});

const harassmentReportSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(15).max(4000),
  preferredContact: z.string().trim().max(160).optional().default(''),
});

type WellbeingContent = z.infer<typeof wellbeingContentSchema>;
type WorkCountry = 'PT' | 'BR';

function buildDefaultWellbeingContent(): WellbeingContent {
  return {
    heroTitle: 'Saúde e bem-estar',
    heroDescription: 'Documentos, políticas e canais de apoio organizados por país. Esta área pode ser ajustada por RH e t.people conforme necessário.',
    sections: {
      BR: {
        title: 'Brasil',
        description: 'Conteúdos de referência para o contexto do Brasil.',
        resources: [
          {
            id: 'br-seguro-vida',
            kind: 'pdf',
            title: 'Seguro de Vida',
            description: 'Podes associar um ou mais PDFs a este bloco.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
          {
            id: 'br-plano-saude',
            kind: 'pdf',
            title: 'Plano de Saúde',
            description: 'Documentação de adesão, coberturas e contactos úteis.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
        ],
      },
      PT: {
        title: 'Portugal',
        description: 'Conteúdos de apoio para colaboradores em Portugal.',
        resources: [
          {
            id: 'pt-acidentes-pessoais',
            kind: 'pdf',
            title: 'Acidentes Pessoais',
            description: 'Podes associar um ou mais PDFs a este bloco.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
          {
            id: 'pt-seguro-saude',
            kind: 'pdf',
            title: 'Seguro de Saúde',
            description: 'Coberturas, procedimentos e documentação útil.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
          {
            id: 'pt-assedio',
            kind: 'form',
            title: 'Formulário de reportar assédio',
            description: 'Canal interno para reportar situações que devam ser acompanhadas por RH e t.people.',
            buttonLabel: 'Reportar situação',
            files: [],
          },
          {
            id: 'pt-politica-viagens-lazer',
            kind: 'pdf',
            title: 'Política de Viagens e Lazer',
            description: 'Podes associar um ou mais PDFs a este bloco.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
          {
            id: 'pt-ergonomia',
            kind: 'pdf',
            title: 'Ergonomia',
            description: 'Boas práticas e documentação de apoio.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
          {
            id: 'pt-suporte-basico-vida',
            kind: 'pdf',
            title: 'Suporte Básico de Vida',
            description: 'Materiais de consulta rápida e formação.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
        ],
      },
    },
  };
}

async function canManageWellbeingPage(user: NonNullable<Request['authUser']>) {
  const isTPeople = (user.username ?? '').toLowerCase() === TPEOPLE_USERNAME;
  if (user.isRootAccess || user.hasAccessTotal || isTPeople) {
    return true;
  }

  return hasPermission(user.id, 'approve_profile_change');
}

async function resolveAllowedCountries(user: NonNullable<Request['authUser']>): Promise<WorkCountry[] | 'ALL'> {
  const isTPeople = (user.username ?? '').toLowerCase() === TPEOPLE_USERNAME;
  if (user.isRootAccess || user.hasAccessTotal || isTPeople) {
    return 'ALL';
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { workCountry: true },
  });

  return [profile?.workCountry === 'BR' ? 'BR' : 'PT'];
}

function redactContentByCountries(content: WellbeingContent, allowedCountries: WorkCountry[] | 'ALL'): WellbeingContent {
  if (allowedCountries === 'ALL') {
    return content;
  }

  const canSeePt = allowedCountries.includes('PT');
  const canSeeBr = allowedCountries.includes('BR');

  return {
    ...content,
    sections: {
      PT: canSeePt
        ? content.sections.PT
        : {
          title: 'Portugal',
          description: '',
          resources: [],
        },
      BR: canSeeBr
        ? content.sections.BR
        : {
          title: 'Brasil',
          description: '',
          resources: [],
        },
    },
  };
}

function mergeScopedContent(current: WellbeingContent, incoming: WellbeingContent, allowedCountries: WorkCountry[] | 'ALL'): WellbeingContent {
  if (allowedCountries === 'ALL') {
    return incoming;
  }

  return {
    ...current,
    sections: {
      PT: allowedCountries.includes('PT') ? incoming.sections.PT : current.sections.PT,
      BR: allowedCountries.includes('BR') ? incoming.sections.BR : current.sections.BR,
    },
  };
}

async function loadWellbeingContent() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: WELLBEING_SETTING_KEY },
    select: { textValue: true },
  });

  if (!setting?.textValue) {
    return buildDefaultWellbeingContent();
  }

  try {
    const parsed = JSON.parse(setting.textValue) as unknown;
    const result = wellbeingContentSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
    // fallback below
  }

  return buildDefaultWellbeingContent();
}

async function saveWellbeingContent(content: WellbeingContent) {
  await prisma.systemSetting.upsert({
    where: { key: WELLBEING_SETTING_KEY },
    update: { textValue: JSON.stringify(content), boolValue: null },
    create: { key: WELLBEING_SETTING_KEY, textValue: JSON.stringify(content), boolValue: null },
  });
}

async function resolveHarassmentRecipientUsers(reporterUserId: string) {
  const reporter = await prisma.user.findUnique({
    where: { id: reporterUserId },
    select: {
      id: true,
      username: true,
      email: true,
      profile: {
        select: {
          nomeCompleto: true,
          nomeAbreviado: true,
          workCountry: true,
        },
      },
    },
  });

  if (!reporter) {
    throw new Error('Colaborador não encontrado.');
  }

  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: reporterUserId },
      OR: [
        { isRootAccess: true },
        { username: { equals: TPEOPLE_USERNAME, mode: 'insensitive' } },
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
      email: true,
      isRootAccess: true,
    },
  });

  const recipients: Array<{ id: string; email: string; username: string }> = [];
  for (const candidate of candidates) {
    if (!candidate.email?.trim()) {
      continue;
    }

    const candidateIsTPeople = candidate.username.toLowerCase() === TPEOPLE_USERNAME;
    if (candidateIsTPeople || candidate.isRootAccess) {
      recipients.push({ id: candidate.id, email: candidate.email, username: candidate.username });
      continue;
    }

    const canReview = await canAccessUserByPermission(candidate.id, 'approve_profile_change', reporterUserId);
    if (canReview) {
      recipients.push({ id: candidate.id, email: candidate.email, username: candidate.username });
    }
  }

  return {
    reporter,
    recipients: Array.from(new Map(recipients.map((item) => [item.id, item])).values()),
  };
}

router.get('/wellbeing/content', requireAuth, async (req: Request, res: Response) => {
  if (!req.authUser) {
    return res.status(401).json({ message: 'Sessão inválida.' });
  }

  const content = await loadWellbeingContent();
  const allowedCountries = await resolveAllowedCountries(req.authUser);
  return res.json(redactContentByCountries(content, allowedCountries));
});

router.put('/wellbeing/content', requireAuth, async (req: Request, res: Response) => {
  if (!req.authUser || !await canManageWellbeingPage(req.authUser)) {
    return res.status(403).json({ message: 'Sem permissões para editar a página Saúde e bem-estar.' });
  }

  const parsed = wellbeingContentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Conteúdo inválido para a página Saúde e bem-estar.', issues: parsed.error.issues });
  }

  const currentContent = await loadWellbeingContent();
  const allowedCountries = await resolveAllowedCountries(req.authUser);
  const merged = mergeScopedContent(currentContent, parsed.data, allowedCountries);

  await saveWellbeingContent(merged);
  return res.json(redactContentByCountries(merged, allowedCountries));
});

router.post('/wellbeing/harassment-report', requireAuth, async (req: Request, res: Response) => {
  if (!req.authUser) {
    return res.status(401).json({ message: 'Sessão inválida.' });
  }

  const parsed = harassmentReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Formulário inválido.', issues: parsed.error.issues });
  }

  const { reporter, recipients } = await resolveHarassmentRecipientUsers(req.authUser.id);
  if (recipients.length === 0) {
    return res.status(503).json({ message: 'Não foi possível encontrar destinatários para este reporte. Contacta o administrador.' });
  }

  const reporterName = String(reporter.profile?.nomeAbreviado || reporter.profile?.nomeCompleto || reporter.username || 'Colaborador').trim();
  const reporterCountry = reporter.profile?.workCountry === 'BR' ? 'Brasil' : 'Portugal';
  const preferredContact = parsed.data.preferredContact.trim();
  const messageLines = [
    `${reporterName} submeteu um reporte de assédio.`,
    `País: ${reporterCountry}`,
    `Assunto: ${parsed.data.subject}`,
    preferredContact ? `Contacto preferencial: ${preferredContact}` : 'Contacto preferencial: não indicado',
    '',
    parsed.data.description,
  ];
  const message = messageLines.join('\n');

  await notifyUsers(
    prisma,
    recipients.map((item) => item.id),
    'Novo reporte de assédio',
    message,
  );

  await Promise.allSettled(
    recipients.map((recipient) => sendTransactionalEmail({
      to: recipient.email,
      subject: `Novo reporte de assédio · ${reporterCountry}`,
      text: message,
    })),
  );

  return res.status(201).json({ message: 'Reporte enviado com sucesso.' });
});

export { router as wellbeingRouter };