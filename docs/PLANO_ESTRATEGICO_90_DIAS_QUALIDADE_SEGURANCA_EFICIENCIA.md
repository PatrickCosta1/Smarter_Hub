# PLANO ESTRATEGICO 90 DIAS - QUALIDADE, SEGURANCA, EFICIENCIA E EXCELENCIA OPERACIONAL

Data: 10-04-2026
Escopo: SMARTER_HUB (Frontend + Backend + Operacao)
Responsavel de aprovacao: Lider Tecnico + Produto + Operacoes
Dependencias de entrada:
- docs/PASSO_1_AUDITORIA_VISUAL_UX.md
- docs/PASSO_2_PRIORIZACAO_E_SPRINT_1.md
- docs/PASSO_2_BACKLOG_PRIORIZADO.csv

## 1. Objetivo executivo

Elevar o sistema para um patamar enterprise com 5 resultados concretos:
1. Menos risco de seguranca em fluxos criticos.
2. Menos regressao em mudancas e releases.
3. Melhor performance percebida e real.
4. Maior confiabilidade operacional (deteccao + resposta rapida).
5. Maior previsibilidade de entrega tecnica.

Principio guia:
- "Rapido com controle": velocidade sem comprometer seguranca, qualidade e estabilidade.

## 2. Norte de 90 dias (metas mensuraveis)

### 2.1 Metas de seguranca
1. 100% dos endpoints criticos com autorizacao testada (sucesso + negacao).
2. 0 segredos em repositorio (scan automatico em CI).
3. 100% de dependencias com scan de vulnerabilidade em cada PR.
4. SLA de correcao:
- Critica: 24h
- Alta: 72h
- Media: 14 dias

### 2.2 Metas de qualidade
1. Coverage minima em modulos criticos >= 70% (permissoes, autenticacao, aprovacoes).
2. Taxa de falha pos-deploy < 5%.
3. Regressao funcional em fluxo critico < 2% por sprint.
4. 100% dos PRs com quality gates obrigatorios (lint, typecheck, build, testes).

### 2.3 Metas de eficiencia/performance
1. p95 de endpoints criticos reduzido em 30%.
2. Bundle principal frontend reduzido em 20% (quando viavel sem perda funcional).
3. Tempo medio de pagina critica (percebido) reduzido em 25%.
4. 100% das listas grandes com paginacao/filtragem eficiente.

### 2.4 Metas de confiabilidade
1. Disponibilidade >= 99.5%.
2. MTTD <= 10 min para incidentes P1/P2.
3. MTTR <= 60 min para P1.
4. 100% de acoes criticas com trilha de auditoria.

## 3. Modelo de execucao (6 trilhas em paralelo)

## 3.1 Trilha A - Seguranca de aplicacao

Objetivo:
- Reduzir risco tecnico e de compliance nos fluxos de autenticacao e autorizacao.

Entregaveis:
1. Matriz de autorizacao por endpoint (quem pode fazer o que).
2. Testes de negacao por endpoint critico.
3. Hardening de sessao/token (expiracao, rotacao, invalidacao).
4. Politica de input validation e output encoding padrao.
5. Rate limit e protecao para rotas sensiveis.
6. Trilha de auditoria para acoes criticas (criar, editar, aprovar, revogar, desativar).

KPIs da trilha:
- % endpoints criticos cobertos por testes de autorizacao.
- Numero de vulnerabilidades abertas por severidade.
- Tempo medio de correcao por severidade.

## 3.2 Trilha B - Qualidade e testes

Objetivo:
- Transformar qualidade em parte obrigatoria do fluxo de entrega.

Entregaveis:
1. Piramide de testes formalizada (unit, integracao, E2E).
2. Suite E2E de fluxos criticos (acesso total, permissoes, aprovacao, gestao de conta).
3. Quality gate em CI com bloqueio de merge.
4. Smoke test pos-deploy automatizado.
5. Definicao de Definition of Done tecnico.

KPIs da trilha:
- Cobertura em modulos criticos.
- Taxa de regressao por release.
- % PRs aprovados sem rerun de pipeline.

## 3.3 Trilha C - Performance e eficiencia

Objetivo:
- Melhorar tempo de resposta e custo de execucao.

Entregaveis:
1. Perfil de performance backend (top 10 endpoints lentos).
2. Plano de indices e queries otimizadas (eliminar N+1).
3. Otimizacao de payload (campos minimos por caso de uso).
4. Performance budget frontend (bundle, render, interacao).
5. Estrategia de cache para dados de baixa volatilidade.

KPIs da trilha:
- p50/p95 por endpoint critico.
- Tamanho bundle principal.
- Tempo de render em telas-chave.

## 3.4 Trilha D - Observabilidade e operacao

Objetivo:
- Detectar problemas cedo e recuperar rapido.

Entregaveis:
1. Logs estruturados com correlation id ponta a ponta.
2. Dashboard com metricas de ouro (latencia, erro, throughput, disponibilidade).
3. Alertas acionaveis por impacto (nao por ruido).
4. Runbooks para incidentes top 5.
5. Teste real de restore de backup (mensal).

KPIs da trilha:
- MTTD e MTTR.
- Numero de falsos positivos de alerta.
- % incidentes com runbook aplicado.

## 3.5 Trilha E - Governanca e fluxo de entrega

Objetivo:
- Aumentar previsibilidade e reduzir risco de release.

Entregaveis:
1. PR template com checklist tecnico/seguranca.
2. Classificacao de mudancas por risco (baixo/medio/alto).
3. Politica de release com feature flags e rollback rapido.
4. Janela de deploy e criterio de go/no-go.
5. Revisao quinzenal de divida tecnica com capacidade reservada.

KPIs da trilha:
- Lead time medio de PR para producao.
- Change failure rate.
- % releases com rollback.

## 3.6 Trilha F - UX de confianca (continuidade do trabalho atual)

Objetivo:
- Manter consistencia e reduzir erro de uso sem retrabalho.

Entregaveis:
1. Finalizar padrao visual/funcional da ReceiptsPage (UX-005) apos estabilizacao base.
2. Medir taxa de erro por tarefa critica (antes/depois).
3. Checklist A11y pratico em fluxos principais.
4. Padrao de mensagens e estados vazios em toda a aplicacao.

KPIs da trilha:
- Taxa de erro de tarefa.
- Tempo medio de conclusao por fluxo.
- Numero de inconsistencias visuais reabertas por sprint.

## 4. Roadmap 30-60-90 dias

## 4.1 Fase 1 (Dia 1-30) - Fundacao e controle de risco

Prioridade maxima:
1. Seguranca base + quality gate + observabilidade minima.

Plano:
1. Semana 1:
- Congelar mudancas de alto risco sem testes.
- Definir mapa de endpoints criticos.
- Ativar scan de dependencias e segredos em CI.

2. Semana 2:
- Criar testes de autorizacao (sucesso e negacao) para endpoints criticos.
- Definir PR template e DoD tecnico.
- Instrumentar correlation id em logs.

3. Semana 3:
- Configurar dashboard operacional minimo.
- Criar smoke tests pos-deploy.
- Levantar baseline de p95 e bundle.

4. Semana 4:
- Hardening inicial de sessao/token.
- Primeira rodada de runbooks (top 3 incidentes).
- Revisao executiva de baseline e gaps.

Saida obrigatoria da Fase 1:
- CI com bloqueio de merge ativo.
- Mapa de risco real do sistema.
- Observabilidade minima operante.

## 4.2 Fase 2 (Dia 31-60) - Escala de qualidade e performance

Prioridade maxima:
1. Reduzir regressao e acelerar resposta do sistema.

Plano:
1. Semana 5:
- Expandir testes integracao em fluxos criticos.
- Iniciar suite E2E principal.

2. Semana 6:
- Otimizar top 5 endpoints mais lentos.
- Aplicar indices e reduzir payloads.

3. Semana 7:
- Performance budget frontend + tuning de carregamento.
- Revisao de tabelas/listas com alta volumetria.

4. Semana 8:
- Completar runbooks top 5.
- Simulado de incidente (tabletop + exercicio tecnico).

Saida obrigatoria da Fase 2:
- Regressao sob controle.
- Ganho de performance comprovado por metrica.
- Equipe preparada para incidente real.

## 4.3 Fase 3 (Dia 61-90) - Maturidade operacional e excelencia continua

Prioridade maxima:
1. Consolidar confiabilidade e governanca de produto tecnico.

Plano:
1. Semana 9:
- Politica de release por risco + feature flags em fluxos sensiveis.
- Validacao de rollback em ambiente controlado.

2. Semana 10:
- Auditoria completa de autorizacao e trilha de acoes criticas.
- Ajustes finais de backlog tecnico.

3. Semana 11:
- Teste mensal de restore (simulado completo).
- Revisao de custos e eficiencia operacional.

4. Semana 12:
- Fecho executivo: comparativo baseline vs resultado.
- Novo plano trimestral com foco em escala e inovacao.

Saida obrigatoria da Fase 3:
- Operacao previsivel.
- Risco residual mapeado.
- Modelo de melhoria continua institucionalizado.

## 5. Mapa de ownership (RACI simplificado)

Papeis:
- LT: Lider Tecnico
- DEV: Engenharia
- QA: Qualidade/Testes
- OPS: Operacoes
- SEC: Seguranca
- PO: Produto

Matriz:
1. Seguranca aplicacao: R=SEC, A=LT, C=DEV/OPS, I=PO
2. Qualidade e testes: R=QA, A=LT, C=DEV, I=PO
3. Performance: R=DEV, A=LT, C=OPS/QA, I=PO
4. Observabilidade: R=OPS, A=LT, C=DEV, I=PO
5. Governanca release: R=LT, A=LT, C=QA/OPS/PO, I=SEC
6. UX continuidade: R=PO, A=PO, C=DEV/QA, I=LT

## 6. Quality gates obrigatorios por PR

Checklist obrigatorio:
1. Lint e typecheck verde.
2. Build verde.
3. Testes unitarios/integracao relevantes verdes.
4. Scan de vulnerabilidade sem critica/alta aberta sem waiver.
5. Sem segredo exposto em diff.
6. Plano de rollback definido para mudanca de risco medio/alto.

Regra de bloqueio:
- Merge proibido se qualquer gate obrigatorio falhar.

## 7. Politica de risco de mudanca

Classificacao:
1. Baixo risco: mudanca visual isolada ou refactor local sem impacto de regra.
2. Medio risco: mudanca em regra de negocio ou endpoint nao critico.
3. Alto risco: autenticacao, autorizacao, permissao, faturacao, dados sensiveis.

Exigencia minima:
1. Baixo: review + pipeline verde.
2. Medio: + teste integracao + plano de rollback.
3. Alto: + testes de negacao + aprovacao LT/SEC + janela de deploy controlada.

## 8. Painel executivo (indicadores semanais)

Indicadores principais:
1. Security posture: vulnerabilidades por severidade.
2. Build health: taxa de sucesso do CI.
3. Delivery health: lead time e change failure rate.
4. Runtime health: disponibilidade, p95, taxa de erro.
5. Quality health: regressao e cobertura critica.

Formato de acompanhamento:
- Reuniao semanal de 30 min com semaforo:
- Verde: dentro da meta
- Amarelo: desvio controlado
- Vermelho: risco alto com acao corretiva imediata

## 9. Riscos do plano e mitigacao

Risco 1: Equipe sobrecarregada por trilhas em paralelo
- Mitigacao: WIP limitado por trilha e priorizacao semanal fixa.

Risco 2: Falta de baseline confiavel
- Mitigacao: congelar 1 semana para medir antes de otimizar.

Risco 3: Mudancas de seguranca atrasarem entrega de feature
- Mitigacao: separar hardening estrutural de ajustes incrementais de baixo risco.

Risco 4: Alertas em excesso (fadiga)
- Mitigacao: revisar thresholds quinzenalmente e remover ruido.

## 10. Plano de arranque (proximos 10 dias)

Dia 1-2:
1. Formalizar endpoints criticos e responsaveis.
2. Ligar scans de dependencia/segredo no CI.

Dia 3-4:
1. Definir e aprovar PR template + DoD tecnico.
2. Criar primeiros testes de negacao para autorizacao.

Dia 5-6:
1. Instrumentar correlation id no backend.
2. Criar dashboard inicial de saude.

Dia 7-8:
1. Definir smoke tests pos-deploy.
2. Executar baseline de performance (p95 + bundle + erro).

Dia 9-10:
1. Priorizar top 5 gaps com maior impacto.
2. Publicar relatorio executivo de baseline e proximo ciclo.

## 11. Criterio de sucesso do plano

O plano e considerado bem-sucedido se ao final de 90 dias houver:
1. Reducao material de risco de seguranca em fluxos criticos.
2. Melhoria objetiva de estabilidade e tempo de resposta.
3. Pipeline de entrega previsivel com gates obrigatorios.
4. Operacao observavel com resposta rapida a incidentes.
5. Evidencia numerica de evolucao (antes/depois).

Status inicial:
- Documento estrategico: OK
- Pronto para kickoff executivo: SIM
