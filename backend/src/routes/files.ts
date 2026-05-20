import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { canAccessUserByPermission, hasPermission } from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const uploadsRouter = Router();

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

const PROFILE_FILE_FIELDS = [
  'photoUrl',
  'certificadoHabilitacoesUrl',
  'cartaConducaoUrl',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'criminalRecordUrl',
] as const;

const ADMISSION_FILE_FIELDS = [
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'declaracaoIrs',
  'comprovativoCartaoContinente',
] as const;

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

function normalizeStoredFilePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('/uploads/')) {
    return trimmed.slice('/uploads/'.length);
  }

  if (trimmed.startsWith('uploads/')) {
    return trimmed.slice('uploads/'.length);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const pathname = parsed.pathname || '';
      if (pathname.startsWith('/uploads/')) {
        return pathname.slice('/uploads/'.length);
      }
    } catch {
      return '';
    }
  }

  return trimmed.replace(/^\/+/, '');
}

function resolveRelativePath(requestPath: string) {
  let decoded = requestPath;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
    return null;
  }

  return normalized;
}

function resolveSafeDiskPath(relativePath: string) {
  const resolved = path.resolve(uploadDir, relativePath);
  const normalizedRoot = `${uploadDir}${path.sep}`;
  if (resolved !== uploadDir && !resolved.startsWith(normalizedRoot)) {
    return null;
  }
  return resolved;
}

function buildFileResponse(req: Parameters<typeof router.post>[1] extends never ? never : any, admissionToken?: string) {
  const tokenSuffix = admissionToken ? `?admissionToken=${encodeURIComponent(admissionToken)}` : '';
  const linkPath = `/uploads/${req.file.filename}${tokenSuffix}`;
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

async function canAccessAdmissionFileWithToken(admissionToken: string, relativePath: string) {
  const tokenHash = createHash('sha256').update(admissionToken).digest('hex');
  const admission = await prisma.employeeAdmission.findUnique({
    where: { submissionTokenHash: tokenHash },
    select: { tokenExpiresAt: true, personalData: true },
  });

  if (!admission || admission.tokenExpiresAt < new Date()) {
    return false;
  }

  const personalData = (admission.personalData && typeof admission.personalData === 'object')
    ? admission.personalData as Record<string, unknown>
    : {};

  for (const field of ADMISSION_FILE_FIELDS) {
    const value = personalData[field];
    if (typeof value !== 'string') {
      continue;
    }

    if (normalizeStoredFilePath(value) === relativePath) {
      return true;
    }
  }

  return false;
}

async function canAccessProfileFileByScope(actorUserId: string, relativePath: string) {
  const candidates = Array.from(new Set([
    relativePath,
    `/uploads/${relativePath}`,
    `uploads/${relativePath}`,
    path.posix.basename(relativePath),
  ]));

  const profile = await prisma.profile.findFirst({
    where: {
      OR: PROFILE_FILE_FIELDS.map((field) => ({
        [field]: { in: candidates },
      })) as Array<Record<string, unknown>>,
    },
    select: { userId: true },
  });

  if (!profile) {
    return false;
  }

  if (profile.userId === actorUserId) {
    return true;
  }

  return canAccessUserByPermission(actorUserId, 'view_user_list', profile.userId);
}

async function canAccessHourBankFile(actorUserId: string, isRootAccess: boolean) {
  if (isRootAccess) {
    return true;
  }

  const [canView, canManage] = await Promise.all([
    hasPermission(actorUserId, 'view_hours_bank'),
    hasPermission(actorUserId, 'manage_hours_bank'),
  ]);

  return canView || canManage;
}

uploadsRouter.get(/.*/, async (req, res, next) => {
  const relativePath = resolveRelativePath(req.path.replace(/^\/+/, ''));
  if (!relativePath) {
    return res.status(400).json({ message: 'Caminho de ficheiro inválido.' });
  }

  const safeDiskPath = resolveSafeDiskPath(relativePath);
  if (!safeDiskPath || !fs.existsSync(safeDiskPath)) {
    return res.status(404).json({ message: 'Ficheiro não encontrado.' });
  }

  const admissionToken = String(req.query.admissionToken || '').trim();
  if (!admissionToken) {
    return next();
  }

  const canAccessByAdmissionToken = await canAccessAdmissionFileWithToken(admissionToken, relativePath);
  if (!canAccessByAdmissionToken) {
    return res.status(403).json({ message: 'Sem permissões para aceder a este ficheiro.' });
  }

  return res.sendFile(safeDiskPath);
});

uploadsRouter.get(/.*/, requireAuth, async (req, res) => {
  const relativePath = resolveRelativePath(req.path.replace(/^\/+/, ''));
  if (!relativePath) {
    return res.status(400).json({ message: 'Caminho de ficheiro inválido.' });
  }

  const safeDiskPath = resolveSafeDiskPath(relativePath);
  if (!safeDiskPath || !fs.existsSync(safeDiskPath)) {
    return res.status(404).json({ message: 'Ficheiro não encontrado.' });
  }

  const authUser = req.authUser!;

  if (relativePath.startsWith('hour-bank-reports/')) {
    const canAccessHourBank = await canAccessHourBankFile(authUser.id, authUser.isRootAccess);
    if (!canAccessHourBank) {
      return res.status(403).json({ message: 'Sem permissões para aceder a este relatório.' });
    }

    return res.sendFile(safeDiskPath);
  }

  const [canAccessProfileFile, canReviewAdmissions] = await Promise.all([
    canAccessProfileFileByScope(authUser.id, relativePath),
    authUser.isRootAccess ? Promise.resolve(true) : hasPermission(authUser.id, 'approve_profile_change'),
  ]);

  if (!canAccessProfileFile && !canReviewAdmissions) {
    return res.status(403).json({ message: 'Sem permissões para aceder a este ficheiro.' });
  }

  return res.sendFile(safeDiskPath);
});

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

  return res.status(201).json(buildFileResponse(req, token));
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

export { router as filesRouter, uploadsRouter };
