import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const vacationSchema = z
  .object({
    dataInicio: z.string().min(1, 'Data de início é obrigatória'),
    dataFim: z.string().min(1, 'Data de fim é obrigatória'),
    tipo: z.enum(['dia_completo', 'meio_dia_manha', 'meio_dia_tarde']).default('dia_completo'),
    observacoes: z.string().default(''),
  })
  .superRefine((data, ctx) => {
    if (data.dataInicio > data.dataFim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataFim'],
        message: 'A data de fim deve ser igual ou posterior à data de início.',
      });
    }

    const isHalfDay = data.tipo === 'meio_dia_manha' || data.tipo === 'meio_dia_tarde';
    if (isHalfDay && data.dataInicio !== data.dataFim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tipo'],
        message: 'Meio dia só pode ser usado para uma única data.',
      });
    }
  });

router.get('/vacations/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const vacations = await prisma.vacation.findMany({
      where: { userId },
      orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(vacations);
  } catch (error) {
    console.error('[GET /vacations/me]', error);
    res.status(500).json({ error: 'Falha ao carregar férias' });
  }
});

router.post('/vacations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const validation = vacationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;

    const vacation = await prisma.vacation.create({
      data: {
        userId,
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        tipo: data.tipo,
        observacoes: data.observacoes,
      },
    });

    res.status(201).json(vacation);
  } catch (error) {
    console.error('[POST /vacations]', error);
    res.status(500).json({ error: 'Falha ao registar férias' });
  }
});

router.put('/vacations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const validation = vacationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const existing = await prisma.vacation.findFirst({ where: { id, userId } });

    if (!existing) {
      return res.status(404).json({ error: 'Registo de férias não encontrado' });
    }

    const data = validation.data;

    const updated = await prisma.vacation.update({
      where: { id },
      data: {
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        tipo: data.tipo,
        observacoes: data.observacoes,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('[PUT /vacations/:id]', error);
    res.status(500).json({ error: 'Falha ao atualizar férias' });
  }
});

router.delete('/vacations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';

    const existing = await prisma.vacation.findFirst({ where: { id, userId } });

    if (!existing) {
      return res.status(404).json({ error: 'Registo de férias não encontrado' });
    }

    await prisma.vacation.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE /vacations/:id]', error);
    res.status(500).json({ error: 'Falha ao remover férias' });
  }
});

export { router as vacationsRouter };
