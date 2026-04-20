# Tutorial Executavel - Implementar Login Microsoft do Zero (Sem Acesso a Este Codigo)

Este documento e para entrega a outra pessoa implementar no projeto dela, sem ver este repositorio.
Esta tudo descrito em modo "faz exatamente isto".

## 1. Resultado final esperado

No fim, a app tera:
1. Botao "Entrar com Microsoft" no frontend.
2. Popup Microsoft via Firebase Authentication.
3. Backend a validar o idToken Microsoft/Firebase.
4. Backend a emitir JWT proprio da aplicacao.
5. Frontend a guardar sessao e restaurar via `/auth/me`.
6. Opcao de bloquear criacao automatica de utilizador (`AUTH_MICROSOFT_AUTO_PROVISION=false`).

## 2. Pre-requisitos obrigatorios

Instalar localmente:
1. Node.js 20+
2. npm 10+
3. PostgreSQL (ou outro BD suportado pelo teu backend)

Contas e acessos:
1. Firebase projeto criado.
2. Provider Microsoft ativado em Firebase Authentication.
3. Credenciais Microsoft (Azure) associadas ao provider no Firebase.
4. Service account Firebase para backend (JSON).

## 3. Estrutura de projeto que a pessoa deve criar

Pasta raiz (exemplo):

```text
my-app/
  backend/
    src/
      lib/
      middleware/
      routes/
      db/
      types/
      index.ts
    package.json
    tsconfig.json
    .env
  frontend/
    src/
      lib/
      auth/
      pages/
      App.tsx
      main.tsx
    package.json
    tsconfig.json
    vite.config.ts
    .env
```

## 4. Backend - criacao completa

## 4.1 Inicializar backend

Executar:

```bash
mkdir backend
cd backend
npm init -y
npm install express cors zod jsonwebtoken dotenv firebase-admin bcryptjs
npm install -D typescript tsx @types/node @types/express @types/cors @types/jsonwebtoken @types/bcryptjs
npx tsc --init
```

Editar `backend/package.json` para incluir scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  }
}
```

Editar `backend/tsconfig.json` (minimo):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "rootDir": "src",
    "outDir": "dist",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

## 4.2 Criar variaveis de ambiente backend

Criar `backend/.env`:

```env
PORT=4000
FRONTEND_URL=http://localhost:5173
JWT_SECRET=trocar_isto_em_producao

# login local opcional
AUTH_ENABLE_LOCAL_LOGIN=false

# se false: so entra quem ja existe na BD
AUTH_MICROSOFT_AUTO_PROVISION=false
AUTH_MICROSOFT_DEFAULT_ROLE=COLABORADOR
AUTH_MICROSOFT_DEFAULT_WORK_COUNTRY=PT
MICROSOFT_ALLOWED_EMAIL_DOMAINS=empresa.com

# opcao recomendada: JSON inteiro da service account numa unica linha
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}

# opcao alternativa (se nao quiser JSON inline)
# FIREBASE_PROJECT_ID=...
# FIREBASE_CLIENT_EMAIL=...
# FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## 4.3 Criar tipagem de utilizador autenticado

Criar `backend/src/types/auth.ts`:

```ts
export type AuthUser = {
  id: number;
  email: string;
  nomeCompleto: string;
  role: string;
  isActive: boolean;
};
```

## 4.4 Criar "base de dados" minima (mock trocavel por Prisma)

Criar `backend/src/db/users.ts`:

```ts
import bcrypt from "bcryptjs";
import type { AuthUser } from "../types/auth";

type InternalUser = AuthUser & {
  passwordHash?: string;
};

let seq = 2;

const users: InternalUser[] = [
  {
    id: 1,
    email: "admin@empresa.com",
    nomeCompleto: "Admin",
    role: "ROOT",
    isActive: true,
    passwordHash: bcrypt.hashSync("123456", 10)
  }
];

export async function findUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === normalized) ?? null;
}

export async function findUserById(id: number) {
  return users.find((u) => u.id === id) ?? null;
}

export async function createUser(input: {
  email: string;
  nomeCompleto: string;
  role: string;
  isActive: boolean;
}) {
  const user: InternalUser = {
    id: seq++,
    email: input.email.trim().toLowerCase(),
    nomeCompleto: input.nomeCompleto,
    role: input.role,
    isActive: input.isActive
  };
  users.push(user);
  return user;
}

export async function validateLocalPassword(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}
```

## 4.5 Criar integracao Firebase Admin

Criar `backend/src/lib/firebase-admin.ts`:

```ts
import admin from "firebase-admin";

function getServiceAccountFromEnv() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const parsed = JSON.parse(inline);
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin nao configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON ou vars separadas.");
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey
  };
}

let initialized = false;

function ensureFirebaseAdmin() {
  if (initialized) return;

  const sa = getServiceAccountFromEnv();
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key
    })
  });

  initialized = true;
}

export async function verifyFirebaseIdToken(idToken: string) {
  ensureFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken, true);
}
```

## 4.6 Criar middleware JWT

Criar `backend/src/middleware/auth.ts`:

```ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { findUserById } from "../db/users";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

type TokenPayload = {
  sub: number;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: number;
        email: string;
        nomeCompleto: string;
        role: string;
      };
    }
  }
}

export function signAuthToken(user: { id: number; email: string }) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "8h"
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Token em falta" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    const user = await findUserById(Number(decoded.sub));

    if (!user) {
      return res.status(401).json({ message: "Sessao invalida" });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "Conta inativa" });
    }

    req.authUser = {
      id: user.id,
      email: user.email,
      nomeCompleto: user.nomeCompleto,
      role: user.role
    };

    next();
  } catch {
    return res.status(401).json({ message: "Token invalido" });
  }
}
```

## 4.7 Criar rotas de autenticacao

Criar `backend/src/routes/auth.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseIdToken } from "../lib/firebase-admin";
import { signAuthToken, requireAuth } from "../middleware/auth";
import { createUser, findUserByEmail, validateLocalPassword } from "../db/users";

const router = Router();

const enableLocal = String(process.env.AUTH_ENABLE_LOCAL_LOGIN || "false") === "true";
const autoProvision = String(process.env.AUTH_MICROSOFT_AUTO_PROVISION || "false") === "true";
const defaultRole = process.env.AUTH_MICROSOFT_DEFAULT_ROLE || "COLABORADOR";

const allowedDomains = (process.env.MICROSOFT_ALLOWED_EMAIL_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isAllowedDomain(email: string) {
  if (allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return allowedDomains.includes(domain);
}

router.post("/auth/microsoft", async (req, res) => {
  const schema = z.object({ idToken: z.string().min(10) });
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Body invalido" });
  }

  try {
    const decoded = await verifyFirebaseIdToken(parsed.data.idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    const nomeCompleto = String(decoded.name || email);

    if (!email) {
      return res.status(401).json({ message: "Token sem email" });
    }

    if (!isAllowedDomain(email)) {
      return res.status(403).json({ message: "Dominio de email nao autorizado" });
    }

    let user = await findUserByEmail(email);

    if (!user) {
      if (!autoProvision) {
        return res.status(403).json({ message: "Conta nao provisionada" });
      }

      user = await createUser({
        email,
        nomeCompleto,
        role: defaultRole,
        isActive: true
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "Conta inativa" });
    }

    const token = signAuthToken({ id: user.id, email: user.email });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nomeCompleto: user.nomeCompleto,
        role: user.role
      }
    });
  } catch {
    return res.status(401).json({ message: "Falha ao validar autenticacao Microsoft" });
  }
});

router.post("/auth/login", async (req, res) => {
  if (!enableLocal) {
    return res.status(403).json({ message: "Login local desativado" });
  }

  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Body invalido" });
  }

  const user = await validateLocalPassword(parsed.data.email, parsed.data.password);
  if (!user) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  if (!user.isActive) {
    return res.status(403).json({ message: "Conta inativa" });
  }

  const token = signAuthToken({ id: user.id, email: user.email });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      nomeCompleto: user.nomeCompleto,
      role: user.role
    }
  });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: req.authUser });
});

export default router;
```

## 4.8 Criar servidor HTTP

Criar `backend/src/index.ts`:

```ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));
app.use("/api", authRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`API online na porta ${port}`);
});
```

## 5. Frontend - criacao completa

## 5.1 Inicializar frontend (React + Vite + TS)

Executar na raiz:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install firebase
```

## 5.2 Criar variaveis de ambiente frontend

Criar `frontend/.env`:

```env
VITE_API_URL=http://localhost:4000/api
VITE_AUTH_ENABLE_LOCAL_LOGIN=false

VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 5.3 Criar modulo Firebase client

Criar `frontend/src/lib/firebase.ts`:

```ts
import { initializeApp } from "firebase/app";
import { getAuth, OAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);

export function createMicrosoftProvider() {
  const provider = new OAuthProvider("microsoft.com");
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
```

## 5.4 Criar cliente API

Criar `frontend/src/lib/api.ts`:

```ts
export const AUTH_TOKEN_KEY = "smarter_hub_auth_token";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export async function apiRequest(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const headers = new Headers(options.headers || {});

  if (!headers.has("content-type") && options.body) {
    headers.set("content-type", "application/json");
  }

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || "Erro de API");
  }

  return data;
}
```

## 5.5 Criar contexto de autenticacao

Criar `frontend/src/auth/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { apiRequest, AUTH_TOKEN_KEY } from "../lib/api";
import { firebaseAuth, createMicrosoftProvider, isFirebaseConfigured } from "../lib/firebase";

type AuthUser = {
  id: number;
  email: string;
  nomeCompleto: string;
  role: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  loginMicrosoft: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const data = await apiRequest("/auth/me", { method: "GET" });
        if (!cancelled) setUser(data.user);
      } catch {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loginMicrosoft() {
    if (!isFirebaseConfigured) {
      throw new Error("Firebase nao configurado no frontend");
    }

    const popup = await signInWithPopup(firebaseAuth, createMicrosoftProvider());
    const idToken = await popup.user.getIdToken(true);
    const data = await apiRequest("/auth/microsoft", {
      method: "POST",
      body: JSON.stringify({ idToken })
    });

    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      loginMicrosoft,
      logout
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
```

## 5.6 Criar pagina principal com login

Substituir `frontend/src/App.tsx` por:

```tsx
import { useAuth } from "./auth/AuthContext";

function LoginScreen() {
  const { loginMicrosoft } = useAuth();

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>Entrar</h1>
      <button onClick={() => void loginMicrosoft()}>Entrar com Microsoft</button>
    </main>
  );
}

function HomeScreen() {
  const { user, logout } = useAuth();
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>Portal</h1>
      <p>Utilizador: {user?.nomeCompleto}</p>
      <p>Email: {user?.email}</p>
      <p>Role: {user?.role}</p>
      <button onClick={logout}>Sair</button>
    </main>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 24 }}>A carregar...</div>;
  if (!user) return <LoginScreen />;

  return <HomeScreen />;
}
```

## 5.7 Envolver aplicacao no provider

Substituir `frontend/src/main.tsx` por:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
```

## 6. Ordem exata para correr localmente

Em terminal 1 (backend):

```bash
cd backend
npm run dev
```

Em terminal 2 (frontend):

```bash
cd frontend
npm run dev
```

Abrir o frontend no browser (normalmente `http://localhost:5173`).

## 7. Configuracoes no Firebase e Microsoft (obrigatorio)

## 7.1 Firebase Console
1. Authentication -> Sign-in method -> ativar Microsoft.
2. Inserir Client ID e Client Secret do Azure App Registration.
3. Adicionar dominio do frontend em Authorized domains.

## 7.2 Azure App Registration
1. Criar app registration.
2. Definir redirect URI para valor pedido pelo Firebase Microsoft provider.
3. Criar client secret.
4. Copiar Application (client) ID + secret para Firebase.

## 8. Comportamento de provisionamento (o que configurar)

Para nao criar utilizador novo automaticamente:
1. Em `backend/.env`, usar `AUTH_MICROSOFT_AUTO_PROVISION=false`.
2. Pre-criar utilizadores na BD (mesmo email do Microsoft).

Para criar automaticamente no primeiro login:
1. Em `backend/.env`, usar `AUTH_MICROSOFT_AUTO_PROVISION=true`.
2. Definir role default em `AUTH_MICROSOFT_DEFAULT_ROLE`.

## 9. Checklist de teste (copiar e executar)

1. Login valido:
   - Clicar "Entrar com Microsoft".
   - Confirmar `POST /api/auth/microsoft` retorna 200.
   - Confirmar token salvo em `localStorage` com chave `smarter_hub_auth_token`.
   - Confirmar refresh da pagina mantem sessao via `GET /api/auth/me`.

2. Conta nao provisionada com auto-provision desligado:
   - Usar email que nao existe na BD.
   - Confirmar resposta 403 "Conta nao provisionada".

3. Dominio bloqueado:
   - Definir `MICROSOFT_ALLOWED_EMAIL_DOMAINS=empresa.com`.
   - Testar login com email de outro dominio.
   - Confirmar resposta 403 "Dominio de email nao autorizado".

4. Conta inativa:
   - Marcar utilizador `isActive=false` na BD.
   - Confirmar resposta 403 "Conta inativa".

## 10. Erros comuns e correcao rapida

1. Erro "Falha ao validar autenticacao Microsoft":
   - Service account mal configurada no backend.
   - Corrigir `FIREBASE_SERVICE_ACCOUNT_JSON`.

2. Popup abre e fecha sem login:
   - Provider Microsoft mal configurado no Firebase.
   - Rever Azure Client ID/Secret e redirect URI.

3. Erro CORS:
   - `FRONTEND_URL` no backend diferente do URL real do frontend.

4. Sempre deslogado apos refresh:
   - Token nao esta a ser salvo na chave certa.
   - Garantir uso de `smarter_hub_auth_token` e chamada `/auth/me` no bootstrap.

## 11. Entrega para a pessoa implementar no projeto dela

Se fores enviar isto para outra pessoa, diz para seguir nesta ordem:
1. Copiar secoes 4 e 5 exatamente.
2. Ajustar apenas:
   - variaveis `.env`
   - camada de BD (`findUserByEmail`, `createUser`, `findUserById`)
3. Validar com secao 9.

Se fizer assim, consegue reproduzir o login Microsoft com sessao propria da app, sem depender deste repositorio.