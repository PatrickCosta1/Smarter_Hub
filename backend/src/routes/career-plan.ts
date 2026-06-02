import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { careerPlanContentSchema, loadCareerPlanContent, saveCareerPlanContent } from '../services/career-plan/career-plan.service.js';

const router = Router();

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
