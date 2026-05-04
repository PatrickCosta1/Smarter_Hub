export const CAREER_LEVELS = ['Trainee', 'Junior', 'Associate', 'Senior', 'Lead', 'Principal', 'Director', 'C Level'] as const;

type CareerLevel = (typeof CAREER_LEVELS)[number];

type CareerFamily = {
  id: string;
  label: string;
  summary: string;
  coreSkills: string[];
  expectedBehaviors: string[];
  nextStepFocus: string[];
  roles: string[];
};

export type CareerStep = {
  level: CareerLevel;
  title: string;
  expectations: string[];
  signals: string[];
};

export type EvaluationSection = {
  title: string;
  responsible: string;
  instructions: string[];
};

export type EvaluationStage = {
  stage: string;
  items: string[];
};

export type CareerPlanView = {
  roleLabel: string;
  family: CareerFamily;
  currentStep: CareerStep;
  nextSteps: CareerStep[];
  ninetyDayPlan: string[];
  evaluationSections: EvaluationSection[];
  evaluationStages: EvaluationStage[];
};

const FAMILIES: CareerFamily[] = [
  {
    id: 'sales',
    label: 'Sales & Pre-Sales',
    summary: 'Gerar novas vendas sustentáveis, articular equipas e cumprir KPIs comerciais.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Meritocracia e transparência', 'Equidade entre geografias e equipas', 'Alinhamento com práticas de mercado'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['Sales Director', 'Sales Manager', 'Sales Consultant', 'Pre-Sales Manager', 'Pre-Sales Consultant'],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    summary: 'Entregar resultados com qualidade, prazo, margem e satisfação do cliente.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Responsabilidade por qualidade de entrega', 'Cumprimento de SLAs e orçamento', 'Coordenação e motivação de equipas'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['Delivery Director', 'Delivery Manager', 'Project Manager', 'Business Consultant', 'Technical Consultant'],
  },
  {
    id: 'product',
    label: 'Product',
    summary: 'Definir estratégia de produto e experiência de cliente alinhadas com metas de negócio.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Gestão clara de roadmap e backlog', 'Priorização por impacto', 'Longevidade tecnológica do produto'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['Product Director', 'Product Manager', 'Product Owner', 'Business Analyst', 'Product Architect', 'Software Engineer', 'Software Developer'],
  },
  {
    id: 'services',
    label: 'Services',
    summary: 'Gerir e evoluir serviços de TI, suporte e operações com melhoria contínua.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Confiabilidade operacional', 'Suporte técnico consistente', 'Cultura DevOps e CI/CD'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['Service Director', 'Service Manager', 'Service Engineer', 'Service Analyst', 'DevOps Manager', 'DevOps Engineer'],
  },
  {
    id: 'operations-control',
    label: 'Operations & Control',
    summary: 'Assegurar controlo financeiro, eficiência operacional e suporte à decisão.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Rigor analítico e financeiro', 'Suporte à decisão estratégica', 'Controlo interno e eficiência'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['Operations & Control Director', 'Operations & Control Manager', 'Business Controller'],
  },
  {
    id: 'pessoas',
    label: 'People',
    summary: 'Definir e executar estratégia de RH com equidade, cultura e desenvolvimento de talento.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Aplicação uniforme de políticas', 'Desenvolvimento contínuo de pessoas', 'Apoio às lideranças e equipas'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['People Director', 'People Manager', 'People Partner', 'Administrative Assistant'],
  },
  {
    id: 'communication',
    label: 'Communication',
    summary: 'Definir e executar o plano de comunicação alinhado com objetivos organizacionais.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Clareza de comunicação', 'Coordenação entre áreas', 'Execução disciplinada do plano'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: ['Communication Director', 'Communication Manager', 'Communication Specialist'],
  },
  {
    id: 'geral',
    label: 'Plano Geral',
    summary: 'Evolução por níveis com critérios claros de autonomia, gestão de pessoas e atuação operacional/estratégica.',
    coreSkills: ['Inovação e adaptação', 'Colaboração', 'Adaptabilidade', 'Ética profissional', 'Desenvolvimento'],
    expectedBehaviors: ['Meritocracia e transparência', 'Equidade entre equipas', 'Simplicidade hierárquica'],
    nextStepFocus: ['Avaliação de desempenho anual (mérito)', 'Potencial', 'Vaga interna (oportunidade interna)'],
    roles: [],
  },
];

const TITLES_BY_LEVEL: Record<CareerLevel, string> = {
  Trainee: 'Entrada e aprendizagem estruturada',
  Junior: 'Execução operacional com supervisão próxima',
  Associate: 'Execução com autonomia e foco em resultados',
  Senior: 'Domínio técnico e coordenação de pequena equipa',
  Lead: 'Coordenação operacional e gestão de equipa direta',
  Principal: 'Gestão ampla da unidade e orçamento',
  Director: 'Direção de área com visão transversal',
  'C Level': 'Direção estratégica do pelouro',
};

const LEVEL_EXPECTATIONS: Record<CareerLevel, string[]> = {
  'C Level': [
    'Colaboradores neste nível são profissionais muito experientes na sua área de atuação.',
    'Tem ampla latitude de tomada de decisão dentro de suas unidades funcionais.',
    'Tem autonomia na gestão transversal da equipa (contratação, demissão, promoção, migração de área).',
    'Fornece orientação estratégica às unidades sob seu controlo.',
  ],
  Director: [
    'Colaboradores neste nível possuem uma visão transversal da organização.',
    'Possuem total autonomia na gestão da sua equipa e orçamento dentro das normas definidas.',
    'Define os planos operacionais e estratégicos para a sua unidade.',
    'Tem responsabilidade pela definição, execução e controlo do orçamento da sua unidade.',
  ],
  Principal: [
    'É o substituto natural do director a que reporta.',
    'Possuem autonomia na gestão da sua equipa e orçamento dentro das normas definidas.',
    'Faz gestão de equipas e do desenvolvimento do potencial e âmbito de atuação da equipa.',
    'Define e controla objetivos operacionais de médio prazo alinhados com os objetivos da unidade.',
  ],
  Lead: [
    'Possui total domínio dos procedimentos e sistemas usados.',
    'Trabalha para objetivos específicos que requerem planeamento operacional sem supervisão.',
    'Tem autonomia na gestão da sua equipa e orçamento dentro das normas definidas.',
    'Define e controla objetivos operacionais de médio prazo para desenvolvimento em equipa.',
  ],
  Senior: [
    'Possui total domínio dos procedimentos e sistemas usados.',
    'Trabalha para objetivos específicos com reduzida supervisão.',
    'Faz gestão de pequenas equipas (1 a 3 elementos) e desenvolvimento de recursos diretos.',
    'Controla objetivos operacionais de médio prazo para desenvolvimento individual/equipa.',
  ],
  Associate: [
    'Demonstra experiência e segurança na execução de procedimentos e sistemas.',
    'Possui autonomia para tomada de decisões com base em procedimentos definidos.',
    'Não é esperada a gestão de pessoas, podendo acompanhar colaboradores mais juniores.',
    'Tem objetivos operacionais de curto/médio prazo dentro dos objetivos da equipa.',
  ],
  Junior: [
    'Segue rotinas de trabalho padrão e desenvolve atividades com supervisão muito próxima.',
    'Possui pouca capacidade de autonomia e decisão, obrigando a supervisão próxima.',
    'Não gere pessoas/equipas.',
    'Tem objetivos puramente operacionais e de curto prazo para desenvolvimento individual.',
  ],
  Trainee: [
    'Possui um objetivo concreto e bem definido para o período de estágio.',
    'Requer supervisão muito próxima para garantir o cumprimento do objetivo de estágio.',
    'Foco em avaliação de potencial e aprendizagem acelerada.',
  ],
};

const BEHAVIOR_MATRIX: Record<CareerLevel, string[]> = {
  'C Level': [
    'Fornece orientação estratégica às unidades sob seu controlo.',
    'Define objetivos e orçamentos de médio e longo prazo para a equipa.',
    'Tem autonomia na gestão transversal da equipa (contratação, demissão e promoção).',
    'Tomada de decisão com visão transversal de recursos no pelouro.',
    'Patrocina desenvolvimento de líderes e sucessão organizacional.',
  ],
  Director: [
    'Define planos operacionais e estratégicos para a unidade.',
    'Tem autonomia na gestão de equipa e orçamento dentro das normas definidas.',
    'Apoia subordinados na gestão corrente operacional e da equipa.',
    'Responsável pela execução e controlo do orçamento da unidade.',
    'Garante desenvolvimento dos recursos diretos e indiretos da área.',
  ],
  Trainee: [
    'Aprende rapidamente, adapta-se a novas rotinas e executa atividades com orientação constante.',
    'Colabora com a equipa, comunica-se com respeito e segue orientações.',
    'Adapta-se à rotina, respeita acordos e aprende a gerir prioridades.',
    'Atua com respeito, segue normas e recebe orientações.',
    'Demonstra abertura ao aprendizado e busca evoluir continuamente.',
  ],
  Junior: [
    'Executa atividades com autonomia inicial, adapta-se a mudanças e aplica aprendizados no dia a dia.',
    'Colabora de forma consistente e mantém comunicação clara no dia a dia.',
    'Ajusta-se a mudanças e organiza o trabalho com orientação.',
    'Demonstra postura ética e responsabilidade no dia a dia.',
    'Aplica feedbacks e investe no próprio desenvolvimento.',
  ],
  Associate: [
    'Identifica melhorias no trabalho, adapta-se com autonomia e contribui com soluções práticas.',
    'Colabora ativamente, partilha conhecimento e apoia colegas.',
    'Gerencia demandas com autonomia e mantém equilíbrio nas entregas.',
    'Mantém conduta ética consistente e respeitosa.',
    'Busca desenvolvimento contínuo e partilha aprendizados.',
  ],
  Senior: [
    'Propõe soluções inovadoras, antecipa riscos e adapta processos com pensamento crítico.',
    'Atua como referência, promove cooperação e alinhamento entre pares.',
    'Ajusta prioridades, apoia o time e mantém consistência nas entregas.',
    'Atua como exemplo de ética e respeito, mesmo sob pressão.',
    'Apoia o desenvolvimento de colegas e partilha conhecimento.',
  ],
  Lead: [
    'Estimula inovação no time, conduz mudanças e desenvolve pensamento crítico coletivo.',
    'Desenvolve o time, facilita diálogos e fortalece a confiança da equipa.',
    'Promove flexibilidade saudável e equilibra demandas e pessoas.',
    'Garante práticas éticas no time e trata conflitos com maturidade.',
    'Desenvolve pessoas, dá feedbacks estruturados e forma talentos.',
  ],
  Principal: [
    'Influencia decisões estratégicas e lidera transformações organizacionais com visão inovadora.',
    'Cria ambientes colaborativos e influencia a cultura de trabalho em equipa.',
    'Define diretrizes que sustentam ambientes flexíveis e sustentáveis.',
    'É referência ética e influencia decisões críticas da organização.',
    'Promove cultura de desenvolvimento e crescimento sustentável.',
  ],
};

const EVALUATION_SECTIONS: EvaluationSection[] = [
  {
    title: 'Secção 1 – Identificação do Colaborador',
    responsible: 'Gestor',
    instructions: [
      'Confirmar os dados do colaborador.',
      'Preencher o campo Avaliador e a data da avaliação.',
    ],
  },
  {
    title: 'Secção 2 – Ciclo Anterior: reflexão',
    responsible: 'Colaborador (Parte A) e Gestor (Parte B)',
    instructions: [
      'Destacar principais entregas e resultados com exemplos concretos.',
      'Evitar descrições vagas; manter objetividade e transparência.',
    ],
  },
  {
    title: 'Secção 3 – Competências Comportamentais',
    responsible: 'Gestor',
    instructions: [
      'Avaliar competências comportamentais alinhadas com os valores da Tlantic.',
      'Usar a matriz por nível para justificar avaliação.',
    ],
  },
  {
    title: 'Secção 4 – Objetivos e KPIs 2026',
    responsible: 'Colaborador (proposta inicial) + Gestor (validação final)',
    instructions: [
      'Definir KPIs claros, mensuráveis e ligados às responsabilidades da função.',
      'Validar em reunião 1:1 entre colaborador e liderança.',
    ],
  },
  {
    title: 'Secção 5 – Reflexão sobre a Liderança',
    responsible: 'Colaborador',
    instructions: [
      'Registar feedback estruturado sobre liderança.',
      'Promover cultura de diálogo, confiança e desenvolvimento contínuo.',
    ],
  },
  {
    title: 'Secção 6 – O próximo ciclo',
    responsible: 'Gestor',
    instructions: [
      'Avaliar desempenho global do colaborador no ciclo.',
      'Registar recomendações e foco de desenvolvimento.',
    ],
  },
  {
    title: 'Secção 7 – Objetivos e KPIs para 2027',
    responsible: 'Colaborador (proposta inicial) + Gestor (validação final)',
    instructions: [
      'Definição preliminar de objetivos e KPIs do ciclo seguinte.',
      'Garantir coerência com função, nível e metas da área.',
    ],
  },
];

const EVALUATION_STAGES: EvaluationStage[] = [
  {
    stage: 'Etapa Colaborador',
    items: [
      'Propõe objetivos e KPIs do ciclo.',
      'Regista reflexão de ciclo anterior com evidências.',
      'Partilha feedback sobre liderança.',
    ],
  },
  {
    stage: 'Etapa Liderança',
    items: [
      'Revê, ajusta e valida KPIs em conjunto com colaborador.',
      'Avalia competências comportamentais com base na matriz oficial.',
      'Consolida avaliação global e orientações para o próximo ciclo.',
    ],
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveFamily(funcao: string): CareerFamily {
  const value = normalize(funcao);

  if (!value) return FAMILIES.find((f) => f.id === 'geral')!;
  if (/(sales|pre-sales|pre sales|comercial|business development)/.test(value)) return FAMILIES.find((f) => f.id === 'sales')!;
  if (/(delivery|project manager|technical consultant|business consultant)/.test(value)) return FAMILIES.find((f) => f.id === 'delivery')!;
  if (/(product|owner|scrum|architect|software|developer|engineer|qa|quality|data)/.test(value)) return FAMILIES.find((f) => f.id === 'product')!;
  if (/(service|devops|support)/.test(value)) return FAMILIES.find((f) => f.id === 'services')!;
  if (/(operations|control|controller|finance|financial)/.test(value)) return FAMILIES.find((f) => f.id === 'operations-control')!;
  if (/(people|rh|human|partner|administrative)/.test(value)) return FAMILIES.find((f) => f.id === 'pessoas')!;
  if (/(communication|marketing|comunicacao|comunica)/.test(value)) return FAMILIES.find((f) => f.id === 'communication')!;

  return FAMILIES.find((f) => f.id === 'geral')!;
}

function resolveLevelIndex(cargo: string): number {
  const value = normalize(cargo);
  if (!value) return 2;

  const exact = CAREER_LEVELS.findIndex((level) => normalize(level) === value);
  if (exact >= 0) return exact;

  const partial = CAREER_LEVELS.findIndex((level) => value.includes(normalize(level)) || normalize(level).includes(value));
  if (partial >= 0) return partial;

  return 2;
}

function buildStep(level: CareerLevel, family: CareerFamily): CareerStep {
  const expectations = LEVEL_EXPECTATIONS[level];

  const signals = [
    ...BEHAVIOR_MATRIX[level].slice(0, 3),
    `Aplica os critérios de progressão do eixo hierárquico no nível ${level}.`,
  ];

  return {
    level,
    title: TITLES_BY_LEVEL[level],
    expectations,
    signals,
  };
}

export function resolveCareerPlan(cargo: string, funcao: string): CareerPlanView {
  const family = resolveFamily(funcao);
  const levelIndex = resolveLevelIndex(cargo);
  const currentLevel = CAREER_LEVELS[levelIndex];
  const nextLevels = CAREER_LEVELS.slice(levelIndex + 1, levelIndex + 3);

  return {
    roleLabel: `${cargo || 'Nível por definir'} • ${funcao || 'Função por definir'}`,
    family,
    currentStep: buildStep(currentLevel, family),
    nextSteps: nextLevels.map((level) => buildStep(level, family)),
    ninetyDayPlan: [
      '30 dias: definir objetivos e KPIs em conjunto (Secção 4).',
      '60 dias: acompanhar execução em 1:1 e ajustar prioridades.',
      '90 dias: consolidar evidências para avaliação global e próximo ciclo.',
    ],
    evaluationSections: EVALUATION_SECTIONS,
    evaluationStages: EVALUATION_STAGES,
  };
}
