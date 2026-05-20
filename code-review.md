# Code Review — Portal do Colaborador

## Estado Atual (20/05/2026)

### Já foi resolvido desde a revisão inicial

- Segurança base reforçada no backend:
	- `JWT_SECRET` obrigatório no arranque (sem fallback inseguro)
	- `helmet` ativo
	- rate limiting global de escrita e específico para auth
	- upload com whitelist de mime types/extensões e limite de tamanho
- Auto-provisioning deixou de usar password fixa curta; agora usa password forte aleatória se env não estiver definida com mínimo de segurança.
- Alguns fluxos críticos (ex.: cancelamento de férias) já usam transação (`prisma.$transaction`).
- Evolução funcional full-stack recente foi integrada e validada em build (incluindo novo campo `criminalRecordUrl`).

### Ainda crítico / estrutural (continua por fazer)

- Não existe arquitetura em camadas backend (routes continuam com lógica de negócio, queries e regras misturadas).
- Frontend continua monolítico com páginas muito grandes e lógica acoplada ao componente.
- Autorização por ownership ainda incompleta em vários endpoints (há melhorias pontuais, mas não cobertura sistemática).
- `/uploads` continua servido de forma pública (sem proteção por autorização de acesso ao ficheiro).
- Testes continuam maioritariamente orientados a cenários mockados, sem cobertura real de integração DB-endpoints.

### Métricas atuais dos principais monólitos

- `src/pages/CollaboratorsPage.tsx`: 4536 linhas
- `src/pages/VacationsPage.tsx`: 4778 linhas
- `src/pages/ProfilePage.tsx`: 2416 linhas
- `backend/src/routes/vacations.ts`: 4030 linhas
- `backend/src/routes/users.ts`: 4470 linhas

## O que está bem

- Schema Prisma sólido — relações correctas, enums, indexes nos sítios certos
- Lógica de negócio de férias PT/BR complexa e correcta
- Validação com Zod no backend
- Sistema de permissões RBAC granular
- Componentes base de UI (Button, Modal, Badge) limpos
- Deploy funcional
- TypeScript e lazy loading em todo o projecto

O core de lógica de negócio é está feita. Os problemas são de estrutura à volta desse core.

--

## Progresso de Reestruturação Já Iniciado

Primeiro passo de redução de duplicação no frontend já aplicado:

- Centralização da gestão de token auth em módulo único (`src/portal/auth-storage.ts`).
- `App.tsx`, `PortalLayout.tsx` e `portal/context.tsx` passaram a reutilizar esse módulo.

Impacto: elimina string literal duplicada e reduz risco de divergência em leituras/escritas de sessão.

Primeiro passo de extração em camadas no backend já aplicado:

- `DELETE /vacations/:id` deixou de conter lógica de atualização transacional inline.
- Regra foi extraída para `service` (`backend/src/services/vacations/cancel-vacation.service.ts`).
- Acesso a dados foi extraído para `repository` (`backend/src/repositories/vacations.repository.ts`).

Impacto: inicia padrão `route -> service -> repository` sem alterar comportamento funcional.

Segundo passo backend concluído:

- `POST /vacations/sell-days` também foi extraído para camada de serviço e repositório.
- Nova orquestração no service: `backend/src/services/vacations/sell-vacation-days.service.ts`.
- Consultas/updates isolados no repository: `backend/src/repositories/vacations.repository.ts`.

Impacto: consolida o padrão incremental de migração por endpoint e reduz lógica de negócio inline dentro das rotas.

Terceiro passo backend concluído:

- `PUT /vacations/:id` começou a migração para camada de dados.
- Consultas de leitura principais (pedido versionável, perfil de regras, versão máxima, dados do requerente e nome de equipa) foram movidas para repository.
- A rota mantém validação e orquestração de negócio, mas já com menor acoplamento direto ao Prisma.

Impacto: reduz risco da migração do endpoint mais crítico, permitindo extração futura do bloco transacional para service/repository por etapas.

Quarto passo backend concluído:

- Bloco transacional de versionamento do `PUT /vacations/:id` extraído para repository (`createVacationVersionTransaction`).
- A rota passou a delegar persistência de cancelamento da versão anterior, criação da nova versão e criação das aprovações.
- Regras de negócio e validações permanecem na rota por enquanto, mas já desacopladas da persistência transacional.

Impacto: maior redução de acoplamento no endpoint mais sensível, com mudança incremental e segura.

Quinto passo backend concluído:

- Criado service de orquestração para versionamento (`backend/src/services/vacations/version-vacation-request.service.ts`).
- `PUT /vacations/:id` agora delega a criação da nova versão para o service, em vez de chamar o repository transacional diretamente.

Impacto: rota mais fina e caminho claro para mover progressivamente validações/regras também para service.

Sexto passo backend concluído:

- Fluxo de crédito de saldo (`POST /vacations/assign-balance-days` e `POST /vacations/assign-direct`) extraído para service dedicado (`backend/src/services/vacations/assign-vacation-balance-credit.service.ts`).
- Persistência e notificações por colaborador movidas para repository (`findVacationBalanceCreditTargetUsers` e `createVacationBalanceCreditsWithNotifications` em `backend/src/repositories/vacations.repository.ts`).
- A rota passou a focar validação HTTP/permissões e mapeamento de resposta, delegando regras de seleção e execução transacional ao service/repository.

Impacto: reduz lógica de negócio inline na rota de férias e consolida mais um endpoint no padrão `route -> service -> repository` sem alteração funcional.

Sétimo passo backend concluído:

- Fechado o acesso público direto a `/uploads` em `backend/src/index.ts`, substituindo o `express.static` por router dedicado protegido (`uploadsRouter`).
- Implementado controlo de acesso por escopo em `backend/src/routes/files.ts`: ficheiros de perfil exigem autenticação e validação de ownership/permissão; relatórios de banco de horas exigem permissões específicas (`view_hours_bank`/`manage_hours_bank`).
- Mantido fluxo público de admissões com proteção por token de submissão: links de upload de admissão passam a incluir `admissionToken` e o download valida token + associação do ficheiro ao `personalData` da admissão.

Impacto: remove exposição aberta de ficheiros sensíveis e aplica autorização explícita na camada backend de ficheiros.

Progresso adicional frontend:

- Centralização de token de sessão estendida para páginas críticas (`VacationsPage`, `CollaboratorsPage`, `ProfilePage`) via `portal/auth-storage`.
- Centralização também aplicada em `TrainingsPage`, `RHApprovalsPage` e `HomePage`.
- Centralização concluída nas restantes páginas principais (`AccountAccessPage`, `AdminPage`, `AdmissionsPage`, `ManagerTeamsPage`, `HourBankPage`, `DashboardPage`, `PermissionsPage`, `WellbeingPage`, `CareerPlanPage`).

Impacto: menos duplicação, menor risco de inconsistência de sessão e base pronta para extração de hooks comuns.

Decomposição iniciada em página monolítica:

- Bloco de filtros/toolbar da listagem de colaboradores foi extraído de `CollaboratorsPage` para componente dedicado (`src/components/collaborators/CollaboratorsFilterBar.tsx`).
- A página principal passou a orquestrar apenas estados/handlers e delegar renderização do bloco extraído.
- Bloco de ações do cabeçalho (novo colaborador/importar/exportar) também foi extraído para `src/components/collaborators/CollaboratorsHeaderActions.tsx`.
- Bloco de paginação/resultados da listagem extraído para `src/components/collaborators/CollaboratorsPagination.tsx`.
- Células complexas da tabela também extraídas: equipa (`src/components/collaborators/CollaboratorTeamCell.tsx`) e ações por linha (`src/components/collaborators/CollaboratorsRowActions.tsx`).
- Modal de exportação da ficha extraído para `src/components/collaborators/CollaboratorExportModal.tsx`.
- Modal de importação em massa extraído para `src/components/collaborators/CollaboratorsImportModal.tsx`.
- Modal de criação de colaborador extraído para `src/components/collaborators/CollaboratorCreateModal.tsx`.
- Secção `Conta e acesso` do detalhe do colaborador extraída para `src/components/collaborators/CollaboratorDetailsAccountSection.tsx`.
- Estrutura reutilizável das secções de perfil (`identificação/contactos/fiscal/emergência/contrato`) extraída para `src/components/collaborators/CollaboratorDetailsProfileSection.tsx`.
- Subnavegação da ficha (abas + contadores de campos em falta) extraída para `src/components/collaborators/CollaboratorDetailsFichaSubnav.tsx`.
- Cabeçalho visual da ficha (avatar, identidade, badges, progresso e atalhos de opções) extraído para `src/components/collaborators/CollaboratorDetailsFichaHeader.tsx`.
- Tabs principais do modal de detalhe (Ficha/Permissões/Estado) extraídas para `src/components/collaborators/CollaboratorDetailsTabs.tsx`.
- Footer do modal de detalhe (Fechar + Guardar ficha condicional) extraído para `src/components/collaborators/CollaboratorDetailsModalFooter.tsx`.
- Shell do modal de detalhe (tabs + troca entre conteúdos de ficha/permissões/estado) extraído para `src/components/collaborators/CollaboratorDetailsModalShell.tsx`.
- Conteúdo da aba `Estado` (cards, ação de ativação/desativação e histórico de cargo) extraído para `src/components/collaborators/CollaboratorDetailsStatusPanel.tsx`.
- Conteúdo da aba `Permissões` (acesso total, categorias, listagem e editor de restrições) extraído para `src/components/collaborators/CollaboratorDetailsPermissionsPanel.tsx`.
- Modal de criação de opções de perfil (cargo/função) extraído para `src/components/collaborators/CollaboratorProfileOptionModal.tsx`.
- Modal de confirmação de ativação/desativação extraído para `src/components/collaborators/CollaboratorActiveConfirmModal.tsx`.
- Modal de confirmação de mudança de país extraído para `src/components/collaborators/CollaboratorCountryChangeModal.tsx`.
- Conteúdo principal da aba `Ficha` (header, subnav, conta e secções de perfil) consolidado em `src/components/collaborators/CollaboratorDetailsFichaPanel.tsx`.
- Painel do menu de ações rápidas por linha da tabela extraído para `src/components/collaborators/CollaboratorsActionsMenuPanel.tsx`.
- Composição completa do modal de detalhe (container + tabs + conteúdos por aba + footer) extraída para `src/components/collaborators/CollaboratorDetailsModal.tsx`.

Impacto: primeiro corte estrutural real numa página >4k linhas, criando padrão para extrair próximos blocos (tabela, ações e modais).

--

## Arquitectura backend

Neste momento não há arquitectura de camadas — toda a lógica está dentro dos route handlers. Validação, regras de negócio, queries à BD, notificações, geração de Excel/PDF, tudo misturado nos ficheiros de rotas. Isto acontece em todas as rotas, não é um caso isolado — o `vacations.ts` com 3.660 linhas é o exemplo mais extremo mas o padrão repete-se no `users.ts` (3.415 linhas), `profile.ts`, `hour-bank.ts`, etc.

O backend devia ter separação em camadas:

- **Routes** — só recebem o request HTTP e devolvem a response. Sem lógica de negócio.
- **Controllers** — orquestram: chamam os services certos, formatam a resposta.
- **Services** — regras de negócio puras. Sem dependência do Express, sem dependência directa do Prisma. Testáveis isoladamente.
- **Repositories** — queries à base de dados. Único sítio que fala com o Prisma.

Isto resolve três problemas de uma vez: testabilidade (testas regras de negócio sem simular o Express), reutilização (vários endpoints podem usar o mesmo service), e manutenção (cada ficheiro tem 100-300 linhas com uma responsabilidade clara).

Estado: **não iniciado de forma estruturada** (continua prioridade alta).

--

## Arquitectura frontend

O mesmo problema no frontend. As páginas são monólitos — o `CollaboratorsPage` tem 4.279 linhas, o `VacationsPage` tem 3.344, o `ProfilePage` tem 2.196. Cada página é uma aplicação inteira dentro de um componente só.

O frontend devia ter:

- **Pages** — layout e composição de componentes. Pouca lógica, orquestra os componentes certos.
- **Components** — pequenos, focados, uma responsabilidade cada. Um formulário é um componente, um calendário é outro, uma tabela é outro.
- **Hooks** — lógica reutilizável extraída dos componentes (auth headers, data fetching, form state).
- **State management separado** — neste momento o `context.tsx` (587 linhas) guarda auth, perfil, notificações e permissões tudo junto. Uma notificação marcada como lida re-renderiza a app toda. Devia estar separado em providers independentes, e o data fetching devia usar algo como React Query em vez de ser manual.

Há também duplicação significativa — o `STORAGE_TOKEN_KEY` e `getAuthHeaders()` estão replicados em 5+ páginas, as definições de campos de perfil repetidas em 4 ficheiros, o `SearchableDropdown` implementado duas vezes. Tudo reflexo de não haver uma camada partilhada bem definida.

Estado: **iniciado parcialmente** (token centralizado), mas sem decomposição real das páginas grandes.

--

## Segurança

A autenticação está bem feita — JWT, Firebase, Microsoft, o `requireAuth` funciona.

O problema é que autenticação não é o mesmo que autorização. Os endpoints verificam que o utilizador está autenticado mas em muitos casos não verificam se o recurso pertence a esse utilizador. Exemplo: o `DELETE /vacations/:id` — qualquer utilizador autenticado pode apagar férias de outros se souber o ID. Mas isto não é um problema isolado desse endpoint, é um padrão que se repete — falta ownership check de forma geral nos endpoints de escrita (PUT, PATCH, DELETE) de férias, perfil, banco de horas e formações.

O mesmo nos GETs de dados pessoais — não há filtragem por ownership. Cada colaborador devia ver só os seus dados, managers verem só a equipa, e dados sensíveis (IBAN, NIF, morada) estarem restritos ao próprio e admin/RH.

Outros pontos de segurança:

- ✅ JWT secret obrigatório (sem fallback inseguro)
- ✅ Provision password reforçada (sem password fixa fraca por defeito)
- ✅ Helmet ativo
- ✅ Rate limiting ativo em auth
- ✅ Upload com whitelist e limite de tamanho
- ⏳ `/uploads` ainda público (falta servir ficheiros por endpoint autenticado/autorizado)
- ⏳ Ownership checks ainda não sistematizados em todos os endpoints de escrita/leitura sensível

--

## Outros pontos

- **Paginação** — os endpoints de listagem fazem `findMany` sem limites. Com dados reais carrega tudo para memória.
- **Transacções** — há operações multi-step (criar féria + notificação, aprovar + actualizar estado) fora de transacção. Se falha a meio fica com dados inconsistentes.
- **Queries em loop** — em vários sítios há queries à BD dentro de loops (feriados por ano, verificação de hierarquia por utilizador). Com volume vai ser lento.
- **Validação de inputs** — query params como `year` ou `userIds` não são validados antes de ir para a query (NaN, formatos inválidos).
- **CSS** — 268KB num ficheiro só (`redesign.css`). Difícil de manter. Considerar partir em CSS Modules por componente ou migrar para Tailwind.
- **Testes** — os testes de "integração" mockam o Prisma todo, na prática são unit tests dos route handlers. Não testam interacção real com a BD. O vitest nem corre no estado actual por permissões no binário.
- **Error handling** — inconsistente. Alguns endpoints retornam 500 para situações que deviam ser 400 ou 403. Considerar error boundaries no React para evitar que um erro numa página crashe a app toda.

--

## Próximas Fases (execução incremental)

### Fase 1 — Fundacional (curta, 2-4 dias)

- Criar esqueleto backend por feature (`routes -> controllers -> services -> repositories`) sem mexer em comportamento.
- Migrar primeiro um endpoint pequeno de `users` e um de `vacations` para validar padrão.
- Introduzir `src/portal/session.ts` ou equivalente para unificar restante lógica de sessão frontend (além do token).

### Fase 2 — Segurança/Autorização (2-3 dias)

- Implementar helpers centralizados de ownership/scope por role (self, manager-team, admin/rh).
- Aplicar esses helpers em PUT/PATCH/DELETE críticos (`vacations`, `profile`, `hour-bank`, `trainings`).
- Fechar acesso público direto a `/uploads` e substituir por endpoint autenticado com verificação de permissão.

### Fase 3 — Quebra de Monólitos Frontend (4-7 dias)

- Partir `CollaboratorsPage` em componentes por domínio (filtros, tabela, modal, upload).
- Partir `VacationsPage` em submódulos (calendário, pedidos, aprovações, exportação).
- Extrair hooks reutilizáveis de fetch/estado (`useAuthHeaders`, `usePaginatedFetch`, etc.).

### Fase 4 — Qualidade técnica

- Criar testes reais de integração backend com DB de teste isolada.
- Normalizar tratamento de erros API (400/403/404/409/500) via helper comum.
- Revisão de queries em loop e paginação forte nos list endpoints de maior volume.
