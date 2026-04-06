# Guia Completo do Sistema Atual (Base para Reengenharia em React)

Data: 06/04/2026

## 1. Objetivo deste guia

Este documento descreve, de forma completa e prática, o estado atual da aplicação PHP para servir de base à reconstrução em React para ambiente real de produção.

Inclui:
- Arquitetura e organização do projeto.
- Perfis e permissões efetivamente usadas no código.
- Fluxos ponta-a-ponta por perfil.
- Funcionalidades implementadas e funcionalidades incompletas.
- Regras de negócio e modelo de dados inferido a partir das queries.
- Configuração atual e gaps de produção.
- Mapa de migração para React (frontend) + API backend.

## 2. Arquitetura atual

### 2.1 Camadas

- UI (apresentação): `UI/`
  - Páginas PHP por perfil (`Admin`, `RH`, `Coordenador`, `Colaborador`, `Convidado`, `Comuns`).
  - Controle de acesso por sessão em quase todas as páginas.
- BLL (lógica de negócio): `BLL/`
  - Classes manager por domínio/perfil.
- DAL (acesso a dados): `DAL/`
  - Queries SQL com PDO.
- Assets: `assets/`
  - CSS por perfil e JS simples.
- Uploads: `Uploads/`
  - Ficheiros de comprovativos e anexos.

### 2.2 Entry point

- `index.php` faz redirect para `UI/login.php`.
- Problema confirmado: `UI/login.php` não existe. O login real está em `UI/Comuns/login.php`.

### 2.3 Ligação à base de dados

Arquivo: `DAL/Database.php`
- Host: `localhost`
- DB: `lsis1_grupo7`
- User: `root`
- Password: vazio
- Charset: `utf8mb4`
- PDO com `ERRMODE_EXCEPTION` e `FETCH_ASSOC`

## 3. Inventário real de ecrãs e módulos

## 3.1 Comuns

### Login
- UI: `UI/Comuns/login.php`
- BLL: `BLL/Comuns/BLL_login.php`
- DAL: `DAL/Comuns/DAL_login.php`

Implementado:
- Form de login.
- Validação mínima de username/password.
- Sessão: `user_id`, `username`, `profile`, `name`, `last_login`.
- Redirecionamento por perfil.

Observações:
- Password validada em texto simples (`$password === $user['password']`).
- Script incluído como `../../assets/login.js`, mas o ficheiro existente é `assets/script.js`.
- Existe referência a `forgot_password.php` (não encontrado).

### Perfil
- UI: `UI/Comuns/perfil.php`
- BLL: `BLL/Comuns/BLL_perfil.php`
- DAL: `DAL/Comuns/DAL_perfil.php`

Implementado parcialmente:
- Carrega dados do utilizador.
- Renderiza formulário de edição.

Problema crítico:
- O `POST` não é processado na UI atual, logo a edição não é persistida nesta página.
- A função `updateUserProfile` existe na BLL/DAL, mas não está ligada ao submit da UI.

### Notificações + Mensagens recebidas
- UI: `UI/Comuns/notificacoes.php`
- BLL notif: `BLL/Comuns/BLL_notificacoes.php`
- DAL notif: `DAL/Comuns/DAL_notificacoes.php`
- BLL mensagens: `BLL/Comuns/BLL_mensagens.php`
- DAL mensagens: `DAL/Comuns/DAL_mensagens.php`

Implementado:
- Lista notificações por utilizador.
- Lista mensagens recebidas (join com remetente).
- Marcação de notificação como lida via query string.

Observações:
- A página mistura dados reais com blocos estáticos hardcoded de notificações.
- Link de anexo usa caminho `../Uploads/Mensagens/...` a partir de `UI/Comuns`, potencialmente incorreto para localização real.

### Enviar mensagem
- Handler: `UI/Comuns/enviar_mensagem.php`

Implementado:
- Recebe destinatário, assunto, mensagem e anexo.
- Converte `destinatario_id` (colaborador) em `utilizador_id`.
- Grava em tabela `mensagens`.

Observações:
- Fluxo está acoplado ao contexto do Coordenador (redirect final para `../Coordenador/equipa.php`).

### Logout / Erro
- `UI/Comuns/logout.php`: destrói sessão e redireciona para `login.php` (na pasta Comuns).
- `UI/Comuns/erro.php`: página genérica de acesso negado.

## 3.2 Convidado

### Dashboard convidado
- UI: `UI/Convidado/dashboard_convidado.php`
- BLL: `BLL/Convidado/BLL_dashboard_convidado.php`
- DAL: `DAL/Convidado/DAL_dashboard_convidado.php`

Implementado:
- Mensagem de boas-vindas e link para onboarding.

Problema:
- Um link aponta para `onboarding_convidado.html` (ficheiro não encontrado), embora exista `onboarding_convidado.php`.

### Onboarding convidado
- UI: `UI/Convidado/onboarding_convidado.php`
- BLL: `BLL/Convidado/BLL_onboarding_convidado.php`
- DAL: `DAL/Convidado/DAL_onboarding_convidado.php`

Implementado parcialmente:
- Carrega dados atuais do colaborador.
- Renderiza formulário com campos básicos.

Problema crítico:
- Form não define processamento `POST` com persistência.
- Ou seja, onboarding está visualmente pronto, mas não concluído funcionalmente.

## 3.3 Colaborador

### Página inicial colaborador
- UI: `UI/Colaborador/pagina_inicial_colaborador.php`
- BLL: `BLL/Colaborador/BLL_dashboard_colaborador.php`
- DAL: `DAL/Colaborador/DAL_dashboard_colaborador.php`

Implementado:
- Saudação e navegação.
- Carrossel visual com imagens.

Observações:
- Dropdown aponta para `beneficios.php`, `ferias.php`, `formacoes.php`, `recibos.php` (ficheiros não encontrados).
- Botões de atalho incluem links `#` (sem fluxo backend).

### Dashboard colaborador
- UI: `UI/Colaborador/dashboard_colaborador.php`

Estado:
- Placeholder: texto "A CONCLUIR".

### Ficha do colaborador
- UI: `UI/Colaborador/ficha_colaborador.php`
- BLL: `BLL/Colaborador/BLL_ficha_colaborador.php`
- DAL: `DAL/Colaborador/DAL_ficha_colaborador.php`

Implementado:
- Carregamento de ficha por `utilizador_id` (ou por `id` do colaborador em contexto RH/Admin/Coord).
- Form grande com muitos campos pessoais, fiscais, emergência e contratuais.
- Upload de comprovativos para `Uploads/comprovativos/`.
- Atualização dinâmica de colunas via DAL.

Observações importantes:
- A DAL atualiza qualquer campo vindo do formulário (sem allowlist estrita no servidor).
- Há regras de edição no front (readonly/disabled), mas confiança principal está na UI.
- Existe comentário sobre validação de equipa para coordenador, mas validação robusta não está implementada.

## 3.4 Coordenador

### Página inicial
- UI: `UI/Coordenador/pagina_inicial_coordenador.php`
- BLL: `BLL/Coordenador/BLL_dashboard_coordenador.php`
- DAL: `DAL/Coordenador/DAL_dashboard_coordenador.php`

Implementado:
- Acesso à equipa, dashboard e relatórios.

Observações:
- Dropdown contém links para funcionalidades não existentes (`beneficios.php`, etc).

### Dashboard coordenador
- UI: `UI/Coordenador/dashboard_coordenador.php`
- BLL/DAL: mesmo módulo de dashboard

Implementado:
- Gráficos de:
  - pessoas por equipa
  - idade média por equipa
  - distribuição por nível hierárquico/cargo
  - tempo de empresa
- Usa CanvasJS + simple-statistics.

### Equipa
- UI: `UI/Coordenador/equipa.php`

Implementado:
- Lista membros da equipa.
- Link para abrir ficha de cada colaborador.
- Modal para enviar mensagem com anexo.

Problema relevante:
- No topo da página usa variável `$equipas` sem garantir inicialização local.

### Relatórios da equipa
- UI: `UI/Coordenador/relatorios_equipa.php`

Estado:
- Estrutura de relatório com tabelas e botões "Ver" ainda em modo estático/placeholder.

## 3.5 RH

### Página inicial RH
- UI: `UI/RH/pagina_inicial_RH.php`
- BLL: `BLL/RH/BLL_dashboard_rh.php`
- DAL: `DAL/RH/DAL_dashboard_rh.php`

Implementado:
- Acesso aos módulos operacionais RH.

Observação:
- Gating de acesso está definido só para perfil `rh`, embora o menu tenha ramificação para `admin` (ramo praticamente inacessível nesta página).

### Colaboradores (gestão)
- UI: `UI/RH/colaboradores_gerir.php`
- BLL: `BLL/RH/BLL_colaboradores_gerir.php`
- DAL: `DAL/RH/DAL_colaboradores_gerir.php`

Implementado:
- Listagem com joins: nome, username, email, perfil, cargo, equipa, estado.
- Link "Ver" abre ficha completa.
- "Adicionar novo colaborador".

Observações:
- Botão "Remover" está em `#` (sem implementação efetiva).

### Novo colaborador
- UI: `UI/RH/colaborador_novo.php`

Implementado:
- Cria utilizador + colaborador.
- Mapeia cargo para `perfil_id` e `nivel_hierarquico`.

Lógica de mapeamento (no código):
- colaborador -> perfil_id 2
- coordenador -> perfil_id 3
- rh -> perfil_id 4
- admin -> perfil_id 5

### Equipas
- UI: `UI/RH/equipas.php`
- BLL: `BLL/RH/BLL_equipas.php`
- DAL: `DAL/RH/DAL_equipas.php`

Implementado:
- Listagem de equipas com coordenador e nº de membros.
- Criação de nova equipa em página própria.

Observações:
- Link "Ver" aponta para `equipa.php?id=...` na pasta RH, mas este ficheiro não existe.
- Botão "Remover" está em `#`.

### Nova equipa
- UI: `UI/RH/equipa_nova.php`

Implementado:
- Seleção de coordenador e membros.
- Criação com transação na DAL.

### Relatórios RH
- UI: `UI/RH/relatorios.php`
- BLL/DAL: `BLL/RH/BLL_relatorios.php`, `DAL/RH/DAL_relatorios.php`

Implementado:
- Indicadores globais:
  - total colaboradores
  - ativos
  - inativos
  - total equipas

Observações:
- Vários cards de relatório ainda são links placeholder (`#`).

### Exportação
- UI: `UI/RH/exportar.php`

Implementado:
- Export CSV por query `?export=colaboradores`.

Observação importante:
- CSV escreve coluna `funcao`, mas a query de origem fornece `cargo`.
- Resultado: coluna "Função" tende a sair vazia.

### Dashboard RH
- UI: `UI/RH/dashboard_rh.php`
- BLL/DAL: dashboard RH

Implementado:
- Gráficos similares ao do coordenador, com escopo global.

## 3.6 Admin

### Página inicial admin
- UI: `UI/Admin/pagina_inicial_admin.php`

Implementado:
- Navegação para gestão de utilizadores, permissões, campos e alertas.

### Dashboard admin
- UI: `UI/Admin/dashboard_admin.php`

Estado:
- Placeholder: "A CONCLUIR".

### Utilizadores
- UI: `UI/Admin/utilizadores.php`
- UI: `UI/Admin/utilizador_novo.php`
- UI: `UI/Admin/utilizador_editar.php`
- UI: `UI/Admin/utilizador_remover.php`
- BLL: `BLL/Admin/BLL_utilizadores.php`
- DAL: `DAL/Admin/DAL_utilizadores.php`

Implementado:
- CRUD base de utilizadores.
- Criação também gera registo em `colaboradores`.
- Edição de nome/username/email/perfil/ativo.
- Remoção em cascata manual (colaborador e utilizador).

### Permissões
- UI: `UI/Admin/permissoes.php`
- BLL: `BLL/Admin/BLL_permissoes.php`
- DAL: `DAL/Admin/DAL_permissoes.php`

Implementado:
- Matriz de permissões por perfil com checkboxes.
- Persistência de `valor` (0/1) por id de permissão.

### Campos personalizados
- UI: `UI/Admin/campos_personalizados.php`
- BLL/DAL: `BLL/Admin/BLL_campos_personalizados.php`, `DAL/Admin/DAL_campos_personalizados.php`

Implementado parcialmente:
- Listagem de campos.

Não implementado:
- CRUD completo (botões apontam para `#` / link de novo para ficheiro não existente `campo_novo.php`).

### Alertas
- UI: `UI/Admin/alertas.php`
- BLL/DAL: `BLL/Admin/BLL_alertas.php`, `DAL/Admin/DAL_alertas.php`

Implementado parcialmente:
- Listagem de alertas.

Não implementado:
- Fluxos reais de criar/editar/remover (link para `alerta_novo.php` não encontrado).

## 4. Regras de negócio identificadas

## 4.1 Autenticação e acesso

- Sessão é iniciada e verificada diretamente em cada página UI.
- Gating por perfil é feito por comparação de string (`admin`, `rh`, `coordenador`, `colaborador`, `convidado`).
- Redirecionamento para erro é a forma principal de bloqueio.

## 4.2 Utilizadores e perfis

- Tabela `utilizadores` guarda credenciais e estado ativo.
- Tabela `perfis` fornece nome do perfil.
- Tabela `colaboradores` guarda dados pessoais e laborais.
- Na criação de utilizador, geralmente cria-se também colaborador com nome.

## 4.3 Equipas

- `equipas` com `coordenador_id`.
- `equipa_colaboradores` como tabela de associação.
- Criação de equipa em transação (inserção equipa + membros).

## 4.4 Mensagens e notificações

- Mensagens são entre utilizadores (`remetente_id`, `destinatario_id`).
- Notificações são listadas por utilizador e podem ser marcadas como lidas.

## 4.5 Ficha colaborador

- Atualização dinâmica por array de campos submetidos.
- Upload de comprovativos para diretoria local.

## 5. Modelo de dados inferido (tabelas usadas)

Tabelas efetivamente referenciadas nas DAL:
- `utilizadores`
- `perfis`
- `colaboradores`
- `equipas`
- `equipa_colaboradores`
- `permissoes`
- `mensagens`
- `notificacoes`
- `alertas`
- `campos_personalizados`

Campos-chave observados no código:
- `utilizadores`: `id`, `username`, `email`, `password`, `perfil_id`, `ativo`
- `colaboradores`: `id`, `utilizador_id`, `nome`, `cargo`, `nivel_hierarquico`, `email`, campos de ficha extensa
- `equipas`: `id`, `nome`, `coordenador_id`
- `equipa_colaboradores`: `equipa_id`, `colaborador_id`
- `permissoes`: `id`, `perfil_id`, `permissao`, `valor`
- `mensagens`: `id`, `remetente_id`, `destinatario_id`, `assunto`, `mensagem`, `anexo`, `data_envio`, `lida`
- `notificacoes`: `id`, `utilizador_id`, `data_envio`, `lida`, outros campos não totalmente confirmados

## 6. Configuração e execução atual

## 6.1 Dependências técnicas atuais

Backend:
- PHP com PDO
- MySQL

Frontend:
- PHP renderizando HTML
- CSS estático
- JS simples (`assets/script.js`, `assets/chatbot.js`)
- CanvasJS + simple-statistics (dashboards)

## 6.2 Assets e integrações

- Chatbot embutido via iframe (Chatbase) em várias páginas.
- Imagens/carrossel em `assets/1.png` ... `assets/6.png`.

## 6.3 Inconsistências de configuração confirmadas

- `index.php` aponta para ficheiro inexistente (`UI/login.php`).
- Páginas usam CSS inexistente (`assets/teste.css`, `assets/CSS/Comuns/header.css`).
- Login aponta para JS inexistente (`assets/login.js`; existe `assets/script.js`).

## 7. Lacunas e problemas críticos atuais

## 7.1 Segurança

- Password em texto simples na autenticação principal.
- Sem proteção CSRF nos formulários.
- Sem rate limit no login.
- Sem gestão robusta de sessão (timeout/rotação token/regeneração).
- Credenciais de BD hardcoded no código.

## 7.2 Funcionalidade incompleta

- Dashboards com "A CONCLUIR" em áreas críticas.
- Onboarding convidado sem persistência.
- Perfil sem processamento de update na UI.
- Muitos links de navegação para ficheiros inexistentes.

## 7.3 Qualidade técnica

- Mistura de dados reais com dados estáticos em notificações.
- Fluxos RH/Admin com gates inconsistentes em algumas páginas.
- Referências de caminhos inconsistentes.
- Classe legada de autenticação (`BLL/Authenticator.php`) coexistindo com fluxo real (`BLL/Comuns/BLL_login.php`).
- `BLL/Comuns/BLL_mensagens.php` contém require recursivo/desnecessário para o próprio ficheiro.

## 8. Fluxos ponta-a-ponta (estado real)

## 8.1 Login
1. Utilizador submete credenciais em `UI/Comuns/login.php`.
2. `Authenticator::login` valida em `utilizadores` + `ativo` + password.
3. Define sessão.
4. Redirect por perfil para dashboard/página inicial correspondente.

## 8.2 RH cria colaborador
1. RH entra em `UI/RH/colaborador_novo.php`.
2. Submete form com nome, username, email, password, cargo.
3. BLL/DAL cria `utilizadores` e `colaboradores`.
4. Novo utilizador passa a existir com perfil mapeado pelo cargo.

## 8.3 RH cria equipa
1. RH entra em `UI/RH/equipa_nova.php`.
2. Define nome, coordenador, membros.
3. DAL abre transação.
4. Insere equipa e linhas em `equipa_colaboradores`.
5. Commit.

## 8.4 Coordenador consulta equipa e envia mensagem
1. Coordenador abre `UI/Coordenador/equipa.php?id=...`.
2. Lista colaboradores da equipa.
3. Abre modal e envia mensagem.
4. Handler `UI/Comuns/enviar_mensagem.php` salva em `mensagens`.
5. Redirect para equipa com status.

## 8.5 Colaborador atualiza ficha
1. Colaborador abre `UI/Colaborador/ficha_colaborador.php`.
2. Edita campos permitidos na UI e envia formulário.
3. Uploads são movidos para `Uploads/comprovativos/`.
4. DAL faz update dinâmico na tabela `colaboradores`.

## 9. O que falta para produção real (checklist executivo)

Bloqueadores:
- Corrigir routing inicial (`index.php`) e links quebrados.
- Implementar hashing de password e migração de passwords.
- Separar configuração sensível para variáveis de ambiente.
- Implementar CSRF + validação robusta de input no servidor.
- Revisar autorização por recurso (não só por página).
- Completar fluxos incompletos (onboarding, perfil, dashboards placeholder).
- Corrigir inconsistências de assets.

Alta prioridade:
- Logging estruturado.
- Auditoria de ações críticas (CRUD, login, exportações).
- Paginação/filtros em listagens grandes.
- Tratamento de erro padronizado.
- Testes mínimos (unit/integration/e2e).

## 10. Mapa de migração para React (paridade funcional)

## 10.1 Estratégia recomendada

- Frontend novo em React + TypeScript.
- Backend API separado (Node/Express, NestJS ou Laravel API).
- Manter MySQL inicialmente e migrar incrementalmente.
- Migração faseada por módulo para reduzir risco.

## 10.2 Módulos React a criar (paridade)

Autenticação:
- Login
- Logout
- Guardas de rota por perfil

Comuns:
- Perfil
- Notificações
- Mensagens recebidas

Admin:
- Gestão de utilizadores
- Gestão de permissões
- Campos personalizados
- Alertas

RH:
- Colaboradores (lista + criação + edição)
- Equipas (lista + criação + edição)
- Relatórios
- Exportação
- Dashboard RH

Coordenador:
- Página inicial
- Equipa
- Dashboard
- Relatórios de equipa

Colaborador:
- Página inicial
- Ficha colaborador
- Dashboard colaborador

Convidado:
- Dashboard convidado
- Onboarding funcional

## 10.3 Contratos de API mínimos por domínio

Auth:
- POST /auth/login
- POST /auth/logout
- POST /auth/change-password

Users/Profiles:
- GET /users
- GET /users/:id
- POST /users
- PUT /users/:id
- DELETE /users/:id
- GET /profiles

Colaboradores:
- GET /colaboradores
- GET /colaboradores/:id
- PUT /colaboradores/:id
- POST /colaboradores/:id/uploads

Equipas:
- GET /equipas
- GET /equipas/:id
- POST /equipas
- PUT /equipas/:id
- DELETE /equipas/:id
- POST /equipas/:id/membros
- DELETE /equipas/:id/membros/:colaboradorId

Permissões:
- GET /permissoes
- PUT /permissoes/:id

Mensagens/Notificações:
- GET /mensagens
- POST /mensagens
- PUT /mensagens/:id/lida
- GET /notificacoes
- PUT /notificacoes/:id/lida

Relatórios/Dashboards:
- GET /dashboard/rh
- GET /dashboard/coordenador/:userId
- GET /relatorios/indicadores
- GET /export/colaboradores.csv

## 10.4 Fases de implementação recomendadas

Fase 1 (fundação):
- Auth, sessões/tokens, RBAC, layout base, configuração e observabilidade.

Fase 2 (núcleo RH/Admin):
- Utilizadores, colaboradores, equipas, permissões.

Fase 3 (operacional):
- Ficha colaborador, mensagens/notificações, onboarding.

Fase 4 (analytics e acabamento):
- Dashboards, relatórios, exportações, hardening de segurança e performance.

## 11. Resumo executivo

O projeto atual tem uma base funcional útil (camadas separadas e domínio de RH já modelado), mas ainda está num estado híbrido entre protótipo e sistema operacional.

Para reconstrução em React para produção, o caminho certo é:
1. Preservar o domínio de dados existente.
2. Extrair regras para uma API bem definida.
3. Reescrever UI por módulos com paridade funcional controlada.
4. Corrigir os bloqueadores de segurança e consistência antes de go-live.

---

Fim do guia.