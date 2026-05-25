import { prisma } from './prisma.js';

const prismaClient: any = prisma;

type CompetencyExpectationRow = {
  organizationValue: string;
  competency: string;
  hierarchyLevel: string;
  expectedBehavior: string;
};

const DEFAULT_EXPECTATIONS: CompetencyExpectationRow[] = [
  { organizationValue: 'Agilidade Criativa', competency: 'Inovação e adaptação', hierarchyLevel: 'Trainee', expectedBehavior: 'Aprende rapidamente, adapta-se a novas rotinas e executa atividades com orientação constante, demonstrando curiosidade e abertura a novas ideias.' },
  { organizationValue: 'Agilidade Criativa', competency: 'Inovação e adaptação', hierarchyLevel: 'Junior', expectedBehavior: 'Executa atividades com autonomia inicial, adapta-se a mudanças e aplica aprendizados no dia a dia.' },
  { organizationValue: 'Agilidade Criativa', competency: 'Inovação e adaptação', hierarchyLevel: 'Associate', expectedBehavior: 'Identifica melhorias no trabalho, adapta-se com autonomia e contribui com soluções práticas.' },
  { organizationValue: 'Agilidade Criativa', competency: 'Inovação e adaptação', hierarchyLevel: 'Senior', expectedBehavior: 'Propõe soluções inovadoras, antecipa riscos e adapta processos com pensamento crítico.' },
  { organizationValue: 'Agilidade Criativa', competency: 'Inovação e adaptação', hierarchyLevel: 'Lead', expectedBehavior: 'Estimula inovação no time, conduz mudanças e desenvolve pensamento crítico coletivo.' },
  { organizationValue: 'Agilidade Criativa', competency: 'Inovação e adaptação', hierarchyLevel: 'Principal', expectedBehavior: 'Influencia decisões estratégicas e lidera transformações organizacionais com visão inovadora.' },

  { organizationValue: 'Espirito de equipa', competency: 'Colaboração, comunicação e trabalho em equipa', hierarchyLevel: 'Trainee', expectedBehavior: 'Colabora com a equipa, comunica-se com respeito e segue orientações.' },
  { organizationValue: 'Espirito de equipa', competency: 'Colaboração, comunicação e trabalho em equipa', hierarchyLevel: 'Junior', expectedBehavior: 'Colabora de forma consistente e mantém comunicação clara no dia a dia.' },
  { organizationValue: 'Espirito de equipa', competency: 'Colaboração, comunicação e trabalho em equipa', hierarchyLevel: 'Associate', expectedBehavior: 'Colabora ativamente, compartilha conhecimento e apoia colegas.' },
  { organizationValue: 'Espirito de equipa', competency: 'Colaboração, comunicação e trabalho em equipa', hierarchyLevel: 'Senior', expectedBehavior: 'Atua como referência, promove cooperação e alinhamento entre pares.' },
  { organizationValue: 'Espirito de equipa', competency: 'Colaboração, comunicação e trabalho em equipa', hierarchyLevel: 'Lead', expectedBehavior: 'Desenvolve o time, facilita diálogos e fortalece a confiança da equipa.' },
  { organizationValue: 'Espirito de equipa', competency: 'Colaboração, comunicação e trabalho em equipa', hierarchyLevel: 'Principal', expectedBehavior: 'Cria ambientes colaborativos e influencia a cultura de trabalho em equipa.' },

  { organizationValue: 'Flexibilidade', competency: 'Adaptabilidade e gestão equilibrada do trabalho', hierarchyLevel: 'Trainee', expectedBehavior: 'Adapta-se à rotina, respeita acordos e aprende a gerir prioridades.' },
  { organizationValue: 'Flexibilidade', competency: 'Adaptabilidade e gestão equilibrada do trabalho', hierarchyLevel: 'Junior', expectedBehavior: 'Ajusta-se a mudanças e organiza o trabalho com orientação.' },
  { organizationValue: 'Flexibilidade', competency: 'Adaptabilidade e gestão equilibrada do trabalho', hierarchyLevel: 'Associate', expectedBehavior: 'Gerencia demandas com autonomia e mantém equilíbrio nas entregas.' },
  { organizationValue: 'Flexibilidade', competency: 'Adaptabilidade e gestão equilibrada do trabalho', hierarchyLevel: 'Senior', expectedBehavior: 'Ajusta prioridades, apoia o time e mantém consistência nas entregas.' },
  { organizationValue: 'Flexibilidade', competency: 'Adaptabilidade e gestão equilibrada do trabalho', hierarchyLevel: 'Lead', expectedBehavior: 'Promove flexibilidade saudável e equilibra demandas e pessoas.' },
  { organizationValue: 'Flexibilidade', competency: 'Adaptabilidade e gestão equilibrada do trabalho', hierarchyLevel: 'Principal', expectedBehavior: 'Define diretrizes que sustentam ambientes flexíveis e sustentáveis.' },

  { organizationValue: 'Integridade e Respeito', competency: 'Ética, respeito e responsabilidade profissional', hierarchyLevel: 'Trainee', expectedBehavior: 'Atua com respeito, segue normas e recebe orientações.' },
  { organizationValue: 'Integridade e Respeito', competency: 'Ética, respeito e responsabilidade profissional', hierarchyLevel: 'Junior', expectedBehavior: 'Demonstra postura ética e responsabilidade no dia a dia.' },
  { organizationValue: 'Integridade e Respeito', competency: 'Ética, respeito e responsabilidade profissional', hierarchyLevel: 'Associate', expectedBehavior: 'Mantém conduta ética consistente e respeitosa.' },
  { organizationValue: 'Integridade e Respeito', competency: 'Ética, respeito e responsabilidade profissional', hierarchyLevel: 'Senior', expectedBehavior: 'Atua como exemplo de ética e respeito, mesmo sob pressão.' },
  { organizationValue: 'Integridade e Respeito', competency: 'Ética, respeito e responsabilidade profissional', hierarchyLevel: 'Lead', expectedBehavior: 'Garante práticas éticas no time e trata conflitos com maturidade.' },
  { organizationValue: 'Integridade e Respeito', competency: 'Ética, respeito e responsabilidade profissional', hierarchyLevel: 'Principal', expectedBehavior: 'É referência ética e influencia decisões críticas da organização.' },

  { organizationValue: 'Valorização das Pessoas', competency: 'Desenvolvimento, aprendizado e apoio ao crescimento', hierarchyLevel: 'Trainee', expectedBehavior: 'Demonstra abertura ao aprendizado e busca evoluir continuamente.' },
  { organizationValue: 'Valorização das Pessoas', competency: 'Desenvolvimento, aprendizado e apoio ao crescimento', hierarchyLevel: 'Junior', expectedBehavior: 'Aplica feedbacks e investe no próprio desenvolvimento.' },
  { organizationValue: 'Valorização das Pessoas', competency: 'Desenvolvimento, aprendizado e apoio ao crescimento', hierarchyLevel: 'Associate', expectedBehavior: 'Busca desenvolvimento contínuo e compartilha aprendizados.' },
  { organizationValue: 'Valorização das Pessoas', competency: 'Desenvolvimento, aprendizado e apoio ao crescimento', hierarchyLevel: 'Senior', expectedBehavior: 'Apoia o desenvolvimento de colegas e compartilha conhecimento.' },
  { organizationValue: 'Valorização das Pessoas', competency: 'Desenvolvimento, aprendizado e apoio ao crescimento', hierarchyLevel: 'Lead', expectedBehavior: 'Desenvolve pessoas, dá feedbacks estruturados e forma talentos.' },
  { organizationValue: 'Valorização das Pessoas', competency: 'Desenvolvimento, aprendizado e apoio ao crescimento', hierarchyLevel: 'Principal', expectedBehavior: 'Promove cultura de desenvolvimento e crescimento sustentável.' },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeHierarchyLevel(input: string): string {
  const normalized = normalizeText(input);

  if (!normalized) return 'Associate';
  if (normalized.includes('trainee') || normalized.includes('estagi')) return 'Trainee';
  if (normalized.includes('junior')) return 'Junior';
  if (normalized.includes('associate') || normalized.includes('pleno')) return 'Associate';
  if (normalized.includes('senior')) return 'Senior';
  if (normalized.includes('lead') || normalized.includes('lider') || normalized.includes('coordenador') || normalized.includes('manager')) return 'Lead';
  if (normalized.includes('principal') || normalized.includes('especialista') || normalized.includes('staff')) return 'Principal';

  return 'Associate';
}

function mapToResponse(rows: Array<{ organizationValue: string; competency: string; expectedBehavior: string }>) {
  return rows.map((c) => ({
    organizationValue: c.organizationValue,
    competency: c.competency,
    description: c.expectedBehavior,
    rating: null,
  }));
}

export async function getBehavioralCompetenciesByLevel(hierarchyLevel: string) {
  const normalizedLevel = normalizeHierarchyLevel(hierarchyLevel);
  const queryLevels = Array.from(new Set([hierarchyLevel.trim(), normalizedLevel].filter(Boolean)));

  const competencies = await prismaClient.behavioralCompetencyExpectation.findMany({
    where: {
      hierarchyLevel: {
        in: queryLevels,
      },
    },
    orderBy: [
      { organizationValue: 'asc' },
      { competency: 'asc' },
    ],
  });

  if (competencies.length > 0) {
    return mapToResponse(competencies);
  }

  const fallbackRows = DEFAULT_EXPECTATIONS.filter((item) => item.hierarchyLevel === normalizedLevel)
    .sort((a, b) => a.organizationValue.localeCompare(b.organizationValue));

  return mapToResponse(fallbackRows);
}

export async function getAllHierarchyLevels() {
  const levels = await prismaClient.behavioralCompetencyExpectation.findMany({
    select: {
      hierarchyLevel: true,
    },
    distinct: ['hierarchyLevel'],
    orderBy: {
      hierarchyLevel: 'asc',
    },
  });

  return levels.map((l: { hierarchyLevel: string }) => l.hierarchyLevel);
}

export async function getLeadershipReflectionQuestions() {
  return prismaClient.leadershipReflectionQuestion.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      order: 'asc',
    },
  });
}
