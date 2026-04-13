import { Router } from "express";
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { verifyFirebaseIdToken } from "../lib/firebase-admin.js";
import { requireAuth, signAuthToken } from "../middleware/auth.js";

const router = Router();

const AUTO_DEFAULT_EMPLOYEE_NOTE = '[AUTO_PRESET_DEFAULT_EMPLOYEE]';
const DEFAULT_EMPLOYEE_PERMISSION_CODES = [
  'view_profile',
  'request_profile_change',
  'view_notifications',
  'request_vacation',
  'view_own_vacations',
  'request_training',
  'view_trainings',
  'view_receipts',
  'download_receipt',
] as const;

const microsoftLoginSchema = z.object({
  idToken: z.string().min(1),
});

function parseBooleanEnv(value: string | undefined, fallback = false) {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'sim'].includes(value.trim().toLowerCase());
}

function getAllowedDomains() {
  return (process.env.MICROSOFT_ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getEmailDomain(email: string) {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : '';
}

function normalizeUsernameCandidate(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40);
}

async function generateUniqueUsername(baseValue: string) {
  const fallback = `user.${randomUUID().slice(0, 8)}`;
  const base = normalizeUsernameCandidate(baseValue) || fallback;

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? base : `${base}.${index}`;
    const exists = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!exists) {
      return candidate;
    }
  }

  return `${base}.${randomUUID().slice(0, 6)}`;
}

function resolveDefaultRole(): Role {
  const raw = (process.env.AUTH_MICROSOFT_DEFAULT_ROLE ?? 'COLABORADOR').trim().toUpperCase();
  if (raw === 'MANAGER' || raw === 'COORDENADOR' || raw === 'ADMIN' || raw === 'CONVIDADO') {
    return raw;
  }
  return 'COLABORADOR';
}

function resolveDefaultWorkCountry() {
  return (process.env.AUTH_MICROSOFT_DEFAULT_WORK_COUNTRY ?? 'PT').trim().toUpperCase() === 'BR' ? 'BR' : 'PT';
}

async function assignDefaultEmployeePermissions(userId: string) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...DEFAULT_EMPLOYEE_PERMISSION_CODES] } },
    select: { id: true },
  });

  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId,
          permissionId: permission.id,
        },
      },
      create: {
        userId,
        permissionId: permission.id,
        isEnabled: true,
        notes: AUTO_DEFAULT_EMPLOYEE_NOTE,
      },
      update: {
        isEnabled: true,
        notes: AUTO_DEFAULT_EMPLOYEE_NOTE,
      },
    });
  }
}

async function provisionUserFromMicrosoft(email: string, decodedToken: Awaited<ReturnType<typeof verifyFirebaseIdToken>>) {
  const displayName = String(decodedToken.name ?? '').trim();
  const givenName = String(decodedToken.given_name ?? '').trim();
  const familyName = String(decodedToken.family_name ?? '').trim();
  const localPart = email.split('@')[0] ?? '';

  const fullName = displayName || `${givenName} ${familyName}`.trim() || localPart;
  const firstName = givenName || fullName.split(' ')[0] || localPart;
  const lastName = familyName || fullName.split(' ').slice(1).join(' ');
  const shortName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();

  const username = await generateUniqueUsername(localPart || fullName);
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  const role = resolveDefaultRole();
  const workCountry = resolveDefaultWorkCountry() as 'PT' | 'BR';

  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      role,
      teamId: null,
      profile: {
        create: {
          primeiroNome: firstName,
          apelido: lastName,
          nomeAbreviado: shortName || username,
          emailPessoal: email,
          workCountry,
          localidade: '',
          cargo: '',
          funcao: '',
          dataInicioContrato: '',
          dataFimContrato: '',
          remuneracao: '',
          tipoContrato: '',
          regimeHorario: '',
        },
      },
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      isRootAccess: true,
    },
  });

  if (role !== 'CONVIDADO') {
    await assignDefaultEmployeePermissions(user.id);
  }

  return user;
}

router.post('/auth/login', async (_req, res) => {
  return res.status(410).json({
    message: 'Login por utilizador e password foi desativado. Usa Entrar com Microsoft.',
  });
});

router.post('/auth/microsoft', async (req, res) => {
  const parsed = microsoftLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }

  try {
    const decodedToken = await verifyFirebaseIdToken(parsed.data.idToken);
    const email = decodedToken.email?.trim().toLowerCase();

    if (!email) {
      return res.status(401).json({ message: 'Token Microsoft sem email válido.' });
    }

    const allowedDomains = getAllowedDomains();
    const emailDomain = getEmailDomain(email);
    if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
      return res.status(403).json({
        message: 'Este domínio de email não está autorizado para acesso ao Smarter Hub.',
      });
    }

    const autoProvision = parseBooleanEnv(process.env.AUTH_MICROSOFT_AUTO_PROVISION, false);

    let user = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isRootAccess: true,
      },
    });

    if (!user) {
      if (!autoProvision) {
        return res.status(403).json({ message: 'Conta não provisionada no Smarter Hub. Contacta um administrador.' });
      }

      user = await provisionUserFromMicrosoft(email, decodedToken);
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Conta inativa. Contacta RH para mais informações.' });
    }

    const token = signAuthToken(user);
    return res.json({ token, user });
  } catch (error) {
    console.error('[POST /auth/microsoft]', error);
    return res.status(401).json({ message: 'Falha ao validar autenticação Microsoft.' });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: req.authUser });
});

router.patch('/auth/account', requireAuth, async (_req, res) => {
  return res.status(410).json({
    message: 'Gestão de credenciais locais foi desativada. A autenticação é feita apenas com Microsoft.',
  });
});

export { router as authRouter };
