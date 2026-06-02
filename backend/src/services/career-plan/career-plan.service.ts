import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

const CAREER_PLAN_SETTING_KEY = 'career_plan_content_v1';

const textItemSchema = z.string().trim().min(1).max(500);
const textListSchema = z.array(textItemSchema).max(60);

const levelSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
});

const levelDetailSchema = z.object({
  title: z.string().trim().max(180).default(''),
  expectations: textListSchema.default([]),
  signals: textListSchema.default([]),
});

const familySchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(1200).default(''),
  roles: textListSchema.default([]),
  keywords: textListSchema.default([]),
  coreSkills: textListSchema.default([]),
  expectedBehaviors: textListSchema.default([]),
  nextStepFocus: textListSchema.default([]),
  levelDetails: z.record(z.string(), levelDetailSchema).default({}),
});

const evaluationSectionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  responsible: z.string().trim().min(1).max(120),
  instructions: textListSchema.default([]),
});

const evaluationStageSchema = z.object({
  stage: z.string().trim().min(1).max(120),
  items: textListSchema.default([]),
});

export const careerPlanContentSchema = z.object({
  levels: z.array(levelSchema).min(1).max(20),
  families: z.array(familySchema).min(1).max(40),
  ninetyDayPlan: textListSchema.default([]),
  evaluationSections: z.array(evaluationSectionSchema).default([]),
  evaluationStages: z.array(evaluationStageSchema).default([]),
});

export type CareerPlanContent = z.infer<typeof careerPlanContentSchema>;

const LEGACY_LEVELS = ['Trainee', 'Junior', 'Associate', 'Senior', 'Lead', 'Principal', 'Director', 'C Level'] as const;

const LEVEL_TITLES: Record<(typeof LEGACY_LEVELS)[number], string> = {
  Trainee: 'Entrada e aprendizagem estruturada',
  Junior: 'Execução operacional com supervisão próxima',
  Associate: 'Execução com autonomia e foco em resultados',
  Senior: 'Domínio técnico e coordenação de pequena equipa',
  Lead: 'Coordenação operacional e gestão de equipa direta',
  Principal: 'Gestão ampla da unidade e orçamento',
  Director: 'Direção de área com visão transversal',
  'C Level': 'Direção estratégica do pelouro',
};

const LEVEL_EXPECTATIONS: Record<(typeof LEGACY_LEVELS)[number], string[]> = {
  'C Level': [
    'Colaboradores neste nível são profissionais muito experientes na sua área de atuação.',
    'Tem ampla latitude de tomada de decisão dentro das suas unidades funcionais.',
    'Tem autonomia na gestão transversal da equipa (contratação, demissão, promoção e migração de área).',
    'Fornece orientação estratégica às unidades sob seu controlo.',
  ],
  Director: [
    'Colaboradores neste nível possuem uma visão transversal da organização.',
    'Possuem total autonomia na gestão da sua equipa e orçamento dentro das normas definidas.',
  ],
  Principal: [
    'Profissionais experientes com grande autonomia técnica e capacidade de influência em múltiplas equipas.',
    'Lideram iniciativas estratégicas sem necessidade de microgestão.',
  ],
  Lead: [
    'Executam e orientam equipas menores com foco em qualidade e prazo.',
    'Atuam como ponto de contacto entre colaboradores e direção.',
  ],
  Senior: [
    'Dominam tecnologias e práticas da área com autonomia técnica.',
    'Contribuem para soluções complexas e apoio a colegas.',
  ],
  Associate: [
    'Desenvolvem tarefas com orientação clara e começam a tomar decisões técnicas.',
    'Aprimoram competências de comunicação no contexto de projetos.',
  ],
  Junior: [
    'Executam tarefas definidas com acompanhamento técnico.',
    'Adquirem confiança nos processos e ferramentas do time.',
  ],
  Trainee: [
    'Aprendem as bases técnicas e processos internos.',
    'Recebem orientação constante para ganhar autonomia progressiva.',
  ],
};

function buildLegacyLevels() {
  return LEGACY_LEVELS.map((value) => ({
    id: value,
    label: value,
    title: LEVEL_TITLES[value],
  }));
}

function buildLevelDetails() {
  return LEGACY_LEVELS.reduce((acc, level) => {
    acc[level] = {
      title: LEVEL_TITLES[level],
      expectations: LEVEL_EXPECTATIONS[level] || [],
      signals: [],
    };
    return acc;
  }, {} as Record<string, { title: string; expectations: string[]; signals: string[] }>);
}

function buildDefaultCareerPlanContent(): CareerPlanContent {
  return {
    levels: buildLegacyLevels(),
    families: [
      {
        id: 'geral',
        label: 'Competências e requisitos gerais',
        summary: 'Este plano de carreira descreve as principais responsabilidades e expectativas por nível.',
        roles: [],
        keywords: [],
        coreSkills: [],
        expectedBehaviors: [],
        nextStepFocus: [],
        levelDetails: buildLevelDetails(),
      },
    ],
    ninetyDayPlan: [
      'Definir objetivos de curto prazo alinhados com resultados do ciclo atual.',
      'Reforçar competências técnicas e comportamentais mais críticas.',
      'Validar prioridades com o gestor direto.',
    ],
    evaluationSections: [
      {
        title: 'Seção 1 - Resultado e impacto',
        responsible: 'Colaborador',
        instructions: ['Registar entregas mais relevantes do ciclo.', 'Descrever impacto no negócio e no cliente.'],
      },
      {
        title: 'Seção 2 - Competências técnicas',
        responsible: 'Colaborador',
        instructions: ['Listar competências desenvolvidas.', 'Indicar evidências de exposição a desafios técnicos.'],
      },
      {
        title: 'Seção 3 - Competências comportamentais',
        responsible: 'Colaborador',
        instructions: ['Descrever exemplos de colaboração e comunicação.', 'Refletir sobre autonomia e confiança.'],
      },
      {
        title: 'Seção 4 - Desenvolvimento profissional',
        responsible: 'Gestor',
        instructions: ['Validar progresso de objetivos pessoais e de equipe.', 'Sugerir foco para o próximo ciclo.'],
      },
      {
        title: 'Seção 5 - Reflexão sobre a Liderança',
        responsible: 'Colaborador',
        instructions: ['Registar feedback estruturado sobre liderança.', 'Promover cultura de diálogo, confiança e desenvolvimento contínuo.'],
      },
      {
        title: 'Seção 6 - O próximo ciclo',
        responsible: 'Gestor',
        instructions: ['Avaliar desempenho global do colaborador no ciclo.', 'Registar recomendações e foco de desenvolvimento.'],
      },
      {
        title: 'Seção 7 - Objetivos e KPIs para 2027',
        responsible: 'Colaborador (proposta inicial) + Gestor (validação final)',
        instructions: ['Definição preliminar de objetivos e KPIs do ciclo seguinte.', 'Garantir coerência com função, nível e metas da área.'],
      },
    ],
    evaluationStages: [
      {
        stage: 'Etapa Colaborador',
        items: ['Propõe objetivos e KPIs do ciclo.', 'Regista reflexão de ciclo anterior com evidências.', 'Partilha feedback sobre liderança.'],
      },
      {
        stage: 'Etapa Liderança',
        items: ['Revê, ajusta e valida KPIs em conjunto com colaborador.', 'Avalia competências comportamentais com base na matriz oficial.', 'Consolida avaliação global e orientações para o próximo ciclo.'],
      },
    ],
  };
}

function looksLikeSparsePlaceholder(content: CareerPlanContent) {
  if (content.families.length !== 1) {
    return false;
  }

  const onlyFamily = content.families[0];
  if (onlyFamily.id !== 'geral') {
    return false;
  }

  const noRichContent = onlyFamily.roles.length === 0
    && onlyFamily.coreSkills.length === 0
    && onlyFamily.expectedBehaviors.length === 0;

  if (!noRichContent) {
    return false;
  }

  return Object.values(onlyFamily.levelDetails).every((item) => item.expectations.length === 0 && item.signals.length === 0);
}

export async function loadCareerPlanContent() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: CAREER_PLAN_SETTING_KEY },
    select: { textValue: true },
  });

  if (!setting?.textValue) {
    return buildDefaultCareerPlanContent();
  }

  try {
    const parsed = JSON.parse(setting.textValue) as unknown;
    const result = careerPlanContentSchema.safeParse(parsed);
    if (result.success) {
      if (looksLikeSparsePlaceholder(result.data)) {
        return buildDefaultCareerPlanContent();
      }
      return result.data;
    }
  } catch {
    // Fallback para default abaixo.
  }

  return buildDefaultCareerPlanContent();
}

export async function saveCareerPlanContent(content: CareerPlanContent) {
  await prisma.systemSetting.upsert({
    where: { key: CAREER_PLAN_SETTING_KEY },
    update: {
      textValue: JSON.stringify(content),
      boolValue: null,
    },
    create: {
      key: CAREER_PLAN_SETTING_KEY,
      textValue: JSON.stringify(content),
      boolValue: null,
    },
  });
}
