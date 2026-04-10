# PASSO 3 - Baseline PageSpeed e Otimizacoes de Alto Impacto (SMARTER_HUB)

Data: 10-04-2026
Fonte: Relatorio PageSpeed Insights (desktop) de https://smarterhub.netlify.app/

## 1. Snapshot do relatorio analisado

Pontuacoes:
1. Performance: 99
2. Acessibilidade: 100
3. Boas praticas: 100
4. SEO: 92

Metricas principais:
1. FCP: 0.8s
2. LCP: 0.8s
3. TBT: 0ms
4. CLS: 0.021
5. Speed Index: 0.9s

## 2. Oportunidades destacadas pelo PageSpeed

1. Render-blocking requests (economia estimada: 310ms).
2. Reduzir CSS nao usado (economia estimada: 16 KiB).
3. Reduzir JavaScript nao usado (economia estimada: 55 KiB).
4. Imagens sem width/height explicitos.
5. SEO tecnico: robots.txt invalido (14 erros).

## 3. Acoes executadas neste passo

## 3.1 SEO tecnico (robots/sitemap)

Implementado:
1. Arquivo robots valido criado.
2. Sitemap basico criado e referenciado no robots.

Arquivos:
1. public/robots.txt
2. public/sitemap.xml

Resultado esperado:
- Remocao do erro de rastreamento/indexacao no Lighthouse SEO para robots.

## 3.2 Reducao de JavaScript inicial (code splitting)

Implementado:
1. Rotas migradas para lazy loading com React.lazy.
2. Suspense com fallback padrao (LoadingScreen) para transicoes de chunks.

Arquivo:
1. src/App.tsx

Resultado observado em build:
- Bundle principal caiu para ~178.80 kB gzip 59.00 kB.
- Paginas separadas em chunks individuais carregados sob demanda.

## 3.3 Reducao de bloqueio de render em fontes

Implementado:
1. Removido @import de fonte em CSS.
2. Adicionado preconnect para hosts de fonte.
3. Adicionado preload + stylesheet no index.html.

Arquivos:
1. src/styles.css
2. index.html

Resultado esperado:
- Menor custo de descoberta de fontes e menor bloqueio na renderizacao inicial.

## 3.4 Estabilizacao de layout de imagens (CLS)

Implementado:
1. Adicionadas dimensoes explicitas width/height nas imagens de logo usadas no fluxo inicial.
2. Mantida renderizacao responsiva via CSS existente, preservando layout visual.

Arquivos:
1. src/layouts/PortalLayout.tsx
2. src/components/LoadingScreen.tsx
3. src/components/LoginView.tsx

Resultado esperado:
- Menor risco de deslocamento de layout em carregamento inicial (diagnostico de imagens sem dimensoes).

## 3.5 Reducao de CSS global nao essencial (login)

Implementado:
1. Estilos especificos do ecran de autenticacao extraidos para ficheiro dedicado.
2. CSS de login passa a carregar junto ao chunk do LoginView (lazy), em vez de ficar no bundle global.

Arquivos:
1. src/components/LoginView.css (novo)
2. src/components/LoginView.tsx
3. src/styles.css

Resultado observado em build:
1. CSS global principal reduziu de ~97.99 kB para ~93.97 kB.
2. Novo chunk CSS de login: ~1.99 kB.
3. Menor custo de CSS para sessoes autenticadas.

## 3.6 Limpeza de CSS legado duplicado (topbar/menu/icon antigo)

Implementado:
1. Removidos blocos legados de topbar/menu/ghost-button/icon-button em styles.css que estavam duplicados e sobrepostos por redesign.css.
2. Mantido comportamento visual de alerta de notificacao nao lida ao mover a animacao para redesign.css.

Arquivos:
1. src/styles.css
2. src/redesign.css

Resultado observado em build:
1. CSS global principal reduziu de ~93.97 kB para ~91.10 kB.
2. Reducao adicional de ~2.87 kB no CSS principal.

## 3.7 Remocao de classes CTA legadas sem uso

Implementado:
1. Removidas classes antigas de CTA (cta-button/cta-primary/cta-ghost/cta-light) em styles.css e redesign.css.
2. Mantido padrao unico com componente Button (ui-button variants).

Arquivos:
1. src/styles.css
2. src/redesign.css

Resultado observado em build:
1. CSS global principal reduziu de ~91.10 kB para ~90.62 kB.
2. Reducao adicional de ~0.48 kB no CSS principal.

## 3.8 Consolidacao de estilos de notificacoes (styles -> redesign)

Implementado:
1. Migrados seletores base de notificacoes para redesign.css (filtros, lista, unread marker, leading, estrutura de card e estados vazios).
2. Removido bloco legado duplicado de notificacoes em styles.css.

Arquivos:
1. src/redesign.css
2. src/styles.css

Resultado observado em build:
1. CSS global principal reduziu de ~90.62 kB para ~89.20 kB.
2. Reducao adicional de ~1.42 kB no CSS principal.

## 3.9 Consolidacao de estilos home legados (styles -> redesign)

Implementado:
1. Removido bloco legado completo de estilos home-* em styles.css (hero, main, aside, grid, card, note e variacoes), mantendo a fonte unica em redesign.css.
2. Preservado o layout responsivo e o visual atual pela cobertura existente no redesign.

Arquivos:
1. src/styles.css

Resultado observado em build:
1. CSS global principal reduziu de ~89.20 kB para ~87.50 kB.
2. Reducao adicional de ~1.70 kB no CSS principal.

## 3.10 Limpeza de CSS morto (keyframes sem uso)

Implementado:
1. Removida animacao @keyframes pulse em styles.css por estar sem qualquer referencia ativa no projeto.

Arquivos:
1. src/styles.css

Resultado observado em build:
1. CSS global principal reduziu de ~87.50 kB para ~87.41 kB.
2. Reducao adicional de ~0.09 kB no CSS principal.

## 3.11 Consolidacao de estilos do hero de perfil (styles -> redesign)

Implementado:
1. Removido bloco legado de estilos do hero de perfil em styles.css (profile-hero, hero-main, completion-card, hero-chips e completion-track).
2. Mantidas no redesign.css as regras realmente usadas no ProfilePage, incluindo completion-track e completion-card--highlight, em escopo especifico de profile-hero.

Arquivos:
1. src/styles.css
2. src/redesign.css

Resultado observado em build:
1. CSS global principal reduziu de ~87.41 kB para ~86.36 kB.
2. Reducao adicional de ~1.05 kB no CSS principal.

## 4. Validacao tecnica

1. Typecheck/build: OK
2. Erros nos arquivos alterados: nenhum

Comando validado:
- npm run build

## 5. Proximo ciclo recomendado (ordem de impacto)

## P1 (imediato)
1. Definir width/height explicitos para imagens acima da dobra e logos reutilizados.
2. Revisar CSS critico por rota e reduzir regras nao usadas mais pesadas.

## P2 (curto prazo)
1. Revisar preload/prefetch de rotas de maior frequencia com base em navegacao real.
2. Auditar uso de bibliotecas para remover codigo morto.

## P3 (medio prazo)
1. Automatizar auditoria Lighthouse em CI para prevenir regressao.
2. Definir budget de performance por release (bundle + LCP + CLS).

## 6. KPI de acompanhamento desse passo

1. SEO (Lighthouse): elevar de 92 para >= 98.
2. JS inicial (bundle principal): manter <= 190 kB bruto no build atual ou reduzir mais.
3. Regressao de performance em release: 0 degradacoes acima de 5% sem justificativa.

Status do passo:
- Passo 3 concluido (baseline + quick wins aplicados)
- Pronto para ciclo de refinamento P1/P2
