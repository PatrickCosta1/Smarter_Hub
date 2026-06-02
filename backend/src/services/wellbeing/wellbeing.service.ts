import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { sendTransactionalEmail } from '../../lib/email.js';
import { notifyUsers } from '../../lib/notifications.js';
import { hasPermission } from '../../lib/permission-engine.js';
import {
  findWellbeingSetting,
  upsertWellbeingSetting,
  findUserWithProfile,
  findTPeopleRecipients,
} from '../../repositories/wellbeing.repository.js';

export const wellbeingFileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  fileName: z.string().trim().min(1).max(260),
  linkPath: z.string().trim().min(1).max(400),
  link: z.string().trim().min(1).max(800),
});

export const wellbeingReportConfigSchema = z.object({
  modalTitle: z.string().trim().max(120).default('Reportar situação'),
  introTitle: z.string().trim().max(120).default('Canal confidencial de reporte'),
  introText: z.string().trim().max(800).default('Usa este canal para situações que precisem de acompanhamento formal.'),
  subjectLabel: z.string().trim().max(80).default('Assunto'),
  subjectPlaceholder: z.string().trim().max(140).default(''),
  descriptionLabel: z.string().trim().max(80).default('Descrição detalhada'),
  descriptionPlaceholder: z.string().trim().max(300).default(''),
  preferredContactLabel: z.string().trim().max(100).default('Contacto preferencial'),
  preferredContactPlaceholder: z.string().trim().max(160).default(''),
  submitLabel: z.string().trim().max(60).default('Enviar reporte'),
  cancelLabel: z.string().trim().max(60).default('Cancelar'),
});

export const wellbeingResourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(['pdf', 'form']),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(600).default(''),
  buttonLabel: z.string().trim().max(80).default(''),
  files: z.array(wellbeingFileSchema).max(20).default([]),
  reportConfig: wellbeingReportConfigSchema.optional(),
});

export const wellbeingSectionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(600).default(''),
  resources: z.array(wellbeingResourceSchema).max(20),
});

export const wellbeingContentSchema = z.object({
  heroTitle: z.string().trim().min(1).max(160),
  heroDescription: z.string().trim().max(800).default(''),
  sections: z.object({
    PT: wellbeingSectionSchema,
    BR: wellbeingSectionSchema,
  }),
});

export const harassmentReportSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(15).max(4000),
  preferredContact: z.string().trim().max(160).optional().default(''),
});

export type WellbeingContent = z.infer<typeof wellbeingContentSchema>;
export type WellbeingResource = z.infer<typeof wellbeingResourceSchema>;
export type WorkCountry = 'PT' | 'BR';

const SHARED_WELLBEING_RESOURCE_IDS = {
  formulario_assedio: 'common-formulario-assedio',
  ergonomia: 'common-ergonomia',
  suporte_basico_vida: 'common-suporte-basico-vida',
} as const;

const TPEOPLE_USERNAME = 't.people';

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function classifySharedWellbeingResource(resource: WellbeingResource) {
  const normalizedId = normalizeText(resource.id);
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.formulario_assedio) {
    return 'formulario_assedio' as const;
  }
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.ergonomia) {
    return 'ergonomia' as const;
  }
  if (normalizedId === SHARED_WELLBEING_RESOURCE_IDS.suporte_basico_vida) {
    return 'suporte_basico_vida' as const;
  }

  const title = normalizeText(resource.title);
  if (resource.kind === 'form' && (title.includes('assedio') || title.includes('reportar assedio'))) {
    return 'formulario_assedio' as const;
  }
  if (title.includes('ergonomia')) {
    return 'ergonomia' as const;
  }
  if (title.includes('suporte basico de vida')) {
    return 'suporte_basico_vida' as const;
  }

  return null;
}

function buildDefaultSharedResource(key: keyof typeof SHARED_WELLBEING_RESOURCE_IDS): WellbeingResource {
  if (key === 'formulario_assedio') {
    return {
      id: SHARED_WELLBEING_RESOURCE_IDS.formulario_assedio,
      kind: 'form',
      title: 'Formulário Reclame Aqui',
      description: 'Canal confidencial para reclamações de saúde e bem-estar.',
      buttonLabel: 'Reclamar aqui',
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

  const resolveShared = (key: keyof typeof SHARED_WELLBEING_RESOURCE_IDS) => {
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
            title: 'Formulário Reclame Aqui',
            description: 'Canal confidencial para reclamações de saúde e bem-estar. A tua mensagem chega diretamente a t.people.',
            buttonLabel: 'Reclamar aqui',
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

export function redactContentByCountries(content: WellbeingContent, allowedCountries: WorkCountry[] | 'ALL'): WellbeingContent {
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

function isTPeopleUser(user: { username?: string | null; isRootAccess?: boolean; hasAccessTotal?: boolean }) {
  return (user.username ?? '').toLowerCase() === TPEOPLE_USERNAME;
}

export async function resolveAllowedCountries(user: { id: string; username?: string | null; isRootAccess?: boolean; hasAccessTotal?: boolean }) {
  if (user.isRootAccess || user.hasAccessTotal || isTPeopleUser(user)) {
    return 'ALL' as const;
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { workCountry: true },
  });

  return [profile?.workCountry === 'BR' ? 'BR' : 'PT'] as WorkCountry[];
}

export async function canManageWellbeingPage(user: { id: string; username?: string | null; isRootAccess?: boolean; hasAccessTotal?: boolean }) {
  if (user.isRootAccess || user.hasAccessTotal || isTPeopleUser(user)) {
    return true;
  }

  return hasPermission(user.id, 'approve_profile_change');
}

export async function loadWellbeingContent() {
  const setting = await findWellbeingSetting();
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
    // fallback to defaults when parsing fails
  }

  return enforceSharedWellbeingResources(buildDefaultWellbeingContent());
}

export async function saveWellbeingContent(content: WellbeingContent, user: { id: string; username?: string | null; isRootAccess?: boolean; hasAccessTotal?: boolean }) {
  const currentContent = await loadWellbeingContent();
  const allowedCountries = await resolveAllowedCountries(user);
  const merged = mergeScopedContent(currentContent, content, allowedCountries);
  const normalized = enforceSharedWellbeingResources(merged);

  await upsertWellbeingSetting(JSON.stringify(normalized));
  return normalized;
}

function buildWellbeingComplaintMessage(reporterName: string, reporterCountry: string, parsedData: z.infer<typeof harassmentReportSchema>) {
  const preferredContact = parsedData.preferredContact.trim();
  const lines = [
    'RECLAMAÇÃO RECLAME AQUI',
    '────────────────────────────────────────────',
    `Colaborador: ${reporterName}`,
    `País: ${reporterCountry}`,
    `Assunto: ${parsedData.subject}`,
    preferredContact ? `Contacto preferencial: ${preferredContact}` : 'Contacto preferencial: não indicado',
    '────────────────────────────────────────────',
    'Descrição:',
    parsedData.description,
  ];
  return lines.join('\n');
}

export async function submitWellbeingComplaint(reporterUserId: string, parsedData: z.infer<typeof harassmentReportSchema>) {
  const reporter = await findUserWithProfile(reporterUserId);
  if (!reporter) {
    throw new Error('Colaborador não encontrado.');
  }

  const recipients = await findTPeopleRecipients(reporterUserId);
  if (recipients.length === 0) {
    throw new Error('Não foi possível encontrar destinatários para esta reclamação. Contacta o administrador.');
  }

  const reporterName = String(reporter.profile?.nomeAbreviado || reporter.profile?.nomeCompleto || reporter.username || 'Colaborador').trim();
  const reporterCountry = reporter.profile?.workCountry === 'BR' ? 'Brasil' : 'Portugal';
  const message = buildWellbeingComplaintMessage(reporterName, reporterCountry, parsedData);

  await notifyUsers(
    prisma,
    recipients.map((item) => item.id),
    'Nova reclamação de saúde e bem-estar',
    message,
  );

  const recipientsWithEmail = recipients.filter(
    (recipient): recipient is { id: string; username: string | null; email: string } =>
      typeof recipient.email === 'string' && recipient.email.trim().length > 0,
  );

  await Promise.allSettled(
    recipientsWithEmail.map((recipient) => sendTransactionalEmail({
      to: recipient.email,
      subject: `Nova reclamação · ${reporterCountry} · Reclame Aqui`,
      text: message,
    })),
  );
}

