import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { buildUserWhereFromScope, canAccessUserByPermission, getPermissionScope, hasPermission } from '../lib/permission-engine.js';
import { notifyUsers, notifyUsersByPermission } from '../lib/notifications.js';

const router = Router();

const createTrainingSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  link: z.string().default(''),
  horas: z.number().min(0, 'Horas deve ser não-negativo'),
  dataInicio: z.string().default(''),
  entidade: z.string().default(''),
  dataConclusao: z.string().default(''),
});

const assignTrainingSchema = z.object({
  userId: z.string().min(1, 'Colaborador é obrigatório'),
  nome: z.string().min(1, 'Nome é obrigatório'),
  link: z.string().default(''),
  horas: z.number().min(0, 'Horas deve ser não-negativo'),
  dataInicio: z.string().default(''),
  entidade: z.string().default(''),
});

function parsePagination(query: Request['query']) {
  const hasPagination = typeof query.page === 'string' || typeof query.pageSize === 'string';
  if (!hasPagination) {
    return null;
  }

  const pageRaw = Number(typeof query.page === 'string' ? query.page : '1');
  const pageSizeRaw = Number(typeof query.pageSize === 'string' ? query.pageSize : '20');
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, pageSizeRaw)) : 20;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

router.get('/trainings/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const pagination = parsePagination(req.query);

    if (!await hasPermission(userId, 'view_trainings')) {
      return res.status(403).json({ error: 'Sem permissões para consultar formações.' });
    }

    const where = { userId };
    const include = {
      assignedBy: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
        },
      },
    };

    if (!pagination) {
      const trainings = await prisma.training.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });

      return res.json(trainings);
    }

    const [total, rows] = await Promise.all([
      prisma.training.count({ where }),
      prisma.training.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return res.json({ total, page: pagination.page, pageSize: pagination.pageSize, rows });
  } catch (error) {
    console.error('[GET /trainings/me]', error);
    res.status(500).json({ error: 'Falha ao buscar formações' });
  }
});

router.get('/trainings/assigned', requireAuth, async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query);

  if (!await hasPermission(req.authUser!.id, 'view_all_trainings')) {
    return res.status(403).json({ message: 'Sem permissões para consultar formações atribuídas.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_all_trainings');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar formações atribuídas.' });
  }

  const userScopeWhere = buildUserWhereFromScope(scope);

  const where = {
    assignedByUserId: { not: null as null | string },
    ...(userScopeWhere ? { user: userScopeWhere } : {}),
  };

  const include = {
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
        profile: {
          select: {
            nomeAbreviado: true,
            nomeCompleto: true,
          },
        },
      },
    },
  };

  if (!pagination) {
    const trainings = await prisma.training.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
    });

    return res.json(trainings);
  }

  const [total, rows] = await Promise.all([
    prisma.training.count({ where }),
    prisma.training.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);

  return res.json({ total, page: pagination.page, pageSize: pagination.pageSize, rows });
});

router.post('/trainings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    if (!await hasPermission(userId, 'request_training')) {
      return res.status(403).json({ error: 'Sem permissões para registar formação.' });
    }

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
        dataInicio: data.dataInicio,
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
    const validation = assignTrainingSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;

    const canAssignOthers = await hasPermission(req.authUser!.id, 'assign_training');
    const isSelfAssign = data.userId === req.authUser!.id;

    if (!canAssignOthers && !(isSelfAssign && await hasPermission(req.authUser!.id, 'request_training'))) {
      return res.status(403).json({ message: 'Sem permissões para atribuir formações a terceiros.' });
    }

    if (canAssignOthers && !isSelfAssign) {
      const canAssignTarget = await canAccessUserByPermission(req.authUser!.id, 'assign_training', data.userId);
      if (!canAssignTarget) {
        return res.status(403).json({ message: 'Sem permissões para atribuir formação a este colaborador com as restrições atuais.' });
      }
    }

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
        dataInicio: data.dataInicio,
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
    if (!await hasPermission(userId, 'mark_training_completed')) {
      return res.status(403).json({ error: 'Sem permissões para concluir formação.' });
    }

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

    await notifyUsersByPermission(prisma, ['view_all_trainings', 'assign_training'], 'Formação concluída', `${req.authUser!.username} marcou uma formação como concluída.`);

    return res.json(updated);
  } catch (error) {
    console.error('[POST /trainings/:id/complete]', error);
    return res.status(500).json({ error: 'Falha ao concluir formação' });
  }
});

router.put('/trainings/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    if (!await hasPermission(userId, 'request_training')) {
      return res.status(403).json({ error: 'Sem permissões para atualizar formação.' });
    }

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
        dataInicio: data.dataInicio,
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
    if (!await hasPermission(userId, 'request_training')) {
      return res.status(403).json({ error: 'Sem permissões para remover formação.' });
    }

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
