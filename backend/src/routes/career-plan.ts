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
  Junior: 'Execucao operacional com supervisao proxima',
  Associate: 'Execucao com autonomia e foco em resultados',
  Senior: 'Dominio tecnico e coordenacao de pequena equipa',
  Lead: 'Coordenacao operacional e gestao de equipa direta',
  Principal: 'Gestao ampla da unidade e orcamento',
  Director: 'Direcao de area com visao transversal',
  'C Level': 'Direcao estrategica do pelouro',
};

const LEVEL_EXPECTATIONS: Record<(typeof LEGACY_LEVELS)[number], string[]> = {
  'C Level': [
    'Colaboradores neste nivel sao profissionais muito experientes na sua area de atuacao.',
    'Tem ampla latitude de tomada de decisao dentro das suas unidades funcionais.',
    'Tem autonomia na gestao transversal da equipa (contratacao, demissao, promocao e migracao de area).',
    'Fornece orientacao estrategica as unidades sob seu controlo.',
  ],
  Director: [
    'Colaboradores neste nivel possuem uma visao transversal da organizacao.',
    'Possuem total autonomia na gestao da sua equipa e orcamento dentro das normas definidas.',
    'Define os planos operacionais e estrategicos para a sua unidade.',
    'Tem responsabilidade pela definicao, execucao e controlo do orcamento da sua unidade.',
  ],
  Principal: [
    'E o substituto natural do director a que reporta.',
    'Possuem autonomia na gestao da sua equipa e orcamento dentro das normas definidas.',
    'Faz gestao de equipas e do desenvolvimento do potencial e ambito de atuacao da equipa.',
    'Define e controla objetivos operacionais de medio prazo alinhados com os objetivos da unidade.',
  ],
  Lead: [
    'Possui total dominio dos procedimentos e sistemas usados.',
    'Trabalha para objetivos especificos que requerem planeamento operacional sem supervisao.',
    'Tem autonomia na gestao da sua equipa e orcamento dentro das normas definidas.',
    'Define e controla objetivos operacionais de medio prazo para desenvolvimento em equipa.',
  ],
  Senior: [
    'Possui total dominio dos procedimentos e sistemas usados.',
    'Trabalha para objetivos especificos com reduzida supervisao.',
    'Faz gestao de pequenas equipas (1 a 3 elementos) e desenvolvimento de recursos diretos.',
    'Controla objetivos operacionais de medio prazo para desenvolvimento individual e de equipa.',
  ],
  Associate: [
    'Demonstra experiencia e seguranca na execucao de procedimentos e sistemas.',
    'Possui autonomia para tomada de decisoes com base em procedimentos definidos.',
    'Nao e esperada a gestao de pessoas, podendo acompanhar colaboradores mais juniores.',
    'Tem objetivos operacionais de curto e medio prazo dentro dos objetivos da equipa.',
  ],
  Junior: [
    'Segue rotinas de trabalho padrao e desenvolve atividades com supervisao muito proxima.',
    'Possui pouca capacidade de autonomia e decisao, obrigando a supervisao proxima.',
    'Nao gere pessoas ou equipas.',
    'Tem objetivos puramente operacionais e de curto prazo para desenvolvimento individual.',
  ],
  Trainee: [
    'Possui um objetivo concreto e bem definido para o periodo de estagio.',
    'Requer supervisao muito proxima para garantir o cumprimento do objetivo de estagio.',
    'Foco em avaliacao de potencial e aprendizagem acelerada.',
  ],
};

const LEVEL_SIGNALS_BASE: Record<(typeof LEGACY_LEVELS)[number], string[]> = {
  'C Level': [
    'Fornece orientacao estrategica as unidades sob seu controlo.',
    'Define objetivos e orcamentos de medio e longo prazo para a equipa.',
    'Tem autonomia na gestao transversal da equipa e dos recursos.',
  ],
  Director: [
    'Define planos operacionais e estrategicos para a unidade.',
    'Tem autonomia na gestao de equipa e orcamento dentro das normas.',
    'Apoia subordinados na gestao corrente operacional e da equipa.',
  ],
  Principal: [
    'Influencia decisoes relevantes da unidade com visao de negocio.',
    'Coordena pessoas e prioridades com foco em escala.',
    'Consolida praticas e objetivos de medio prazo com autonomia.',
  ],
  Lead: [
    'Estimula melhoria continua no time e conduz ajustes operacionais.',
    'Facilita dialogo e alinhamento entre equipa e lideranca.',
    'Equilibra demandas, prazos e qualidade das entregas.',
  ],
  Senior: [
    'Atua como referencia tecnica para colegas e pares.',
    'Antecipacao de riscos e melhoria de processos.',
    'Consistencia em entregas com baixo nivel de supervisao.',
  ],
  Associate: [
    'Contribui com solucoes praticas e melhoria continua.',
    'Partilha conhecimento e colabora ativamente com o time.',
    'Organiza prioridades e cumpre objetivos com autonomia.',
  ],
  Junior: [
    'Executa atividades com autonomia inicial e boa disciplina.',
    'Mantem comunicacao clara e colaboracao consistente.',
    'Aplica feedback para evolucao tecnica e comportamental.',
  ],
  Trainee: [
    'Aprende rapidamente e adapta-se a novas rotinas.',
    'Colabora com a equipa e segue orientacoes de forma consistente.',
    'Demonstra abertura ao aprendizado continuo.',
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
        `Aplica os criterios de progressao do eixo hierarquico no nivel ${level}.`,
      ],
    },
  ]));
}

function buildDefaultCareerPlanContent(): CareerPlanContent {
  const commonSkills = ['Inovacao e adaptacao', 'Colaboracao', 'Adaptabilidade', 'Etica profissional', 'Desenvolvimento'];
  const commonFocus = ['Avaliacao de desempenho anual (merito)', 'Potencial', 'Vaga interna (oportunidade interna)'];

  const families: CareerPlanContent['families'] = [
    {
      id: 'sales',
      label: 'Sales & Pre-Sales',
      summary: 'Gerar novas vendas sustentaveis, articular equipas e cumprir KPIs comerciais.',
      roles: ['Sales Director', 'Sales Manager', 'Sales Consultant', 'Pre-Sales Manager', 'Pre-Sales Consultant'],
      keywords: ['sales', 'pre-sales', 'comercial', 'business development'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Meritocracia e transparencia', 'Equidade entre geografias e equipas', 'Alinhamento com praticas de mercado'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'delivery',
      label: 'Delivery',
      summary: 'Entregar resultados com qualidade, prazo, margem e satisfacao do cliente.',
      roles: ['Delivery Director', 'Delivery Manager', 'Project Manager', 'Business Consultant', 'Technical Consultant'],
      keywords: ['delivery', 'project manager', 'technical consultant', 'business consultant'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Responsabilidade por qualidade de entrega', 'Cumprimento de SLAs e orcamento', 'Coordenacao e motivacao de equipas'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'product',
      label: 'Product',
      summary: 'Definir estrategia de produto e experiencia de cliente alinhadas com metas de negocio.',
      roles: ['Product Director', 'Product Manager', 'Product Owner', 'Business Analyst', 'Product Architect', 'Software Engineer', 'Software Developer'],
      keywords: ['product', 'owner', 'scrum', 'architect', 'software', 'developer', 'engineer', 'qa', 'quality', 'data'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Gestao clara de roadmap e backlog', 'Priorizacao por impacto', 'Longevidade tecnologica do produto'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'services',
      label: 'Services',
      summary: 'Gerir e evoluir servicos de TI, suporte e operacoes com melhoria continua.',
      roles: ['Service Director', 'Service Manager', 'Service Engineer', 'Service Analyst', 'DevOps Manager', 'DevOps Engineer'],
      keywords: ['service', 'devops', 'support'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Confiabilidade operacional', 'Suporte tecnico consistente', 'Cultura DevOps e CI/CD'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'operations-control',
      label: 'Operations & Control',
      summary: 'Assegurar controlo financeiro, eficiencia operacional e suporte a decisao.',
      roles: ['Operations & Control Director', 'Operations & Control Manager', 'Business Controller'],
      keywords: ['operations', 'control', 'controller', 'finance', 'financial'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Rigor analitico e financeiro', 'Suporte a decisao estrategica', 'Controlo interno e eficiencia'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'pessoas',
      label: 'People',
      summary: 'Definir e executar estrategia de RH com equidade, cultura e desenvolvimento de talento.',
      roles: ['People Director', 'People Manager', 'People Partner', 'Administrative Assistant'],
      keywords: ['people', 'rh', 'human', 'partner', 'administrative'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Aplicacao uniforme de politicas', 'Desenvolvimento continuo de pessoas', 'Apoio as liderancas e equipas'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'communication',
      label: 'Communication',
      summary: 'Definir e executar o plano de comunicacao alinhado com objetivos organizacionais.',
      roles: ['Communication Director', 'Communication Manager', 'Communication Specialist'],
      keywords: ['communication', 'marketing', 'comunicacao'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Clareza de comunicacao', 'Coordenacao entre areas', 'Execucao disciplinada do plano'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
    {
      id: 'geral',
      label: 'Plano Geral',
      summary: 'Evolucao por niveis com criterios claros de autonomia, gestao de pessoas e atuacao operacional e estrategica.',
      roles: [],
      keywords: ['geral'],
      coreSkills: [...commonSkills],
      expectedBehaviors: ['Meritocracia e transparencia', 'Equidade entre equipas', 'Simplicidade hierarquica'],
      nextStepFocus: [...commonFocus],
      levelDetails: buildFamilyLevelDetails(),
    },
  ];

  return {
    levels: LEGACY_LEVELS.map((label) => ({ id: label.toLowerCase().replace(/\s+/g, '-'), label })),
    families,
    ninetyDayPlan: [
      '30 dias: definir objetivos e KPIs em conjunto.',
      '60 dias: acompanhar execucao e ajustar prioridades.',
      '90 dias: consolidar evidencias para avaliacao global.',
    ],
    evaluationSections: [
      {
        title: 'Secao 1 - Identificacao do Colaborador',
        responsible: 'Gestor',
        instructions: ['Confirmar os dados do colaborador.', 'Preencher o campo Avaliador e a data da avaliacao.'],
      },
      {
        title: 'Secao 2 - Ciclo Anterior: reflexao',
        responsible: 'Colaborador (Parte A) e Gestor (Parte B)',
        instructions: ['Destacar principais entregas e resultados com exemplos concretos.', 'Evitar descricoes vagas e manter objetividade.'],
      },
      {
        title: 'Secao 3 - Competencias Comportamentais',
        responsible: 'Gestor',
        instructions: ['Avaliar competencias comportamentais alinhadas com os valores da Tlantic.', 'Usar a matriz por nivel para justificar avaliacao.'],
      },
      {
        title: 'Secao 4 - Objetivos e KPIs 2026',
        responsible: 'Colaborador (proposta inicial) + Gestor (validacao final)',
        instructions: ['Definir KPIs claros, mensuraveis e ligados as responsabilidades da funcao.', 'Validar em reuniao 1:1 entre colaborador e lideranca.'],
      },
      {
        title: 'Secao 5 - Reflexao sobre a Lideranca',
        responsible: 'Colaborador',
        instructions: ['Registar feedback estruturado sobre lideranca.', 'Promover cultura de dialogo, confianca e desenvolvimento continuo.'],
      },
      {
        title: 'Secao 6 - O proximo ciclo',
        responsible: 'Gestor',
        instructions: ['Avaliar desempenho global do colaborador no ciclo.', 'Registar recomendacoes e foco de desenvolvimento.'],
      },
      {
        title: 'Secao 7 - Objetivos e KPIs para 2027',
        responsible: 'Colaborador (proposta inicial) + Gestor (validacao final)',
        instructions: ['Definicao preliminar de objetivos e KPIs do ciclo seguinte.', 'Garantir coerencia com funcao, nivel e metas da area.'],
      },
    ],
    evaluationStages: [
      {
        stage: 'Etapa Colaborador',
        items: ['Propoe objetivos e KPIs do ciclo.', 'Regista reflexao de ciclo anterior com evidencias.', 'Partilha feedback sobre lideranca.'],
      },
      {
        stage: 'Etapa Lideranca',
        items: ['Reve, ajusta e valida KPIs em conjunto com colaborador.', 'Avalia competencias comportamentais com base na matriz oficial.', 'Consolida avaliacao global e orientacoes para o proximo ciclo.'],
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
