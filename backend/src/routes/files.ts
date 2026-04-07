import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const uploadDir = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const safeExtension = extension && extension.length <= 10 ? extension : '';
    cb(null, `${Date.now()}-${randomUUID()}${safeExtension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.post('/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Ficheiro não enviado.' });
  }

  const linkPath = `/uploads/${req.file.filename}`;
  const configuredBase = (process.env.PUBLIC_FILES_BASE_URL || '').trim().replace(/\/$/, '');
  const requestBase = `${req.protocol}://${req.get('host')}`;
  const publicBase = configuredBase || requestBase;
  const fileUrl = `${publicBase}${linkPath}`;

  return res.status(201).json({
    fileName: req.file.originalname,
    fileSize: req.file.size,
    linkPath,
    link: fileUrl,
  });
});

export { router as filesRouter };
