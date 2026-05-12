import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

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

const careerPlanContentSchema = z.object({
  levels: z.array(levelSchema).min(1).max(20),
  families: z.array(familySchema).min(1).max(40),
  ninetyDayPlan: textListSchema.default([]),
  evaluationSections: z.array(evaluationSectionSchema).default([]),
  evaluationStages: z.array(evaluationStageSchema).default([]),
});

type CareerPlanContent = z.infer<typeof careerPlanContentSchema>;

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
    'Define os planos operacionais e estratégicos para a sua unidade.',
    'Tem responsabilidade pela definição, execução e controlo do orçamento da sua unidade.',
  ],
  Principal: [
    'E o substituto natural do director a que reporta.',
    'Possuem autonomia na gestão da sua equipa e orçamento dentro das normas definidas.',
    'Faz gestão de equipas e do desenvolvimento do potencial e âmbito de atuação da equipa.',
    'Define e controla objetivos operacionais de médio prazo alinhados com os objetivos da unidade.',
  ],
  Lead: [
    'Possui total dominio dos procedimentos e sistemas usados.',
    'Trabalha para objetivos específicos que requerem planeamento operacional sem supervisão.',
    'Tem autonomia na gestão da sua equipa e orçamento dentro das normas definidas.',
    'Define e controla objetivos operacionais de médio prazo para desenvolvimento em equipa.',
  ],
  Senior: [
    'Possui total dominio dos procedimentos e sistemas usados.',
    'Trabalha para objetivos específicos com reduzida supervisão.',
    'Faz gestão de pequenas equipas (1 a 3 elementos) e desenvolvimento de recursos diretos.',
    'Controla objetivos operacionais de médio prazo para desenvolvimento individual e de equipa.',
  ],
  Associate: [
    'Demonstra experiência e segurança na execução de procedimentos e sistemas.',
    'Possui autonomia para tomada de decisões com base em procedimentos definidos.',
    'Não é esperada a gestão de pessoas, podendo acompanhar colaboradores mais juniores.',
    'Tem objetivos operacionais de curto e médio prazo dentro dos objetivos da equipa.',
  ],
  Junior: [
    'Segue rotinas de trabalho padrão e desenvolve atividades com supervisão muito próxima.',
    'Possui pouca capacidade de autonomia e decisão, obrigando a supervisão próxima.',
    'Não gere pessoas ou equipas.',
    'Tem objetivos puramente operacionais e de curto prazo para desenvolvimento individual.',
  ],
  Trainee: [
    'Possui um objetivo concreto e bem definido para o período de estágio.',
    'Requer supervisão muito próxima para garantir o cumprimento do objetivo de estágio.',
    'Foco em avaliação de potencial e aprendizagem acelerada.',
  ],
};

const LEVEL_SIGNALS_BASE: Record<(typeof LEGACY_LEVELS)[number], string[]> = {
  'C Level': [
    'Fornece orientação estratégica às unidades sob seu controlo.',
    'Define objetivos e orçamentos de médio e longo prazo para a equipa.',
    'Tem autonomia na gestão transversal da equipa e dos recursos.',
  ],
  Director: [
    'Define planos operacionais e estratégicos para a unidade.',
    'Tem autonomia na gestão de equipa e orçamento dentro das normas.',
    'Apoia subordinados na gestão corrente operacional e da equipa.',
  ],
  Principal: [
    'Influencia decisões relevantes da unidade com visão de negócio.',
    'Coordena pessoas e prioridades com foco em escala.',
    'Consolida práticas e objetivos de médio prazo com autonomia.',
  ],
  Lead: [
    'Estimula melhoria contínua no time e conduz ajustes operacionais.',
    'Facilita diálogo e alinhamento entre equipa e liderança.',
    'Equilibra demandas, prazos e qualidade das entregas.',
  ],
  Senior: [
    'Atua como referência técnica para colegas e pares.',
    'Antecipação de riscos e melhoria de processos.',
    'Consistência em entregas com baixo nível de supervisão.',
  ],
  Associate: [
    'Contribui com soluções práticas e melhoria contínua.',
    'Partilha conhecimento e colabora ativamente com o time.',
    'Organiza prioridades e cumpre objetivos com autonomia.',
  ],
  Junior: [
    'Executa atividades com autonomia inicial e boa disciplina.',
    'Mantém comunicação clara e colaboração consistente.',
    'Aplica feedback para evolução técnica e comportamental.',
  ],
  Trainee: [
    'Aprende rapidamente e adapta-se a novas rotinas.',
    'Colabora com a equipa e segue orientações de forma consistente.',
    'Demonstra abertura ao aprendizado contínuo.',
  ],
};

function buildFamilyLevelDetails() {
  return Object.fromEntries(LEGACY_LEVELS.map((level) => [
    level,
    {
      title: LEVEL_TITLES[level],
      expectations: [...LEVEL_EXPECTATIONS[level]],
      signals: [
        ...LEVEL_SIGNALS_BASE[level],
        `Aplica os critérios de progressão do eixo hierárquico no nível ${level}.`,
      ],
    },
  ]));
}

function buildDefaultCareerPlanContent(): CareerPlanContent {
  const commonSkills = ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'];
  const commonFocus = ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'];

  const families: CareerPlanContent['families'] = [
    {
      id: 'sales',
      label: 'Sales & Pre-Sales',
      summary: 'Gerar novas vendas sustentáveis, articular equipas e cumprir KPIs comerciais.',
      roles: ['Sales Director', 'Sales Manager', 'Sales Consultant', 'Pre-Sales Manager', 'Pre-Sales Consultant'],
      keywords: ['sales', 'pre-sales', 'comercial', 'business development'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Meritocracia e transparência', 'Equidade entre geografias e equipas', 'Alinhamento com práticas de mercado'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'delivery',
      label: 'Delivery',
      summary: 'Entregar resultados com qualidade, prazo, margem e satisfação do cliente.',
      roles: ['Delivery Director', 'Delivery Manager', 'Project Manager', 'Business Consultant', 'Technical Consultant'],
      keywords: ['delivery', 'project manager', 'technical consultant', 'business consultant'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Responsabilidade por qualidade de entrega', 'Cumprimento de SLAs e orçamento', 'Coordenação e motivação de equipas'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'product',
      label: 'Product',
      summary: 'Definir estratégia de produto e experiência de cliente alinhadas com metas de negócio.',
      roles: ['Product Director', 'Product Manager', 'Product Owner', 'Business Analyst', 'Product Architect', 'Software Engineer', 'Software Developer'],
      keywords: ['product', 'owner', 'scrum', 'architect', 'software', 'developer', 'engineer', 'qa', 'quality', 'data'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Gestão clara de roadmap e backlog', 'Priorização por impacto', 'Longevidade tecnológica do produto'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'services',
      label: 'Services',
      summary: 'Gerir e evoluir serviços de TI, suporte e operações com melhoria contínua.',
      roles: ['Service Director', 'Service Manager', 'Service Engineer', 'Service Analyst', 'DevOps Manager', 'DevOps Engineer'],
      keywords: ['service', 'devops', 'support'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Confiabilidade operacional', 'Suporte técnico consistente', 'Cultura DevOps e CI/CD'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'operations-control',
      label: 'Operations & Control',
      summary: 'Assegurar controlo financeiro, eficiência operacional e suporte à decisão.',
      roles: ['Operations & Control Director', 'Operations & Control Manager', 'Business Controller'],
      keywords: ['operations', 'control', 'controller', 'finance', 'financial'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Rigor analítico e financeiro', 'Suporte à decisão estratégica', 'Controlo interno e eficiência'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'pessoas',
      label: 'People',
      summary: 'Definir e executar estratégia de RH com equidade, cultura e desenvolvimento de talento.',
      roles: ['People Director', 'People Manager', 'People Partner', 'Administrative Assistant'],
      keywords: ['people', 'rh', 'human', 'partner', 'administrative'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Aplicação uniforme de políticas', 'Desenvolvimento contínuo de pessoas', 'Apoio às lideranças e equipas'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'communication',
      label: 'Communication',
      summary: 'Definir e executar o plano de comunicação alinhado com objetivos organizacionais.',
      roles: ['Communication Director', 'Communication Manager', 'Communication Specialist'],
      keywords: ['communication', 'marketing', 'comunicação'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Clareza de comunicação', 'Coordenação entre áreas', 'Execução disciplinada do plano'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'geral',
      label: 'Plano Geral',
      summary: 'Evolução por níveis com critérios claros de autonomia, gestão de pessoas e atuação operacional e estratégica.',
      roles: [],
      keywords: ['geral'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Meritocracia e transparência', 'Equidade entre equipas', 'Simplicidade hierárquica'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
  ];

  return {
    levels: LEGACY_LEVELS.map((label) => ({ id: label.toLowerCase().replace(/\s+/g, '-'), label })),
    families,
    ninetyDayPlan: [
      '30 dias: definir objetivos e KPIs em conjunto.',
      '60 dias: acompanhar execução e ajustar prioridades.',
      '90 dias: consolidar evidências para avaliação global.',
    ],
    evaluationSections: [
      {
        title: 'Seção 1 - Identificação do Colaborador',
        responsible: 'Gestor',
        instructions: ['Confirmar os dados do colaborador.', 'Preencher o campo Avaliador e a data da avaliação.'],
      },
      {
        title: 'Seção 2 - Ciclo Anterior: reflexão',
        responsible: 'Colaborador (Parte A) e Gestor (Parte B)',
        instructions: ['Destacar principais entregas e resultados com exemplos concretos.', 'Evitar descrições vagas e manter objetividade.'],
      },
      {
        title: 'Seção 3 - Competências Comportamentais',
        responsible: 'Gestor',
        instructions: ['Avaliar competências comportamentais alinhadas com os valores da Tlantic.', 'Usar a matriz por nível para justificar avaliação.'],
      },
      {
        title: 'Seção 4 - Objetivos e KPIs 2026',
        responsible: 'Colaborador (proposta inicial) + Gestor (validação final)',
        instructions: ['Definir KPIs claros, mensuráveis e ligados às responsabilidades da função.', 'Validar em reunião 1:1 entre colaborador e liderança.'],
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

async function loadCareerPlanContent() {
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

async function saveCareerPlanContent(content: CareerPlanContent) {
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

router.get('/career-plan/content', requireAuth, async (_req: Request, res: Response) => {
  const content = await loadCareerPlanContent();
  return res.json({ content });
});

router.put('/career-plan/content', requireAuth, async (req: Request, res: Response) => {
  if (!req.authUser?.isRootAccess && !req.authUser?.hasAccessTotal) {
    return res.status(403).json({ message: 'Sem permissoes para editar o plano de carreira.' });
  }

  const payload = req.body && typeof req.body === 'object' && 'content' in req.body
    ? (req.body as { content?: unknown }).content
    : req.body;

  const parsed = careerPlanContentSchema.safeParse(payload);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Payload invalido.', issues: parsed.error.issues });
  }

  await saveCareerPlanContent(parsed.data);
  return res.json({ content: parsed.data, message: 'Plano de carreira atualizado com sucesso.' });
});

export const careerPlanRouter = router;
