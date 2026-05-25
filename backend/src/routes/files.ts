import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { hasPermission } from '../lib/permission-engine.js';
import {
  canAccessAdmissionFileWithToken,
  canAccessHourBankFile,
  canAccessProfileFileByScope,
  canUploadAdmissionFile,
} from '../services/files/file-access.service.js';
import {
  buildFileResponse,
  ensureUploadDirExists,
  resolveRelativePath,
  resolveSafeDiskPath,
} from '../services/files/file-storage.service.js';
import { upload } from '../services/files/file-upload-multer.service.js';

const router = Router();
const uploadsRouter = Router();

ensureUploadDirExists();

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

  return res.status(201).json(buildFileResponse({
    protocol: req.protocol,
    host: req.get('host'),
    fileName: req.file.originalname,
    fileSize: req.file.size,
    storedFileName: req.file.filename,
  }));
});

router.post('/files/admissions/:token/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Ficheiro não enviado.' });
  }

  const token = String(req.params.token || '');
  const canUpload = await canUploadAdmissionFile(token);
  if (!canUpload) {
    return res.status(403).json({ message: 'Convite inválido para upload de ficheiros.' });
  }

  return res.status(201).json(buildFileResponse({
    protocol: req.protocol,
    host: req.get('host'),
    fileName: req.file.originalname,
    fileSize: req.file.size,
    storedFileName: req.file.filename,
    admissionToken: token,
  }));
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
