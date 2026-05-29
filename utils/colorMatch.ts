// Match de cor "tolerante" para o filtro de pets.
//
// O usuário pode digitar "preta" e o pet ter sido cadastrado como "preto",
// "negro" ou "Pelo Preto Brilhante". Combinamos duas estratégias:
//
//  1. Normalização: lowercase + remoção de acentos (NFD + faixa combinante).
//  2. Mapa de sinônimos: grupos canônicos com variações de gênero/plural e
//     sinônimos comuns no Brasil. Qualquer variação dentro do mesmo grupo
//     casa com qualquer outra.
//
// Comparação por palavra (token): cada palavra do filtro precisa ter ao menos
// uma variante encontrada no campo do pet (substring após normalizar).

const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Grupos de sinônimos — chave canônica → todas as variantes equivalentes.
const COLOR_SYNONYMS: Record<string, string[]> = {
  preto: ['preto', 'preta', 'pretos', 'pretas', 'negro', 'negra', 'negros', 'negras'],
  branco: ['branco', 'branca', 'brancos', 'brancas', 'albino', 'albina'],
  marrom: ['marrom', 'marrons', 'castanho', 'castanha', 'castanhos', 'castanhas', 'chocolate'],
  caramelo: ['caramelo', 'caramela', 'caramelos', 'caramelas', 'mel'],
  amarelo: ['amarelo', 'amarela', 'amarelos', 'amarelas', 'dourado', 'dourada', 'dourados', 'douradas', 'loiro', 'loira'],
  cinza: ['cinza', 'cinzas', 'cinzento', 'cinzenta', 'grisalho', 'grisalha', 'prata', 'prateado', 'prateada'],
  bege: ['bege', 'beges', 'creme'],
  laranja: ['laranja', 'laranjas', 'ruivo', 'ruiva', 'avermelhado', 'avermelhada'],
  vermelho: ['vermelho', 'vermelha', 'vermelhos', 'vermelhas'],
  azul: ['azul', 'azuis'],
  // Padrões de pelagem (tratados como "cor" no app)
  rajado: ['rajado', 'rajada', 'rajados', 'rajadas', 'tigrado', 'tigrada', 'tigrados', 'tigradas', 'listrado', 'listrada'],
  malhado: ['malhado', 'malhada', 'malhados', 'malhadas', 'mosqueado', 'mosqueada', 'manchado', 'manchada', 'pintado', 'pintada', 'salpicado', 'salpicada'],
  tricolor: ['tricolor', 'tricolores', 'tres cores', 'tres cor'],
  bicolor: ['bicolor', 'bicolores', 'duas cores'],
};

// Índice variante → canônica (pré-computado para lookup O(1)).
const VARIANT_TO_CANON: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [canon, vars] of Object.entries(COLOR_SYNONYMS)) {
    for (const v of vars) map[normalize(v)] = canon;
  }
  return map;
})();

// Expande uma palavra para todas as variantes do seu grupo (ou só ela, se não
// houver grupo cadastrado).
function expand(token: string): string[] {
  const canon = VARIANT_TO_CANON[token];
  if (!canon) return [token];
  return COLOR_SYNONYMS[canon].map(normalize);
}

/**
 * Retorna true se a cor do pet bate com o que o usuário digitou no filtro,
 * tolerando acentos, maiúsculas/minúsculas, gênero/plural e sinônimos.
 */
export function colorMatches(petColor: string | null | undefined, query: string | null | undefined): boolean {
  const q = (query ?? '').trim();
  if (!q) return true; // filtro vazio = aceita tudo
  const haystack = normalize(petColor ?? '');
  if (!haystack) return false;
  const tokens = normalize(q).split(/\s+/).filter(Boolean);
  return tokens.every((t) => expand(t).some((v) => haystack.includes(v)));
}
