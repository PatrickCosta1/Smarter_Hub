# PASSO 4 - Matriz de Cobertura E2E (SMARTER_HUB)

Data: 13-04-2026
Objetivo: tornar explicito o que esta coberto, os gaps e a prioridade de novos cenarios.

## 1. Cenarios atualmente cobertos

| ID | Cenario | Tipo | Risco coberto | Estado |
|---|---|---|---|---|
| E2E-001 | Alteracao de ficha entra na fila e pode ser aprovada | Positivo | Fluxo RH de aprovacao de perfil | Coberto |
| E2E-002 | Pedido de ferias entra na fila e pode ser aprovado | Positivo | Fluxo RH de aprovacao de ferias | Coberto |
| E2E-003 | Acesso total pode ser concedido e revogado | Positivo | Fluxo critico de permissoes | Coberto |
| E2E-004 | Criacao de utilizador BR aparece no admin | Positivo | Integridade basica de criacao/listagem | Coberto |
| E2E-005 | Login invalido mostra erro e nao autentica | Negativo | Autenticacao/feedback de erro | Novo |
| E2E-006 | Colaborador sem permissao recebe 403 no admin API | Negativo | Controle de acesso/autorizacao | Novo |
| E2E-007 | Rejeicao de pedido de perfil remove item da fila | Negativo/decisao | Fluxo RH de rejeicao | Novo |
| E2E-008 | Sessao invalida envia o utilizador para o login | Negativo | Gestão de sessão/autenticacao | Novo |
| E2E-009 | Rejeicao de ferias remove item da fila e grava motivo | Negativo/decisao | Fluxo RH de rejeicao de ferias | Novo |
| E2E-010 | Formularios mostram validacao ao submeter em branco | Negativo | Qualidade de formulario e feedback | Novo |

## 2. Gaps prioritarios (proxima vaga)

| ID | Gap | Prioridade | Justificativa |
|---|---|---|---|
| GAP-001 | Revogacao de permissao por utilizador sem escopo | Alta | Risco de escalacao indevida |
| GAP-002 | Tentativa de apagar utilizador sem permissao/escopo | Alta | Endurecer seguranca do novo endpoint de delete |
| GAP-003 | Fluxo de token expirado em chamada autenticada | Alta | Robustez de autenticacao |
| GAP-004 | Persistencia de rejeicao de ferias em backend | Media | Cobertura de fluxo completo de ferias |
| GAP-005 | Estados vazios e loading em fluxos principais | Media | Regressao UX silenciosa |
| GAP-006 | Fluxos de conta inativa (403 de autenticacao) | Media | Compliance e operacao |

## 3. Estado de limpeza de dados residuais

1. O spec [e2e/smarter-hub.spec.ts](e2e/smarter-hub.spec.ts) agora regista cleanup por teste em `afterEach`.
2. Entidades criadas para cenarios sao removidas no fim do teste (utilizadores e equipas de QA).
3. Foi adicionado endpoint administrativo `DELETE /admin/users/:id` para permitir teardown completo.
4. A suite foi colocada em modo serial para reduzir contencao durante cleanup e evitar flakiness.

## 4. Regra de evolucao de cobertura

1. Cada novo bug critico em producao vira teste E2E regressivo.
2. Cada fluxo critico deve ter pelo menos 1 teste positivo e 1 negativo.
3. Nenhum PR de permissao/autenticacao fecha sem cobertura E2E correspondente.

## 5. Meta operacional

1. Curto prazo: 10 cenarios E2E criticos estaveis.
2. Medio prazo: cobertura de todos os fluxos de aprovacao (aprovar e rejeitar) e de autenticacao/permissoes.
3. Qualidade de execucao: flakiness menor que 2% nas suites criticas.
