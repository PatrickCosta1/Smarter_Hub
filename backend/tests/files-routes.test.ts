import express from 'express';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    employeeAdmission: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'COLABORADOR',
      isActive: true,
      isRootAccess: false,
    };
    next();
  },
}));

import { filesRouter } from '../src/routes/files.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', filesRouter);
  return app;
}

describe('files routes integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.employeeAdmission.findUnique.mockResolvedValue({
      id: 'adm-1',
      status: 'INVITED',
      tokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
  });

  afterEach(() => {
    // Cleanup any uploaded test files from the uploads directory
    // In real integration tests this would clean the filesystem;
    // here we rely on the route's own handling.
  });

  // ─── POST /files/upload ───────────────────────────────────────────────────

  describe('POST /api/files/upload', () => {
    it('returns 400 when no file is sent', async () => {
      const app = buildApp();
      const response = await request(app)
        .post('/api/files/upload')
        .field('dummy', 'value'); // multipart form sem ficheiro → req.file === undefined

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Ficheiro não enviado');
    });

    it('returns 201 with file metadata when a file is uploaded', async () => {
      const app = buildApp();
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('conteúdo do ficheiro de teste'), {
          filename: 'test-doc.txt',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(201);
      expect(response.body.fileName).toBe('test-doc.txt');
      expect(typeof response.body.fileSize).toBe('number');
      expect(response.body.linkPath).toMatch(/^\/uploads\//);
      expect(response.body.link).toContain('/uploads/');
    });

    it('returns 201 for PDF file upload', async () => {
      const app = buildApp();
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('%PDF-1.4 test content'), {
          filename: 'documento.pdf',
          contentType: 'application/pdf',
        });

      expect(response.status).toBe(201);
      expect(response.body.fileName).toBe('documento.pdf');
      expect(response.body.linkPath).toMatch(/\.pdf$/);
    });

    it('link path contains no directory traversal', async () => {
      const app = buildApp();
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('data'), {
          filename: '../../../etc/passwd.txt',
          contentType: 'text/plain',
        });

      // Should succeed but sanitize the filename
      expect(response.status).toBe(201);
      // The stored path should not contain directory traversal characters
      expect(response.body.linkPath).not.toContain('..');
      expect(response.body.linkPath).toMatch(/^\/uploads\//);
    });

    it('returns 201 for image file', async () => {
      const app = buildApp();
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('fake image data'), {
          filename: 'foto.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(201);
      expect(response.body.linkPath).toMatch(/\.jpg$/);
    });

    it('uses PUBLIC_FILES_BASE_URL env var for link when set', async () => {
      const originalEnv = process.env.PUBLIC_FILES_BASE_URL;
      process.env.PUBLIC_FILES_BASE_URL = 'https://cdn.example.com';

      try {
        const app = buildApp();
        const response = await request(app)
          .post('/api/files/upload')
          .attach('file', Buffer.from('test'), {
            filename: 'file.txt',
            contentType: 'text/plain',
          });

        expect(response.status).toBe(201);
        expect(response.body.link).toMatch(/^https:\/\/cdn\.example\.com/);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.PUBLIC_FILES_BASE_URL;
        } else {
          process.env.PUBLIC_FILES_BASE_URL = originalEnv;
        }
      }
    });
  });

  describe('POST /api/files/admissions/:token/upload', () => {
    it('returns 403 when admission token is invalid', async () => {
      prismaMock.employeeAdmission.findUnique.mockResolvedValue(null);
      const app = buildApp();

      const response = await request(app)
        .post('/api/files/admissions/invalid-token/upload')
        .attach('file', Buffer.from('conteudo'), {
          filename: 'doc.txt',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(403);
    });

    it('returns 201 when token is valid', async () => {
      const app = buildApp();

      const response = await request(app)
        .post('/api/files/admissions/valid-token/upload')
        .attach('file', Buffer.from('conteudo'), {
          filename: 'doc.txt',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(201);
      expect(response.body.linkPath).toMatch(/^\/uploads\//);
    });
  });
});
