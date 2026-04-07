import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { notifyUsers, notifyUsersByRole } from '../lib/notifications.js';

const router = Router();

const createTrainingSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  link: z.string().default(''),
  horas: z.number().min(0, 'Horas deve ser não-negativo'),
  duracao: z.string().default(''),
  entidade: z.string().default(''),
  dataConclusao: z.string().default(''),
});

const assignTrainingSchema = z.object({
  userId: z.string().min(1, 'Colaborador é obrigatório'),
  nome: z.string().min(1, 'Nome é obrigatório'),
  link: z.string().default(''),
  horas: z.number().min(0, 'Horas deve ser não-negativo'),
  duracao: z.string().default(''),
  entidade: z.string().default(''),
});

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

router.get('/trainings/assigned', requireAuth, async (req: Request, res: Response) => {
  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ message: 'Sem permissões para consultar formações atribuídas.' });
  }

  const trainings = await prisma.training.findMany({
    where: { assignedByUserId: { not: null } },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
        },
      },
      assignedBy: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(trainings);
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

router.post('/trainings/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
      return res.status(403).json({ message: 'Sem permissões para atribuir formações.' });
    }

    const validation = assignTrainingSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;
    const collaborator = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, username: true },
    });

    if (!collaborator) {
      return res.status(404).json({ error: 'Colaborador não encontrado' });
    }

    const training = await prisma.training.create({
      data: {
        userId: collaborator.id,
        nome: data.nome,
        link: data.link,
        horas: data.horas,
        duracao: data.duracao,
        entidade: data.entidade,
        dataConclusao: '',
        status: 'ASSIGNED',
        assignedByUserId: req.authUser!.id,
      },
    });

    await notifyUsers(prisma, [collaborator.id], 'Nova formação atribuída', `Foi-te atribuída a formação ${data.nome}.`);

    return res.status(201).json(training);
  } catch (error) {
    console.error('[POST /trainings/assign]', error);
    return res.status(500).json({ error: 'Falha ao atribuir formação' });
  }
});

router.post('/trainings/:id/complete', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';

    const training = await prisma.training.findFirst({
      where: { id, userId },
    });

    if (!training) {
      return res.status(404).json({ error: 'Formação não encontrada' });
    }

    if (training.status !== 'ASSIGNED') {
      return res.status(400).json({ error: 'Esta formação não está atribuída para conclusão.' });
    }

    const updated = await prisma.training.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        dataConclusao: new Date().toISOString().slice(0, 10),
        completedAt: new Date(),
      },
    });

    await notifyUsersByRole(prisma, ['MANAGER', 'COORDENADOR', 'ADMIN'], 'Formação concluída', `${req.authUser!.username} marcou uma formação como concluída.`);

    return res.json(updated);
  } catch (error) {
    console.error('[POST /trainings/:id/complete]', error);
    return res.status(500).json({ error: 'Falha ao concluir formação' });
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
