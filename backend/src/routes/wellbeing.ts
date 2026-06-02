import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  canManageWellbeingPage,
  loadWellbeingContent,
  saveWellbeingContent,
  submitWellbeingComplaint,
  resolveAllowedCountries,
  redactContentByCountries,
  wellbeingContentSchema,
  harassmentReportSchema,
} from '../services/wellbeing/wellbeing.service.js';

const router = Router();

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

  const normalized = await saveWellbeingContent(parsed.data, req.authUser);
  const allowedCountries = await resolveAllowedCountries(req.authUser);
  return res.json(redactContentByCountries(normalized, allowedCountries));
});

async function handleWellbeingComplaint(req: Request, res: Response) {
  if (!req.authUser) {
    return res.status(401).json({ message: 'Sessão inválida.' });
  }

  const parsed = harassmentReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Formulário inválido.', issues: parsed.error.issues });
  }

  await submitWellbeingComplaint(req.authUser.id, parsed.data);
  return res.status(201).json({ message: 'Reclamação enviada com sucesso.' });
}

router.post('/wellbeing/harassment-report', requireAuth, handleWellbeingComplaint);
router.post('/wellbeing/complaint', requireAuth, handleWellbeingComplaint);

export { router as wellbeingRouter };
