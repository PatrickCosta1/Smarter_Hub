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

## 3.1) Aplicar migrations em ambiente real (Render/Prod)

Para produção, usa migrations versionadas em vez de `prisma:push`:

```bash
npm run prisma:generate
npx prisma migrate deploy
```

Notas:

- `migrate deploy` aplica apenas migrations já existentes na pasta `prisma/migrations`.
- Para este fluxo de admissão, garante que a migration `20260507_employee_admissions` foi aplicada.
- Executa este passo no deploy do backend antes de subir a aplicação (ou como release command).

Credenciais seed criadas automaticamente:

- username: `patrick`
- password: `1212`

## 4) Correr API

```bash
npm run dev
```

API em `http://localhost:4000`.

## 5) Envio de email com Azure App Registration (Microsoft Graph)

O backend envia emails através do Microsoft Graph com `client credentials` (sem SMTP).

### 5.1) Passo a passo no Azure (Microsoft Entra)

1. Entrar no portal Azure:
	- Ir para `Microsoft Entra ID`.

2. Criar App Registration:
	- `App registrations` -> `New registration`.
	- Name: `smarter-hub-mailer` (ou equivalente).
	- Supported account types: `Accounts in this organizational directory only`.
	- `Register`.

3. Guardar IDs:
	- No Overview da app, copiar:
	  - `Application (client) ID`
	  - `Directory (tenant) ID`

4. Criar Client Secret:
	- `Certificates & secrets` -> `New client secret`.
	- Description: `smarter-hub-prod`.
	- Expiration: conforme política da empresa.
	- Copiar o valor do secret (mostrar apenas uma vez).

5. Dar permissões Graph (Application):
	- `API permissions` -> `Add a permission` -> `Microsoft Graph` -> `Application permissions`.
	- Adicionar: `Mail.Send`.
	- Clicar `Grant admin consent for <tenant>`.
	- Confirmar que aparece `Granted for <tenant>`.

6. Definir mailbox emissora:
	- Usar uma mailbox real da organização (ex.: `no-reply@empresa.com`).
	- Esta mailbox será o `AZURE_MAIL_SENDER_USER`.

### 5.2) Passo opcional recomendado (limitar a app a uma mailbox)

Sem restrição, a permissão `Mail.Send` application pode enviar em nome de várias mailboxes.
Para limitar ao `no-reply`, configurar Application Access Policy no Exchange Online PowerShell.

Exemplo (executado por admin Exchange):

```powershell
Connect-ExchangeOnline
New-ApplicationAccessPolicy -AppId <APP_CLIENT_ID> -PolicyScopeGroupId no-reply-mail-enabled-group@empresa.com -AccessRight RestrictAccess -Description "Smarter Hub mail sender"
Test-ApplicationAccessPolicy -Identity no-reply@empresa.com -AppId <APP_CLIENT_ID>
```

### 5.3) Variáveis de ambiente no backend (Render/local)

Definir no serviço backend:

- `AZURE_MAIL_TENANT_ID` = Directory (tenant) ID
- `AZURE_MAIL_CLIENT_ID` = Application (client) ID
- `AZURE_MAIL_CLIENT_SECRET` = Client Secret value
- `AZURE_MAIL_SENDER_USER` = mailbox emissora (UPN/email, ex.: `no-reply@empresa.com`)

Exemplo:

```env
AZURE_MAIL_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_MAIL_CLIENT_ID=yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
AZURE_MAIL_CLIENT_SECRET=********
AZURE_MAIL_SENDER_USER=no-reply@empresa.com
```

### 5.4) Como validar rapidamente

1. Reiniciar backend com variáveis definidas.
2. Criar um novo pedido de admissão.
3. Verificar:
	- backend não escreve `[EMAIL_DISABLED]`.
	- colaborador recebe email de convite.

Se falhar com `403`/`401` no Graph:

- confirmar `Mail.Send` como `Application permission` (não Delegated);
- confirmar `Admin consent` aplicado;
- confirmar `AZURE_MAIL_SENDER_USER` existente no tenant;
- confirmar client secret válido e não expirado.

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
