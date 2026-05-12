/**
 * domTranslator.ts
 *
 * Tradução automática de toda a árvore DOM — sem modificar nenhum componente React.
 * Funciona como o Google Translate: caminha todos os nós de texto visíveis,
 * aplica o dicionário PT-PT→PT-BR e observa mutações futuras para processar
 * conteúdo novo renderizado pelo React.
 *
 * Ao desativar, restaura os textos originais guardados em WeakMap.
 */

import { translateToBrazilian } from './translationService';

/** Nós cujo conteúdo NÃO deve ser traduzido */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'CODE',
  'PRE',
  'INPUT',
  'SELECT',
]);

/** Texto original antes da tradução (para restauração) */
const originalTexts = new WeakMap<Text, string>();

let observer: MutationObserver | null = null;
let active = false;

/** Fila de nós a processar, debitada por requestAnimationFrame */
const pendingNodes = new Set<Node>();
let rafId: number | null = null;

function shouldSkip(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute('data-no-translate')) return true;
    el = el.parentElement;
  }
  return false;
}

function processTextNode(node: Text, translate: boolean): void {
  if (shouldSkip(node)) return;
  const text = node.textContent ?? '';
  if (!text.trim()) return;

  if (translate) {
    /* Guarda original apenas uma vez — mesmo que React renderize novamente */
    if (!originalTexts.has(node)) {
      originalTexts.set(node, text);
    }
    const original = originalTexts.get(node)!;
    const translated = translateToBrazilian(original);
    if (translated !== node.textContent) {
      node.textContent = translated;
    }
  } else {
    const original = originalTexts.get(node);
    if (original !== undefined && node.textContent !== original) {
      node.textContent = original;
    }
  }
}

function walkAndProcess(root: Node, translate: boolean): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Text | null;
  /* Recolhe antes de modificar para evitar invalidar o iterador */
  while ((node = walker.nextNode() as Text | null)) {
    nodes.push(node);
  }
  for (const n of nodes) {
    processTextNode(n, translate);
  }
}

function flushPending(): void {
  rafId = null;
  if (!active) return;
  for (const node of pendingNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      processTextNode(node as Text, true);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      walkAndProcess(node, true);
    }
  }
  pendingNodes.clear();
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!active) return;
  for (const mutation of mutations) {
    for (const added of mutation.addedNodes) {
      /* Ignora nós que são resultado das nossas próprias modificações de texto */
      if (added.nodeType === Node.TEXT_NODE && originalTexts.has(added as Text)) continue;
      pendingNodes.add(added);
    }
  }
  if (pendingNodes.size > 0 && rafId === null) {
    rafId = requestAnimationFrame(flushPending);
  }
}

/**
 * Ativa a tradução PT-BR em toda a página.
 * Faz um walk inicial e inicia o MutationObserver para conteúdo futuro.
 */
export function activateBrazilianTranslation(): void {
  active = true;

  if (observer) observer.disconnect();

  /* Walk imediato */
  walkAndProcess(document.body, true);

  /* Observa inserções futuras do React */
  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Desativa a tradução PT-BR e restaura todos os textos originais.
 */
export function deactivateBrazilianTranslation(): void {
  active = false;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingNodes.clear();

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  /* Restaura textos originais guardados */
  walkAndProcess(document.body, false);
}
