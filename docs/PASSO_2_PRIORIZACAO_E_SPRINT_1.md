# PASSO 2 - Priorizacao e Plano de Execucao (SMARTER_HUB)

Data: 10-04-2026
Responsavel: Produto/UX/Frontend
Entrada: docs/PASSO_1_AUDITORIA_VISUAL_UX.md
Saida: backlog priorizado + Sprint 1 executavel

## 1. Objetivo do Passo 2

Transformar o backlog do Passo 1 em ordem de execucao objetiva, reduzindo risco operacional UX no menor tempo possivel, com:
- criterio de priorizacao unico
- ranking final dos itens UX-001..UX-010
- recorte de Sprint 1 com tarefas por ficheiro
- criterios de aceitacao e validacao

## 2. Metodo de priorizacao (WSJF simplificado)

Formula:
WSJF = (Valor de negocio + Criticidade temporal + Reducao de risco) / Esforco

Escala usada:
- Valor de negocio: 1-10
- Criticidade temporal: 1-10
- Reducao de risco: 1-10
- Esforco: 1-10 (maior = mais caro)

Regras:
1. Itens que reduzem ambiguidade em acao critica recebem peso alto.
2. Itens base de consistencia (componentes/padroes) sobem prioridade.
3. Itens cosmeticos puros caem prioridade.
4. Dependencias tecnicas ajustam ordem final.

## 3. Tabela de scoring

| ID | Item | Valor | Tempo | Risco | Esforco | WSJF | Prioridade |
|---|---|---:|---:|---:|---:|---:|---|
| UX-001 | EmptyState padrao reutilizavel | 8 | 8 | 9 | 3 | 8.33 | P1 |
| UX-003 | Unificar padrao de Button | 9 | 8 | 8 | 4 | 6.25 | P2 |
| UX-008 | Contrato de confirmacao em acao critica | 10 | 9 | 10 | 6 | 4.83 | P3 |
| UX-002 | Contrato unico de feedback (toast/status) | 9 | 8 | 9 | 6 | 4.33 | P4 |
| UX-007 | Contrato unico de loading states | 8 | 7 | 8 | 6 | 3.83 | P5 |
| UX-009 | Padrao de microcopy e mensagens | 8 | 7 | 7 | 6 | 3.67 | P6 |
| UX-010 | Checklist minimo de acessibilidade base | 9 | 7 | 8 | 7 | 3.43 | P7 |
| UX-004 | Migrar inline styles para classes | 7 | 6 | 6 | 6 | 3.17 | P8 |
| UX-006 | Consolidar tokens de cor/spacing | 7 | 6 | 6 | 7 | 2.71 | P9 |
| UX-005 | Alinhar ReceiptsPage ao padrao final | 6 | 5 | 5 | 5 | 3.20 | P10* |

Nota sobre UX-005:
- Apesar do WSJF bruto nao ser o ultimo, foi posicionado apos os padroes base por dependencia (sem sistema base, a pagina placeholder tende a ser retrabalho).

## 4. Ordem final aprovada (com dependencias)

1. UX-001 EmptyState
2. UX-003 Button unificado
3. UX-008 Confirmacao de acao critica
4. UX-002 Feedback unificado
5. UX-007 Loading unificado
6. UX-009 Microcopy
7. UX-010 Acessibilidade base
8. UX-004 Inline styles para classes
9. UX-006 Tokens de cor/spacing
10. UX-005 ReceiptsPage

## 5. Recorte da Sprint 1 (execucao imediata)

Duracao: 1 semana util
Meta: reduzir inconsistencias criticas visiveis sem quebrar fluxos de negocio

Escopo Sprint 1:
- UX-001
- UX-003
- UX-008
- UX-002 (fase 1)

### 5.1 Item UX-001 - EmptyState padrao

Objetivo:
- substituir padroes soltos de estado vazio por componente unico

Arquivos alvo:
- src/components/ui/EmptyState.tsx (novo)
- src/components/ui/ui.css (estilos do componente)
- src/pages/NotificationsPage.tsx
- src/pages/ManagerTeamsPage.tsx
- src/pages/PermissionsPage.tsx
- src/pages/CollaboratorsPage.tsx (onde aplicavel)

Criterios de aceitacao:
1. Todas as telas alvo usam o mesmo componente EmptyState.
2. Estrutura visual uniforme (titulo, descricao, acao opcional).
3. Nao ha quebra de layout desktop/mobile.

Validacao:
- npm run build (frontend)
- navegacao manual nas paginas alvo

### 5.2 Item UX-003 - Button unificado

Objetivo:
- eliminar botoes manuais de estilo e usar componente Button comum

Arquivos alvo:
- src/pages/TrainingsPage.tsx
- src/pages/ManagerTeamsPage.tsx
- src/components/ui/Button.tsx (ajustes minimos, se necessario)

Criterios de aceitacao:
1. Acoes principais usam Button variant oficial.
2. Estados disabled/loading visualmente consistentes.
3. Nao existem classes manuais de CTA para botoes primarios nessas telas.

Validacao:
- npm run build
- testes manuais de hover/focus/disabled/loading

### 5.3 Item UX-008 - Contrato de confirmacao

Objetivo:
- garantir padrao unico para acao critica (confirmar antes de aplicar)

Arquivos alvo:
- src/components/ui/Modal.tsx (se precisar de props de alinhamento/footer)
- src/pages/CollaboratorsPage.tsx
- src/pages/PermissionsPage.tsx
- src/pages/ManagerTeamsPage.tsx (apagar/remover/revogar)

Contrato UX obrigatorio:
1. Acao critica abre modal com impacto explicito.
2. Botao primario do modal e sempre "Confirmar" (ou verbo critico explicito).
3. Fechar modal sem confirmar nao aplica alteracao.
4. Resultado da operacao gera feedback visivel.

Criterios de aceitacao:
1. Nao existe acao critica sem confirmacao.
2. Mensagem de consequencia esta explicita no modal.
3. Fluxo fica consistente em pelo menos 3 modulos.

Validacao:
- testes manuais por fluxo critico
- regressao funcional rapida

### 5.4 Item UX-002 - Feedback unificado (fase 1)

Objetivo:
- reduzir variacao toast/status sem reescrever tudo na Sprint 1

Escopo fase 1:
- definir contrato de mensagem (success/error/info)
- padronizar timeout e formato de texto
- aplicar em 3 telas criticas

Arquivos alvo:
- src/components/ui/Toast.tsx
- src/pages/NotificationsPage.tsx
- src/pages/ProfilePage.tsx
- src/pages/AccountAccessPage.tsx

Contrato de feedback:
1. sucesso: verbo + resultado
2. erro: causa simples + acao recomendada
3. info: estado neutro sem bloquear fluxo

Criterios de aceitacao:
1. Tono do toast nao depende de heuristica textual solta.
2. Timeout e comportamento consistentes nas telas alvo.
3. Mensagens seguem padrao editorial minimo.

## 6. Planeamento diario da Sprint 1

Dia 1:
- criar EmptyState e aplicar em 2 paginas

Dia 2:
- concluir EmptyState nas restantes paginas alvo
- iniciar unificacao de botoes

Dia 3:
- concluir unificacao de botoes
- iniciar contrato de confirmacao em modais criticos

Dia 4:
- fechar contrato de confirmacao
- iniciar feedback unificado fase 1

Dia 5:
- fechar feedback fase 1
- hardening, regressao manual e ajuste de copy

## 7. Riscos da Sprint 1 e mitigacoes

Risco 1:
- retrabalho por mexer em estilos globais sem isolamento
Mitigacao:
- alterar primeiro em componentes e depois nas paginas, em passos pequenos

Risco 2:
- regressao em fluxo critico de permissao/acesso
Mitigacao:
- testar fluxo completo apos cada merge de item critico

Risco 3:
- inconsistencias remanescentes por escopo parcial
Mitigacao:
- documentar explicitamente o que fica para Sprint 2

## 8. Criterio de saida do Passo 2

Passo 2 so fecha quando:
1. backlog com ordem objetiva aprovado
2. Sprint 1 definida com escopo, tarefas e validacao
3. dependencias e riscos mapeados
4. equipa consegue iniciar implementacao sem duvidas

Status:
- Priorizacao: OK
- Sprint 1: OK
- Dependencias: OK
- Pronto para execucao: SIM
