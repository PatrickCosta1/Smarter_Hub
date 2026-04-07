import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

const createTrainingSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  link: z.string().default(''),
  horas: z.number().min(0, 'Horas deve ser não-negativo'),
  duracao: z.string().default(''),
  entidade: z.string().default(''),
  dataConclusao: z.string().default(''),
});

type CreateTrainingInput = z.infer<typeof createTrainingSchema>;

router.get('/trainings/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const trainings = await prisma.training.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(trainings);
  } catch (error) {
    console.error('[GET /trainings/me]', error);
    res.status(500).json({ error: 'Falha ao buscar formações' });
  }
});

router.post('/trainings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const validation = createTrainingSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;

    const training = await prisma.training.create({
      data: {
        userId,
        nome: data.nome,
        link: data.link,
        horas: data.horas,
        duracao: data.duracao,
        entidade: data.entidade,
        dataConclusao: data.dataConclusao,
      },
    });

    res.status(201).json(training);
  } catch (error) {
    console.error('[POST /trainings]', error);
    res.status(500).json({ error: 'Falha ao criar formação' });
  }
});

router.put('/trainings/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const validation = createTrainingSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const training = await prisma.training.findFirst({
      where: { id, userId },
    });

    if (!training) {
      return res.status(404).json({ error: 'Formação não encontrada' });
    }

    const data = validation.data;

    const updated = await prisma.training.update({
      where: { id },
      data: {
        nome: data.nome,
        link: data.link,
        horas: data.horas,
        duracao: data.duracao,
        entidade: data.entidade,
        dataConclusao: data.dataConclusao,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('[PUT /trainings/:id]', error);
    res.status(500).json({ error: 'Falha ao atualizar formação' });
  }
});

router.delete('/trainings/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';

    const training = await prisma.training.findFirst({
      where: { id, userId },
    });

    if (!training) {
      return res.status(404).json({ error: 'Formação não encontrada' });
    }

    await prisma.training.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE /trainings/:id]', error);
    res.status(500).json({ error: 'Falha ao eliminar formação' });
  }
});

export { router as trainingsRouter };
