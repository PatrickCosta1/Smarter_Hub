import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const receiptSchema = z.object({
  periodo: z.string().min(1, 'Período é obrigatório'),
  salarioLiquido: z.string().default(''),
  estado: z.enum(['Disponivel', 'Pendente']).default('Pendente'),
  documentoLink: z.string().url('O link do documento deve ser um URL válido.').or(z.literal('')).default(''),
});

router.get('/receipts/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const receipts = await prisma.receipt.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
    });

    res.json(receipts);
  } catch (error) {
    console.error('[GET /receipts/me]', error);
    res.status(500).json({ error: 'Falha ao carregar recibos' });
  }
});

router.post('/receipts', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const validation = receiptSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;

    const receipt = await prisma.receipt.create({
      data: {
        userId,
        periodo: data.periodo,
        salarioLiquido: data.salarioLiquido,
        estado: data.estado,
        documentoLink: data.documentoLink,
      },
    });

    res.status(201).json(receipt);
  } catch (error) {
    console.error('[POST /receipts]', error);
    res.status(500).json({ error: 'Falha ao criar recibo' });
  }
});

router.put('/receipts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const validation = receiptSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const existing = await prisma.receipt.findFirst({ where: { id, userId } });

    if (!existing) {
      return res.status(404).json({ error: 'Recibo não encontrado' });
    }

    const data = validation.data;

    const updated = await prisma.receipt.update({
      where: { id },
      data: {
        periodo: data.periodo,
        salarioLiquido: data.salarioLiquido,
        estado: data.estado,
        documentoLink: data.documentoLink,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('[PUT /receipts/:id]', error);
    res.status(500).json({ error: 'Falha ao atualizar recibo' });
  }
});

router.delete('/receipts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';

    const existing = await prisma.receipt.findFirst({ where: { id, userId } });

    if (!existing) {
      return res.status(404).json({ error: 'Recibo não encontrado' });
    }

    await prisma.receipt.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE /receipts/:id]', error);
    res.status(500).json({ error: 'Falha ao remover recibo' });
  }
});

export { router as receiptsRouter };
