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

const wellbeingReportConfigSchema = z.object({
  modalTitle: z.string().trim().max(120).default('Reportar situação'),
  introTitle: z.string().trim().max(120).default('Canal confidencial de reporte'),
  introText: z.string().trim().max(800).default('O reporte será notificado ao RH do país respetivo e ao t.people. Usa este canal para situações que precisem de acompanhamento formal.'),
  subjectLabel: z.string().trim().max(80).default('Assunto'),
  subjectPlaceholder: z.string().trim().max(140).default('Ex.: Situação de assédio verbal'),
  descriptionLabel: z.string().trim().max(80).default('Descrição detalhada'),
  descriptionPlaceholder: z.string().trim().max(300).default('Descreve o ocorrido com contexto, datas aproximadas e pessoas envolvidas.'),
  preferredContactLabel: z.string().trim().max(100).default('Contacto preferencial'),
  preferredContactPlaceholder: z.string().trim().max(160).default('Ex.: email pessoal, Teams ou telemóvel'),
  submitLabel: z.string().trim().max(60).default('Enviar reporte'),
  cancelLabel: z.string().trim().max(60).default('Cancelar'),
});

const wellbeingResourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(['pdf', 'form']),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(600).default(''),
  buttonLabel: z.string().trim().max(80).default(''),
  files: z.array(wellbeingFileSchema).max(20).default([]),
  reportConfig: wellbeingReportConfigSchema.optional(),
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
type WellbeingResource = z.infer<typeof wellbeingResourceSchema>;
type WorkCountry = 'PT' | 'BR';

type SharedWellbeingKey = 'formulario_assedio' | 'ergonomia' | 'suporte_basico_vida';

const SHARED_WELLBEING_RESOURCE_IDS: Record<SharedWellbeingKey, string> = {
  formulario_assedio: 'common-formulario-assedio',
  ergonomia: 'common-ergonomia',
  suporte_basico_vida: 'common-suporte-basico-vida',
};

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function classifySharedWellbeingResource(resource: WellbeingResource): SharedWellbeingKey | null {
  const normalizedId = normalizeText(resource.id);
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.formulario_assedio) {
    return 'formulario_assedio';
  }
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.ergonomia) {
    return 'ergonomia';
  }
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.suporte_basico_vida) {
    return 'suporte_basico_vida';
  }

  const title = normalizeText(resource.title);
  if (resource.kind === 'form' && (title.includes('assedio') || title.includes('reportar assedio'))) {
    return 'formulario_assedio';
  }
  if (title.includes('ergonomia')) {
    return 'ergonomia';
  }
  if (title.includes('suporte basico de vida')) {
    return 'suporte_basico_vida';
  }
  return null;
}

function buildDefaultSharedResource(key: SharedWellbeingKey): WellbeingResource {
  if (key === 'formulario_assedio') {
    return {
      id: SHARED_WELLBEING_RESOURCE_IDS.formulario_assedio,
      kind: 'form',
      title: 'Formulário de reportar assédio',
      description: 'Canal interno para reportar situações que devam ser acompanhadas por RH e t.people.',
      buttonLabel: 'Reportar situação',
      files: [],
      reportConfig: wellbeingReportConfigSchema.parse({}),
    };
  }

  if (key === 'ergonomia') {
    return {
      id: SHARED_WELLBEING_RESOURCE_IDS.ergonomia,
      kind: 'pdf',
      title: 'Ergonomia',
      description: 'Boas práticas e documentação de apoio.',
      buttonLabel: 'Abrir PDF',
      files: [],
    };
  }

  return {
    id: SHARED_WELLBEING_RESOURCE_IDS.suporte_basico_vida,
    kind: 'pdf',
    title: 'Suporte Básico de Vida',
    description: 'Materiais de consulta rápida e formação.',
    buttonLabel: 'Abrir PDF',
    files: [],
  };
}

function enforceSharedWellbeingResources(content: WellbeingContent): WellbeingContent {
  const allResources = [...content.sections.PT.resources, ...content.sections.BR.resources];

  const resolveShared = (key: SharedWellbeingKey) => {
    const fromPt = content.sections.PT.resources.find((resource) => classifySharedWellbeingResource(resource) === key);
    if (fromPt) {
      return { ...fromPt, id: SHARED_WELLBEING_RESOURCE_IDS[key] };
    }
    const fromBr = content.sections.BR.resources.find((resource) => classifySharedWellbeingResource(resource) === key);
    if (fromBr) {
      return { ...fromBr, id: SHARED_WELLBEING_RESOURCE_IDS[key] };
    }
    const fromPool = allResources.find((resource) => classifySharedWellbeingResource(resource) === key);
    if (fromPool) {
      return { ...fromPool, id: SHARED_WELLBEING_RESOURCE_IDS[key] };
    }
    return buildDefaultSharedResource(key);
  };

  const sharedResources = [
    resolveShared('formulario_assedio'),
    resolveShared('ergonomia'),
    resolveShared('suporte_basico_vida'),
  ];

  const stripShared = (resources: WellbeingResource[]) => resources.filter((resource) => !classifySharedWellbeingResource(resource));

  return {
    ...content,
    sections: {
      PT: {
        ...content.sections.PT,
        resources: [...stripShared(content.sections.PT.resources), ...sharedResources],
      },
      BR: {
        ...content.sections.BR,
        resources: [...stripShared(content.sections.BR.resources), ...sharedResources],
      },
    },
  };
}

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
            id: 'common-formulario-assedio',
            kind: 'form',
            title: 'Formulário de reportar assédio',
            description: 'Canal interno para reportar situações que devam ser acompanhadas por RH e t.people.',
            buttonLabel: 'Reportar situação',
            files: [],
            reportConfig: wellbeingReportConfigSchema.parse({}),
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
            id: 'common-ergonomia',
            kind: 'pdf',
            title: 'Ergonomia',
            description: 'Boas práticas e documentação de apoio.',
            buttonLabel: 'Abrir PDF',
            files: [],
          },
          {
            id: 'common-suporte-basico-vida',
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
    return enforceSharedWellbeingResources(buildDefaultWellbeingContent());
  }

  try {
    const parsed = JSON.parse(setting.textValue) as unknown;
    const result = wellbeingContentSchema.safeParse(parsed);
    if (result.success) {
      return enforceSharedWellbeingResources(result.data);
    }
  } catch {
    // fallback below
  }

  return enforceSharedWellbeingResources(buildDefaultWellbeingContent());
}

async function saveWellbeingContent(content: WellbeingContent) {
  const normalized = enforceSharedWellbeingResources(content);
  await prisma.systemSetting.upsert({
    where: { key: WELLBEING_SETTING_KEY },
    update: { textValue: JSON.stringify(normalized), boolValue: null },
    create: { key: WELLBEING_SETTING_KEY, textValue: JSON.stringify(normalized), boolValue: null },
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
  const normalized = enforceSharedWellbeingResources(merged);

  await saveWellbeingContent(normalized);
  return res.json(redactContentByCountries(normalized, allowedCountries));
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