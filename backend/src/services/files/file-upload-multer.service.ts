import { randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { uploadDir } from './file-storage.service.js';

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

export const upload = multer({
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
