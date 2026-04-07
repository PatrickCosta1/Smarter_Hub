import { Router } from 'express';

const router = Router();

router.all(/^\/receipts(?:\/.*)?$/, (_req, res) => {
  return res.status(410).json({ message: 'Recibos temporariamente indisponíveis.' });
});

export { router as receiptsRouter };
