import fs from 'node:fs';
import path from 'node:path';

export const uploadDir = path.resolve(process.cwd(), 'uploads');

export function ensureUploadDirExists() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

export function normalizeStoredFilePath(value: string) {
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

export function resolveRelativePath(requestPath: string) {
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

export function resolveSafeDiskPath(relativePath: string) {
  const resolved = path.resolve(uploadDir, relativePath);
  const normalizedRoot = `${uploadDir}${path.sep}`;
  if (resolved !== uploadDir && !resolved.startsWith(normalizedRoot)) {
    return null;
  }
  return resolved;
}

export function buildFileResponse(input: {
  protocol: string;
  host?: string;
  fileName: string;
  fileSize: number;
  storedFileName: string;
  admissionToken?: string;
}) {
  const tokenSuffix = input.admissionToken ? `?admissionToken=${encodeURIComponent(input.admissionToken)}` : '';
  const linkPath = `/uploads/${input.storedFileName}${tokenSuffix}`;
  const configuredBase = (process.env.PUBLIC_FILES_BASE_URL || '').trim().replace(/\/$/, '');
  const requestBase = `${input.protocol}://${input.host || ''}`;
  const publicBase = configuredBase || requestBase;
  const fileUrl = `${publicBase}${linkPath}`;

  return {
    fileName: input.fileName,
    fileSize: input.fileSize,
    linkPath,
    link: fileUrl,
  };
}
