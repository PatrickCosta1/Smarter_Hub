import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  performanceReviewSectionTypeSchema,
  performanceReviewCollaboratorTypeSchema,
  performanceReviewCycleCreateSchema,
  performanceReviewSubmissionCreateSchema,
  performanceReviewSubmissionUpdateSchema,
  performanceReviewSubmissionProposalSchema,
  reflectionPreviousCycleContentSchema,
  behavioralCompetenciesContentSchema,
  objectivesKpisContentSchema,
  leadershipReflectionContentSchema,
  nextCycleContentSchema,
} from '../lib/schemas/performance-review.schema.js';
import {
  findOrCreatePerformanceReviewCycle,
  getPerformanceReviewSubmission,
  createPerformanceReviewSubmission,
  updatePerformanceReviewSubmission,
  submitPerformanceReviewSubmission,
  proposeEditsToSubmission,
  acceptProposedEdits,
  rejectProposedEdits,
  acceptSubmission,
  getPerformanceReviewSubmissionHistory,
  getSubmissionsByUserAndCycle,
} from '../lib/performance-review.service.js';
import {
  getBehavioralCompetenciesByLevel,
  getLeadershipReflectionQuestions,
} from '../lib/behavioral-competencies.service.js';
import { canAccessUserByPermission, hasPermission } from '../lib/permission-engine.js';
import { prisma } from '../lib/prisma.js';

const router = Router();
const CURRENT_REVIEW_CYCLE_IDENTIFIER = `APR-${new Date().getFullYear()}`;

const submissionCreateWithoutCycleSchema = z.object({
  sectionType: performanceReviewSectionTypeSchema,
  collaboratorType: performanceReviewCollaboratorTypeSchema,
  userId: z.string().min(1),
  content: z.record(z.string(), z.unknown()),
});

const performanceReviewBatchSubmitSchema = z.object({
  userId: z.string().min(1),
  submissionIds: z.array(z.string().min(1)).min(1),
});

async function resolveCurrentCycle() {
  return findOrCreatePerformanceReviewCycle(CURRENT_REVIEW_CYCLE_IDENTIFIER);
}

async function canAccessPerformanceReviewTarget(
  actor: NonNullable<Express.Request['authUser']>,
  targetUserId: string,
) {
  if (actor.id === targetUserId) {
    return true;
  }

  if (actor.isRootAccess || actor.hasAccessTotal) {
    return true;
  }

  const [canManageTarget, canViewTarget] = await Promise.all([
    canAccessUserByPermission(actor.id, 'manage_performance_reviews', targetUserId),
    canAccessUserByPermission(actor.id, 'view_user_list', targetUserId),
  ]);

  if (canManageTarget || canViewTarget) {
    return true;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      team: {
        select: {
          managerId: true,
          coordinatorId: true,
        },
      },
      teamMemberships: {
        where: { isActive: true },
        select: {
          team: {
            select: {
              managerId: true,
              coordinatorId: true,
            },
          },
        },
      },
    },
  });

  if (target?.team?.managerId === actor.id || target?.team?.coordinatorId === actor.id) {
    return true;
  }

  return (target?.teamMemberships ?? []).some((membership) => (
    membership.team?.managerId === actor.id || membership.team?.coordinatorId === actor.id
  ));
}

// ================== GET /performance-review/current-cycle ==================
router.get('/performance-review/current-cycle', requireAuth, async (_req, res) => {
  const cycle = await resolveCurrentCycle();
  return res.json(cycle);
});

// ================== GET /performance-review/submissions/:userId ==================
router.get('/performance-review/submissions/:userId', requireAuth, async (req, res) => {
  const userId = String(req.params.userId || '');

  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para aceder a esta avaliação.' });
  }

  const cycle = await resolveCurrentCycle();
  const submissions = await getSubmissionsByUserAndCycle(userId, cycle.id);
  return res.json(submissions);
});

// ================== GET /performance-review/submissions/:userId/history ==================
router.get('/performance-review/submissions/:userId/history', requireAuth, async (req, res) => {
  const userId = String(req.params.userId || '');

  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para aceder ao histórico de avaliação.' });
  }

  const cycle = await resolveCurrentCycle();
  const history = await getPerformanceReviewSubmissionHistory(userId, cycle.id);
  return res.json(history);
});

// ================== POST /performance-review/submissions ==================
router.post('/performance-review/submissions', requireAuth, async (req, res) => {
  const payload = submissionCreateWithoutCycleSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const userId = payload.data.userId;
  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para criar submissões de avaliação.' });
  }

  const cycle = await resolveCurrentCycle();
  const existing = await getPerformanceReviewSubmission(
    userId,
    cycle.id,
    payload.data.sectionType,
    payload.data.collaboratorType,
  );

  if (existing) {
    return res.status(409).json({ message: 'Submissão já existe para esta secção.' });
  }

  const submission = await createPerformanceReviewSubmission({
    ...payload.data,
    cycleId: cycle.id,
    actorUserId: req.authUser!.id,
  });

  return res.status(201).json(submission);
});

// ================== GET /performance-review/cycles/:cycleId ==================
router.get('/performance-review/cycles/:cycleId', requireAuth, async (req, res) => {
  const cycleId = String(req.params.cycleId || '');

  const cycle = await prisma.performanceReviewCycle.findUnique({
    where: { id: cycleId },
  });

  if (!cycle) {
    return res.status(404).json({ message: 'Ciclo de avaliação não encontrado.' });
  }

  return res.json(cycle);
});

// ================== POST /performance-review/cycles ==================
router.post('/performance-review/cycles', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_performance_reviews')) {
    return res.status(403).json({ message: 'Sem permissões para criar ciclos de avaliação.' });
  }

  const payload = performanceReviewCycleCreateSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const cycle = await findOrCreatePerformanceReviewCycle(payload.data.cycleIdentifier);

  return res.status(201).json(cycle);
});

// ================== GET /performance-review/:cycleId/submissions/:userId ==================
router.get('/performance-review/:cycleId/submissions/:userId', requireAuth, async (req, res) => {
  const cycleId = String(req.params.cycleId || '');
  const userId = String(req.params.userId || '');

  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para aceder a esta avaliação.' });
  }

  const submissions = await getSubmissionsByUserAndCycle(userId, cycleId);

  return res.json(submissions);
});

// ================== POST /performance-review/:cycleId/submissions ==================
router.post('/performance-review/:cycleId/submissions', requireAuth, async (req, res) => {
  const cycleId = String(req.params.cycleId || '');

  const payload = performanceReviewSubmissionCreateSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const userId = payload.data.userId;

  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para criar submissões de avaliação.' });
  }

  const existing = await getPerformanceReviewSubmission(
    userId,
    cycleId,
    payload.data.sectionType,
    payload.data.collaboratorType,
  );

  if (existing) {
    return res.status(409).json({ message: 'Submissão já existe para esta secção.' });
  }

  const submission = await createPerformanceReviewSubmission({
    ...payload.data,
    actorUserId: req.authUser!.id,
  });

  return res.status(201).json(submission);
});

// ================== PATCH /performance-review/submissions/:submissionId ==================
router.patch('/performance-review/submissions/:submissionId', requireAuth, async (req, res) => {
  const submissionId = String(req.params.submissionId || '');

  const submission = await prisma.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return res.status(404).json({ message: 'Submissão de avaliação não encontrada.' });
  }

  if (!await canAccessPerformanceReviewTarget(req.authUser!, submission.userId)) {
    return res.status(403).json({ message: 'Sem permissões para editar esta submissão.' });
  }

  const payload = performanceReviewSubmissionUpdateSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const updated = await updatePerformanceReviewSubmission(submissionId, {
    ...payload.data,
    actorUserId: req.authUser!.id,
  });

  return res.json(updated);
});

// ================== POST /performance-review/submissions/:submissionId/submit ==================
router.post('/performance-review/submissions/:submissionId/submit', requireAuth, async (req, res) => {
  const submissionId = String(req.params.submissionId || '');

  const submission = await prisma.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return res.status(404).json({ message: 'Submissão de avaliação não encontrada.' });
  }

  if (!await canAccessPerformanceReviewTarget(req.authUser!, submission.userId)) {
    return res.status(403).json({ message: 'Sem permissões para submeter esta avaliação.' });
  }

  const updated = await submitPerformanceReviewSubmission(submissionId, req.authUser!.id);

  return res.json(updated);
});

// ================== POST /performance-review/submissions/batch-submit ==================
router.post('/performance-review/submissions/batch-submit', requireAuth, async (req, res) => {
  const payload = performanceReviewBatchSubmitSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const { userId, submissionIds } = payload.data;

  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para submeter esta avaliação.' });
  }

  const submissions = await prisma.performanceReviewSubmission.findMany({
    where: {
      id: { in: submissionIds },
      userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (submissions.length !== submissionIds.length) {
    return res.status(400).json({ message: 'Um ou mais blocos selecionados não foram encontrados.' });
  }

  const invalid = submissions.find((item) => item.status !== 'DRAFT' && item.status !== 'REVISED');
  if (invalid) {
    return res.status(400).json({ message: 'Só é possível submeter blocos em estado Pendente ou Revisto.' });
  }

  const updated = await Promise.all(
    submissionIds.map((submissionId) => submitPerformanceReviewSubmission(submissionId, req.authUser!.id)),
  );

  return res.json({ updated });
});

// ================== POST /performance-review/submissions/:submissionId/propose-edits ==================
router.post('/performance-review/submissions/:submissionId/propose-edits', requireAuth, async (req, res) => {
  const submissionId = String(req.params.submissionId || '');

  const submission = await prisma.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return res.status(404).json({ message: 'Submissão de avaliação não encontrada.' });
  }

  if (req.authUser!.id === submission.userId || !await hasPermission(req.authUser!.id, 'manage_performance_reviews')) {
    return res.status(403).json({ message: 'Sem permissões para propor edições.' });
  }

  const payload = performanceReviewSubmissionProposalSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const updated = await proposeEditsToSubmission(submissionId, payload.data.proposedEdits, req.authUser!.id);

  return res.json(updated);
});

// ================== POST /performance-review/submissions/:submissionId/accept-edits ==================
router.post('/performance-review/submissions/:submissionId/accept-edits', requireAuth, async (req, res) => {
  const submissionId = String(req.params.submissionId || '');

  const submission = await prisma.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return res.status(404).json({ message: 'Submissão de avaliação não encontrada.' });
  }

  if (!await canAccessPerformanceReviewTarget(req.authUser!, submission.userId)) {
    return res.status(403).json({ message: 'Sem permissões para aceitar edições.' });
  }

  const updated = await acceptProposedEdits(submissionId, req.authUser!.id);

  return res.json(updated);
});

// ================== POST /performance-review/submissions/:submissionId/reject-edits ==================
router.post('/performance-review/submissions/:submissionId/reject-edits', requireAuth, async (req, res) => {
  const submissionId = String(req.params.submissionId || '');

  const submission = await prisma.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return res.status(404).json({ message: 'Submissão de avaliação não encontrada.' });
  }

  if (!await canAccessPerformanceReviewTarget(req.authUser!, submission.userId)) {
    return res.status(403).json({ message: 'Sem permissões para rejeitar edições.' });
  }

  const updated = await rejectProposedEdits(submissionId, req.authUser!.id);

  return res.json(updated);
});

// ================== POST /performance-review/submissions/:submissionId/accept ==================
router.post('/performance-review/submissions/:submissionId/accept', requireAuth, async (req, res) => {
  const submissionId = String(req.params.submissionId || '');

  const submission = await prisma.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    return res.status(404).json({ message: 'Submissão de avaliação não encontrada.' });
  }

  if (req.authUser!.id === submission.userId && !await hasPermission(req.authUser!.id, 'manage_performance_reviews')) {
    return res.status(403).json({ message: 'Sem permissões para aceitar esta submissão.' });
  }

  const updated = await acceptSubmission(submissionId, req.authUser!.id);

  return res.json(updated);
});

// ================== GET /performance-review/:cycleId/submissions/:userId/history ==================
router.get('/performance-review/:cycleId/submissions/:userId/history', requireAuth, async (req, res) => {
  const cycleId = String(req.params.cycleId || '');
  const userId = String(req.params.userId || '');

  if (!await canAccessPerformanceReviewTarget(req.authUser!, userId)) {
    return res.status(403).json({ message: 'Sem permissões para aceder ao histórico de avaliação.' });
  }

  const history = await getPerformanceReviewSubmissionHistory(userId, cycleId);

  return res.json(history);
});

// ================== GET /performance-review/competencies/:level ==================
router.get('/performance-review/competencies/:level', requireAuth, async (req, res) => {
  const level = String(req.params.level || '');

  const competencies = await getBehavioralCompetenciesByLevel(level);

  return res.json(competencies);
});

// ================== GET /performance-review/leadership-questions ==================
router.get('/performance-review/leadership-questions', requireAuth, async (req, res) => {
  const questions = await getLeadershipReflectionQuestions();

  return res.json(questions);
});

export { router as performanceReviewRouter };
