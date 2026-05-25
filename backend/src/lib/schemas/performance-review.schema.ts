import { z } from 'zod';

// ================== Enums ==================
export const performanceReviewSectionTypeSchema = z.enum([
  'REFLECTION_PREVIOUS_CYCLE',
  'BEHAVIORAL_COMPETENCIES',
  'OBJECTIVES_KPIS_CURRENT_YEAR',
  'LEADERSHIP_REFLECTION',
  'NEXT_CYCLE_REFLECTION',
  'OBJECTIVES_KPIS_NEXT_YEAR',
]);

export const performanceReviewSubmissionStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'AWAITING_RESPONSE',
  'REVISED',
  'ACCEPTED',
  'CLOSED',
]);

export const performanceReviewCollaboratorTypeSchema = z.enum([
  'SELF',
  'MANAGER',
]);

// ================== Ciclo Anterior: Reflexão ==================
export const reflectionPreviousCycleContentSchema = z.object({
  mainDeliveries: z.string().min(1, 'Principais entregas é obrigatório.'),
  mainChallenges: z.string().min(1, 'Principais desafios é obrigatório.'),
  pointsToDevelop: z.string().min(1, 'Pontos a desenvolver é obrigatório.'),
});

export type ReflectionPreviousCycleContent = z.infer<typeof reflectionPreviousCycleContentSchema>;

// ================== Competências Comportamentais ==================
export const behavioralCompetencyRowSchema = z.object({
  organizationValue: z.string().min(1),
  competency: z.string().min(1),
  description: z.string(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

export const behavioralCompetenciesContentSchema = z.object({
  ratings: z.array(behavioralCompetencyRowSchema),
});

export type BehavioralCompetencyRow = z.infer<typeof behavioralCompetencyRowSchema>;
export type BehavioralCompetenciesContent = z.infer<typeof behavioralCompetenciesContentSchema>;

// ================== Objetivos e KPIs ==================
export const kpiRowSchema = z.object({
  individual: z.string().min(1, 'Individual é obrigatório.'),
  unit: z.string().optional(),
  weight: z.number().min(0).max(100).nullable().optional(),
  objectiveMin: z.number().nullable().optional(),
  objectiveValue: z.number().nullable().optional(),
  objectiveMax: z.number().nullable().optional(),
  result: z.number().nullable().optional(),
  realization: z.number().nullable().optional(),
  adjusted: z.number().nullable().optional(),
  evaluation: z.number().nullable().optional(),
  comments: z.string().optional(),
});

export const objectivesKpisContentSchema = z.object({
  year: z.number().int(),
  phase: z.enum(['DEFINITION', 'REEVALUATION', 'RESULTS']).optional(),
  kpis: z.array(kpiRowSchema),
});

export type KpiRow = z.infer<typeof kpiRowSchema>;
export type ObjectivesKpisContent = z.infer<typeof objectivesKpisContentSchema>;

// ================== Reflexão sobre Liderança ==================
export const leadershipReflectionAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1, 'Resposta é obrigatória.'),
});

export const leadershipReflectionContentSchema = z.object({
  answers: z.array(leadershipReflectionAnswerSchema).min(1),
});

export type LeadershipReflectionAnswer = z.infer<typeof leadershipReflectionAnswerSchema>;
export type LeadershipReflectionContent = z.infer<typeof leadershipReflectionContentSchema>;

// ================== Próximo Ciclo ==================
export const nextCycleContentSchema = z.object({
  areasOfInterest: z.string().min(1, 'Áreas de interesse é obrigatório.'),
  possibleNextRole: z.string().min(1, 'Possível próxima função é obrigatório.'),
  potentialBackups: z.array(z.string()).optional(),
  identifiedNeeds: z.string().min(1, 'Necessidades identificadas é obrigatório.'),
  trainingOrInitiativesSuggestion: z.string().optional(),
  recommendedPeriod: z.string().optional(),
});

export type NextCycleContent = z.infer<typeof nextCycleContentSchema>;

// ================== Submissão ==================
export const performanceReviewSubmissionCreateSchema = z.object({
  sectionType: performanceReviewSectionTypeSchema,
  collaboratorType: performanceReviewCollaboratorTypeSchema,
  cycleId: z.string().min(1),
  userId: z.string().min(1),
  content: z.record(z.string(), z.unknown()),
});

export const performanceReviewSubmissionUpdateSchema = z.object({
  content: z.record(z.string(), z.unknown()).optional(),
  status: performanceReviewSubmissionStatusSchema.optional(),
  proposedEdits: z.record(z.string(), z.unknown()).optional(),
  rejectionReason: z.string().optional(),
});

export const performanceReviewSubmissionProposalSchema = z.object({
  proposedEdits: z.record(z.string(), z.unknown()),
});

export type PerformanceReviewSubmissionCreate = z.infer<typeof performanceReviewSubmissionCreateSchema>;
export type PerformanceReviewSubmissionUpdate = z.infer<typeof performanceReviewSubmissionUpdateSchema>;
export type PerformanceReviewSubmissionProposal = z.infer<typeof performanceReviewSubmissionProposalSchema>;

// ================== Ciclo ==================
export const performanceReviewCycleCreateSchema = z.object({
  cycleIdentifier: z.string().min(1, 'Identificador do ciclo é obrigatório.'),
});

export type PerformanceReviewCycleCreate = z.infer<typeof performanceReviewCycleCreateSchema>;
