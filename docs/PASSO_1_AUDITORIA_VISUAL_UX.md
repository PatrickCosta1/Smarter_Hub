# PASSO 1 - Auditoria Visual/UX (SMARTER_HUB)

Data: 10-04-2026
Responsavel: Produto/UX/Frontend
Estado: Concluido (Baseline inicial criada)

## 1. Objetivo do Passo 1

Criar uma base objetiva para a melhoria visual/UX do sistema inteiro:
- inventario de telas e componentes
- checklist de auditoria padronizada
- baseline inicial mensuravel
- backlog inicial de inconsistencias por severidade
- ordem de ataque para o Passo 2 (priorizacao)

## 2. Escopo auditado

### 2.1 Paginas mapeadas (12)
- src/pages/HomePage.tsx
- src/pages/ProfilePage.tsx
- src/pages/ManagerTeamsPage.tsx
- src/pages/CollaboratorsPage.tsx
- src/pages/AdminPage.tsx
- src/pages/RHApprovalsPage.tsx
- src/pages/TrainingsPage.tsx
- src/pages/VacationsPage.tsx
- src/pages/NotificationsPage.tsx
- src/pages/PermissionsPage.tsx
- src/pages/ReceiptsPage.tsx
- src/pages/AccountAccessPage.tsx

### 2.2 Componentes UI mapeados (10)
- src/components/LoadingScreen.tsx
- src/components/LoginView.tsx
- src/components/ui/Button.tsx
- src/components/ui/Card.tsx
- src/components/ui/Badge.tsx
- src/components/ui/TextInput.tsx
- src/components/ui/Toast.tsx
- src/components/ui/Modal.tsx
- src/components/ui/DataTable.tsx
- src/components/ui/Skeleton.tsx

### 2.3 Ficheiros de estilo mapeados (4)
- src/styles.css
- src/redesign.css
- src/components/LoadingScreen.css
- src/components/ui/ui.css

## 3. Checklist oficial de auditoria (usar em todas as telas)

Pontuacao por criterio:
- 0 = inexistente/defeituoso
- 1 = parcial
- 2 = bom

Criterios:
1. Hierarquia visual (titulo, contexto, CTA principal)
2. Consistencia de componentes (buttons, badges, modais, inputs)
3. Estados de interacao (hover, focus, disabled, loading)
4. Clareza de fluxo (quando guarda, quando aplica imediato)
5. Confirmacoes para acao critica
6. Feedback de sucesso/erro (clareza e utilidade)
7. Estado vazio (empty state orientativo)
8. Estado de carregamento (skeleton/loading unificado)
9. Acessibilidade basica (labels, teclado, foco visivel)
10. Responsividade (desktop/mobile sem quebra)

Interpretacao da nota (0 a 20):
- 0-8: Critico
- 9-12: Alto
- 13-16: Medio
- 17-20: Bom

## 4. Baseline inicial (mensuravel)

### 4.1 Inventario e volume
- Paginas: 12
- Componentes UI centrais: 10
- Ficheiros de estilos ativos: 4

### 4.2 Sinais de inconsistencias (estado atual)
- Existem multiplos padroes de feedback (status local, toast, mensagens inline) sem contrato unico.
- Existem paginas com botao/estado visual diferente para a mesma intencao de acao.
- Existem multiplos padroes de empty/loading state em modulos distintos.
- Existem estilos inline em varias paginas para layout que deviam estar em classes padrao.
- Existe pelo menos 1 pagina em estado placeholder (Recibos), fora do padrao de experiencia das restantes.

### 4.3 Risco operacional UX (baseline qualitativo)
- Risco alto de ambiguidade em fluxos criticos quando coexistem "aplicacao imediata" e "guardar configuracao".
- Risco medio de percecao de sistema inconsistente entre modulos.
- Risco medio de regressao visual por falta de contrato unificado de componentes e estados.

## 5. Top inconsistencias encontradas (resumo executivo)

### Criticas
1. Falta de contrato unico de feedback (toast/status/inline)
2. Falta de contrato unico de empty/loading state
3. Variacao de padrao de acao para a mesma intencao em modulos diferentes
4. Ambiguidade de persistencia (algumas acoes aplicam imediato, outras so ao guardar)

### Altas
1. Uso de estilos inline para layout recorrente
2. Flexibilidade insuficiente de alguns componentes base para casos reais (ex: footer de modal)
3. Pagina placeholder sem alinhamento de experiencia

### Medias
1. Variacao de tons e spacing sem token central consistente
2. Variacao de microcopy por pagina
3. Diferencas de tratamento de validacao entre formularios semelhantes

## 6. Backlog inicial do Passo 1 (pronto para priorizar)

Formato: ID | Tipo | Item | Impacto | Esforco | Severidade

1. UX-001 | Componente | Criar EmptyState padrao reutilizavel | Alto | Baixo | Critico
2. UX-002 | Fluxo | Padronizar contrato de feedback (toast/status) | Alto | Medio | Critico
3. UX-003 | Componente | Eliminar padroes manuais de botao e usar Button unificado | Alto | Baixo | Critico
4. UX-004 | Estilo | Migrar estilos inline recorrentes para classes CSS | Medio | Medio | Alto
5. UX-005 | Tela | Alinhar ReceiptsPage ao padrao visual do sistema | Medio | Baixo | Alto
6. UX-006 | Design tokens | Consolidar escala de cores de texto/muted/estado | Medio | Baixo | Medio
7. UX-007 | Loading | Unificar padrao de loading por contexto (page/table/card) | Medio | Medio | Critico
8. UX-008 | Modal | Definir contrato de confirmacao para acao critica | Alto | Medio | Critico
9. UX-009 | Microcopy | Padronizar verbos de acao e mensagens de erro/sucesso | Alto | Baixo | Medio
10. UX-010 | A11y | Checklist minimo de teclado/foco/label em modais e forms | Alto | Medio | Alto

## 7. Entregaveis produzidos neste Passo 1

1. Inventario de paginas/componentes/estilos
2. Checklist oficial com scoring
3. Baseline inicial (quantitativa + qualitativa)
4. Backlog inicial com 10 itens
5. Sequencia recomendada para comecar execucao

## 8. Sequencia recomendada para iniciar Passo 2

Ordem:
1. UX-001 EmptyState
2. UX-003 Buttons unificados
3. UX-008 Contrato de confirmacao em acao critica
4. UX-002 Contrato de feedback
5. UX-007 Contrato de loading
6. UX-004 Inline styles -> classes
7. UX-009 Microcopy
8. UX-010 Acessibilidade base
9. UX-006 Tokens de cor/spacing
10. UX-005 Recibos

## 9. Criterio de saida do Passo 1

Passo 1 so termina quando:
- inventario completo aprovado
- checklist fechado e aceite pela equipa
- baseline validada
- backlog inicial priorizado para ataque

Status atual:
- Inventario: OK
- Checklist: OK
- Baseline: OK
- Backlog inicial: OK
- Pronto para Passo 2: SIM
