# Smarter Hub Backend (PostgreSQL)

API Node.js + TypeScript + Express + Prisma com PostgreSQL.

## 1) Configuracao

1. Copia `.env.example` para `.env`.
2. Ajusta `DATABASE_URL` se necessario.

### O que é o External Database URL?

No Render, o Postgres cria duas ligações principais:

- `Internal Database URL`: para serviços dentro da rede privada do Render.
- `External Database URL`: para ligares a partir de fora do Render, por exemplo no painel de variáveis do teu Web Service ou para testes locais.

Para este projeto, vais usar o `External Database URL` no serviço web do backend, no campo `DATABASE_URL`.

### O que fazer antes de ir para o Render

1. Confirmar que o backend funciona localmente com uma base de dados válida.
2. Escolher onde a base de dados vai viver: local com PostgreSQL ou alojada no Render.
3. Se fores usar Render, criar primeiro a base de dados PostgreSQL e depois apontar o backend para o `External Database URL`.
4. Definir o `FRONTEND_URL` com o domínio final do Netlify depois do deploy do frontend.

## 2) Subir PostgreSQL local (Docker)

```bash
npm run db:up
```

Se aparecer `'docker' is not recognized`, o Docker Desktop nao esta instalado/ativo no Windows.
Alternativas:

1. Instalar Docker Desktop.
2. Usar PostgreSQL local (servico nativo) e ajustar `DATABASE_URL`.
3. Usar PostgreSQL gerido (Render, Neon, Supabase) e apontar `DATABASE_URL`.

Se usares o Render, nem precisas de Docker local para produção. O `render.yaml` já cria a base de dados e liga o backend a ela.

## 3) Criar schema no banco

```bash
npm run prisma:push
npm run db:seed
```

Credenciais seed criadas automaticamente:

- username: `patrick`
- password: `1212`

## 4) Correr API

```bash
npm run dev
```

API em `http://localhost:4000`.

## Rotas disponiveis

- `GET /health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users`
- `POST /api/users`
- `GET /api/profile/me`
- `PUT /api/profile/me`
- `GET /api/notifications/me`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`
