/**
 * translationService.ts
 *
 * Dicionário PT-PT → PT-BR com substituição case-insensitive e preservação de capitalização.
 * Utilizado pelo domTranslator para processar todos os nós de texto do DOM automaticamente.
 *
 * A ordem dos pares importa: frases compostas devem vir antes das palavras que as compõem.
 */

/**
 * Pares [PT-PT, PT-BR] — frases compostas primeiro para evitar substituições parciais.
 */
const PT_BR_PAIRS: [string, string][] = [
  // Frases compostas (devem vir PRIMEIRO)
  ['recibo de vencimento', 'holerite'],
  ['recibos de vencimento', 'holerites'],
  ['subsídio de natal', '13.º salário'],
  ['subsídio de férias', 'abono de férias'],
  ['baixa médica', 'atestado médico'],
  ['baixas médicas', 'atestados médicos'],
  ['cartão de cidadão', 'RG/CPF'],
  ['cartões de cidadão', 'RG/CPFs'],
  ['número de contribuinte', 'CPF'],
  ['números de contribuinte', 'CPFs'],
  ['segurança social', 'previdência social'],
  ['código postal', 'CEP'],
  ['códigos postais', 'CEPs'],
  ['licença de maternidade', 'licença-maternidade'],
  ['licença de paternidade', 'licença-paternidade'],
  ['chefia direta', 'gestor direto'],
  ['chefia directa', 'gestor direto'],
  ['chefias diretas', 'gestores diretos'],
  ['palavra-passe', 'senha'],
  ['palavras-passe', 'senhas'],
  // Pessoas
  ['utilizador', 'usuário'],
  ['utilizadores', 'usuários'],
  // Acoes
  ['guardar', 'salvar'],
  ['apagar', 'excluir'],
  ['descarregar', 'baixar'],
  ['submeter', 'enviar'],
  ['registar', 'cadastrar'],
  ['associar', 'vincular'],
  // Ficheiros
  ['ficheiro', 'arquivo'],
  ['ficheiros', 'arquivos'],
  // Configuracoes
  ['definições', 'configurações'],
  // Organizacao
  ['equipa', 'equipe'],
  ['equipas', 'equipes'],
  ['chefia', 'gerência'],
  ['chefias', 'gerências'],
  // Formação
  ['formação', 'treinamento'],
  ['formações', 'treinamentos'],
  // Pedidos
  ['pedido', 'solicitação'],
  ['pedidos', 'solicitações'],
  // Contacto
  ['telemóvel', 'celular'],
  ['telemóveis', 'celulares'],
  ['contacto', 'contato'],
  ['contactos', 'contatos'],
  ['morada', 'endereco'],
  ['morada', 'endereço'],
  ['moradas', 'endereços'],
  ['localidade', 'cidade'],
  ['localidades', 'cidades'],
  ['distrito', 'estado'],
  ['distritos', 'estados'],
  ['concelho', 'municipio'],
  ['concelho', 'município'],
  ['concelhos', 'municípios'],
  ['freguesia', 'bairro'],
  ['freguesias', 'bairros'],
  // Fiscal
  ['contribuinte', 'CPF'],
  // RH
  ['vencimento', 'salário'],
  ['vencimentos', 'salários'],
  ['subsídio', 'benefício'],
  ['subsídios', 'benefícios'],
  ['registo', 'registro'],
  ['registos', 'registros'],
  ['talao', 'comprovante'],
  ['talão', 'comprovante'],
  ['talões', 'comprovantes'],
  ['contactar', 'contatar'],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '\\-');
}

function preserveCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] !== original[0].toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const WORD_START = '(?<![\\wÀ-ÿ])';
const WORD_END = '(?![\\wÀ-ÿ])';

const compiledPairs: [RegExp, string][] = PT_BR_PAIRS.map(([ptPT, ptBR]) => [
  new RegExp(`${WORD_START}${escapeRegex(ptPT)}${WORD_END}`, 'gi'),
  ptBR,
]);

export function translateToBrazilian(text: string): string {
  let result = text;
  for (const [regex, ptBR] of compiledPairs) {
    result = result.replace(regex, (match) => preserveCase(match, ptBR));
    regex.lastIndex = 0;
  }
  return result;
}

const apiCache = new Map<string, string>();

const LIBRETRANSLATE_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_LIBRETRANSLATE_URL ??
  'https://libretranslate.com';

export async function translateWithLibreTranslate(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  if (!text.trim()) return text;
  const cacheKey = `${source}:${target}:${text}`;
  if (apiCache.has(cacheKey)) return apiCache.get(cacheKey)!;
  try {
    const response = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source, target, format: 'text' }),
    });
    if (!response.ok) return text;
    const data = (await response.json()) as { translatedText?: string };
    const translated = data.translatedText ?? text;
    apiCache.set(cacheKey, translated);
    return translated;
  } catch {
    return text;
  }
}