# Code Review — Portal do Colaborador

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

## Arquitectura backend

Neste momento não há arquitectura de camadas — toda a lógica está dentro dos route handlers. Validação, regras de negócio, queries à BD, notificações, geração de Excel/PDF, tudo misturado nos ficheiros de rotas. Isto acontece em todas as rotas, não é um caso isolado — o `vacations.ts` com 3.660 linhas é o exemplo mais extremo mas o padrão repete-se no `users.ts` (3.415 linhas), `profile.ts`, `hour-bank.ts`, etc.

O backend devia ter separação em camadas:

- **Routes** — só recebem o request HTTP e devolvem a response. Sem lógica de negócio.
- **Controllers** — orquestram: chamam os services certos, formatam a resposta.
- **Services** — regras de negócio puras. Sem dependência do Express, sem dependência directa do Prisma. Testáveis isoladamente.
- **Repositories** — queries à base de dados. Único sítio que fala com o Prisma.

Isto resolve três problemas de uma vez: testabilidade (testas regras de negócio sem simular o Express), reutilização (vários endpoints podem usar o mesmo service), e manutenção (cada ficheiro tem 100-300 linhas com uma responsabilidade clara).

--

## Arquitectura frontend

O mesmo problema no frontend. As páginas são monólitos — o `CollaboratorsPage` tem 4.279 linhas, o `VacationsPage` tem 3.344, o `ProfilePage` tem 2.196. Cada página é uma aplicação inteira dentro de um componente só.

O frontend devia ter:

- **Pages** — layout e composição de componentes. Pouca lógica, orquestra os componentes certos.
- **Components** — pequenos, focados, uma responsabilidade cada. Um formulário é um componente, um calendário é outro, uma tabela é outro.
- **Hooks** — lógica reutilizável extraída dos componentes (auth headers, data fetching, form state).
- **State management separado** — neste momento o `context.tsx` (587 linhas) guarda auth, perfil, notificações e permissões tudo junto. Uma notificação marcada como lida re-renderiza a app toda. Devia estar separado em providers independentes, e o data fetching devia usar algo como React Query em vez de ser manual.

Há também duplicação significativa — o `STORAGE_TOKEN_KEY` e `getAuthHeaders()` estão replicados em 5+ páginas, as definições de campos de perfil repetidas em 4 ficheiros, o `SearchableDropdown` implementado duas vezes. Tudo reflexo de não haver uma camada partilhada bem definida.

--

## Segurança

A autenticação está bem feita — JWT, Firebase, Microsoft, o `requireAuth` funciona.

O problema é que autenticação não é o mesmo que autorização. Os endpoints verificam que o utilizador está autenticado mas em muitos casos não verificam se o recurso pertence a esse utilizador. Exemplo: o `DELETE /vacations/:id` — qualquer utilizador autenticado pode apagar férias de outros se souber o ID. Mas isto não é um problema isolado desse endpoint, é um padrão que se repete — falta ownership check de forma geral nos endpoints de escrita (PUT, PATCH, DELETE) de férias, perfil, banco de horas e formações.

O mesmo nos GETs de dados pessoais — não há filtragem por ownership. Cada colaborador devia ver só os seus dados, managers verem só a equipa, e dados sensíveis (IBAN, NIF, morada) estarem restritos ao próprio e admin/RH.

Outros pontos de segurança:

- O JWT secret tem um fallback hardcoded para `"smarter-hub-dev-secret"` — se o env var falhar, a app arranca com um secret público. Devia dar throw.
- Utilizadores criados via auto-provisioning recebem todos a mesma password (`pola123`). Não precisam de password local.
- Sem Helmet — faltam security headers básicos.
- Uploads aceitam qualquer tipo de ficheiro sem whitelist, e o directório `/uploads` é servido sem autenticação.
- Sem rate limiting nos endpoints de auth — vulnerável a brute force.

--

## Outros pontos

- **Paginação** — os endpoints de listagem fazem `findMany` sem limites. Com dados reais carrega tudo para memória.
- **Transacções** — há operações multi-step (criar féria + notificação, aprovar + actualizar estado) fora de transacção. Se falha a meio fica com dados inconsistentes.
- **Queries em loop** — em vários sítios há queries à BD dentro de loops (feriados por ano, verificação de hierarquia por utilizador). Com volume vai ser lento.
- **Validação de inputs** — query params como `year` ou `userIds` não são validados antes de ir para a query (NaN, formatos inválidos).
- **CSS** — 268KB num ficheiro só (`redesign.css`). Difícil de manter. Considerar partir em CSS Modules por componente ou migrar para Tailwind.
- **Testes** — os testes de "integração" mockam o Prisma todo, na prática são unit tests dos route handlers. Não testam interacção real com a BD. O vitest nem corre no estado actual por permissões no binário.
- **Error handling** — inconsistente. Alguns endpoints retornam 500 para situações que deviam ser 400 ou 403. Considerar error boundaries no React para evitar que um erro numa página crashe a app toda.
