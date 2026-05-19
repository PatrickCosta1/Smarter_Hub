import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const uploadDir = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.txt',
  '.doc',
  '.docx',
]);

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
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const isAllowedMime = ALLOWED_UPLOAD_MIME_TYPES.has((file.mimetype || '').toLowerCase());
    const isAllowedExtension = ALLOWED_UPLOAD_EXTENSIONS.has(extension);

    if (!isAllowedMime || !isAllowedExtension) {
      cb(new Error('Tipo de ficheiro não permitido.'));
      return;
    }

    cb(null, true);
  },
});

function buildFileResponse(req: Parameters<typeof router.post>[1] extends never ? never : any) {
  const linkPath = `/uploads/${req.file.filename}`;
  const configuredBase = (process.env.PUBLIC_FILES_BASE_URL || '').trim().replace(/\/$/, '');
  const requestBase = `${req.protocol}://${req.get('host')}`;
  const publicBase = configuredBase || requestBase;
  const fileUrl = `${publicBase}${linkPath}`;

  return {
    fileName: req.file.originalname,
    fileSize: req.file.size,
    linkPath,
    link: fileUrl,
  };
}

router.post('/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Ficheiro não enviado.' });
  }

  return res.status(201).json(buildFileResponse(req));
});

router.post('/files/admissions/:token/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Ficheiro não enviado.' });
  }

  const token = String(req.params.token || '');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const admission = await prisma.employeeAdmission.findUnique({
    where: { submissionTokenHash: tokenHash },
    select: { id: true, status: true, tokenExpiresAt: true },
  });

  if (!admission || admission.tokenExpiresAt < new Date() || !['INVITED', 'CHANGES_REQUESTED', 'SUBMITTED'].includes(admission.status)) {
    return res.status(403).json({ message: 'Convite inválido para upload de ficheiros.' });
  }

  return res.status(201).json(buildFileResponse(req));
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Ficheiro demasiado grande. Limite: 10MB.' });
    }
    return res.status(400).json({ message: error.message || 'Falha no upload.' });
  }

  if (error instanceof Error && error.message.includes('Tipo de ficheiro não permitido')) {
    return res.status(400).json({ message: error.message });
  }

  return next(error);
});

export { router as filesRouter };
