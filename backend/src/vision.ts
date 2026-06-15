/**
 * Vision-tags: extrai características visuais estruturadas de um pet (cor, padrão,
 * porte, marcas distintivas) a partir da foto, usando Claude (visão). Essas tags
 * alimentam o "score híbrido" do match — para o sistema raciocinar sobre manchas
 * e padrões, não só sobre a similaridade holística do embedding (CLIP).
 *
 * Tudo aqui é best-effort: se a chave da Anthropic faltar, ou a análise falhar,
 * o match continua funcionando só com o embedding (degradação graciosa).
 */
import Anthropic from '@anthropic-ai/sdk';

const VISION_MODEL = 'claude-haiku-4-5';

export function isVisionTagsEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type PetPattern = 'solido' | 'bicolor' | 'tricolor' | 'rajado' | 'tigrado' | 'malhado' | 'manchado';

export interface VisionTags {
  species: 'cachorro' | 'gato' | 'passaro' | 'outro' | null;
  color_primary: string | null;
  color_secondary: string | null;
  pattern: PetPattern | null;
  coat: 'curto' | 'medio' | 'longo' | null;
  size_estimate: 'pequeno' | 'medio' | 'grande' | null;
  distinctive_marks: string[];
  confidence: number; // 0..1
  // Composição de cor da PELAGEM (grupo de cor + % da pelagem, desc). Opcional
  // para retrocompat: pets antigos não têm; o match cai no fallback de cor única.
  coat_colors?: { color: string; pct: number }[];
}

const VISION_SYSTEM =
  'Você é um extrator preciso de características visuais de pets para um app de pets perdidos. ' +
  'Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto extra.';

const VISION_PROMPT =
  'Analise o animal na foto e devolva JSON com EXATAMENTE estas chaves:\n' +
  '- species: cachorro | gato | passaro | outro | null\n' +
  '- color_primary: cor predominante em pt-br minúsculo (ex.: caramelo, preto, branco, marrom, cinza, dourado, tigrado) ou null\n' +
  '- color_secondary: 2ª cor (pt-br) ou null\n' +
  '- pattern: solido | bicolor | tricolor | rajado | tigrado | malhado | manchado | null\n' +
  '- coat: curto | medio | longo | null\n' +
  '- size_estimate: pequeno | medio | grande | null\n' +
  '- distinctive_marks: array de 0 a 5 marcas distintivas curtas em pt-br (ex.: "peito branco", "orelha esquerda preta", "meia branca pata traseira", "mancha no olho direito"). NÃO invente — apenas o que ver claramente.\n' +
  '- coat_colors: array ordenado por proporção DECRESCENTE de objetos {"color": <cor pt-br>, "pct": <inteiro>}, estimando a fração da PELAGEM de cada cor (somando ~100). Considere SOMENTE o animal: IGNORE grama, chão, parede, céu, objetos, sombras e reflexos do fundo. Use os mesmos nomes de cor de color_primary. 1 a 4 itens.\n' +
  '- IMPORTANTE: pelos de um pet PRETO clareados/desbotados pelo sol CONTINUAM sendo preto; brilho/reflexo de luz NÃO é uma cor. Só registre uma 2ª cor (e só use pattern diferente de solido) se houver manchas de COR REALMENTE DIFERENTE, bem definidas e em área relevante (>~15% da pelagem).\n' +
  '- confidence: número de 0 a 1\n' +
  'Use null quando não tiver certeza. Não adicione comentários nem texto fora do JSON.';

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as T)
    : null;
}
function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
}

/**
 * Normaliza coat_colors: agrupa por colorKey (sinônimos), descarta cores <5%
 * (ruído de sol/sombra), renormaliza para inteiros somando ~100, no máx. 3.
 * Lixo/ausente → undefined (o match cai no fallback de cor única).
 */
function normCoat(arr: unknown): { color: string; pct: number }[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const acc = new Map<string, number>();
  for (const e of arr as any[]) {
    const k = colorKey(e?.color);
    const p = Number(e?.pct);
    if (k && Number.isFinite(p) && p > 0) acc.set(k, (acc.get(k) ?? 0) + p);
  }
  let items = [...acc].map(([color, pct]) => ({ color, pct }));
  const tot = items.reduce((s, i) => s + i.pct, 0);
  if (tot <= 0) return undefined;
  items = items
    .map((i) => ({ color: i.color, pct: i.pct / tot }))
    .filter((i) => i.pct >= 0.05)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  const t2 = items.reduce((s, i) => s + i.pct, 0);
  if (t2 <= 0) return undefined;
  return items.map((i) => ({ color: i.color, pct: Math.round((i.pct / t2) * 100) }));
}

/** Parser robusto: extrai o 1º objeto JSON do texto e valida/coage os campos. */
export function parseVisionTags(text: string): VisionTags | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: any;
  try { obj = JSON.parse(m[0]); } catch { return null; }

  const marks = Array.isArray(obj.distinctive_marks)
    ? obj.distinctive_marks
        .filter((x: any) => typeof x === 'string' && x.trim())
        .slice(0, 5)
        .map((x: string) => x.trim().toLowerCase())
    : [];
  const conf = Number(obj.confidence);

  return {
    species: pick(obj.species, ['cachorro', 'gato', 'passaro', 'outro'] as const),
    color_primary: cleanStr(obj.color_primary),
    color_secondary: cleanStr(obj.color_secondary),
    pattern: pick(obj.pattern, ['solido', 'bicolor', 'tricolor', 'rajado', 'tigrado', 'malhado', 'manchado'] as const),
    coat: pick(obj.coat, ['curto', 'medio', 'longo'] as const),
    size_estimate: pick(obj.size_estimate, ['pequeno', 'medio', 'grande'] as const),
    distinctive_marks: marks,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
    coat_colors: normCoat(obj.coat_colors),
  };
}

/** Analisa uma foto e retorna as vision-tags (ou null se desativado/falha leve). */
export async function generatePetVisionTags(imageUrl: string): Promise<VisionTags | null> {
  if (!isVisionTagsEnabled()) return null;

  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`Falha ao baixar imagem (${imgResp.status})`);
  const ct = (imgResp.headers.get('content-type') || '').toLowerCase();
  const mediaType = ct.includes('png') ? 'image/png'
    : ct.includes('webp') ? 'image/webp'
    : ct.includes('gif') ? 'image/gif'
    : 'image/jpeg';
  const data = Buffer.from(await imgResp.arrayBuffer()).toString('base64');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 500,
    system: VISION_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType as any, data } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  });
  const text = (resp.content as any[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return parseVisionTags(text);
}

// ============================================================================
// Score híbrido: combina similaridade visual (CLIP) + concordância de atributos
// (manchas/padrões/cor/porte das vision-tags) + proximidade geográfica.
// ============================================================================

// Grupos de cor (sinônimos pt-br) para casar "preta" com "preto", etc.
const COLOR_GROUPS: Record<string, string[]> = {
  preto: ['preto', 'preta', 'negro', 'negra'],
  branco: ['branco', 'branca'],
  marrom: ['marrom', 'castanho', 'castanha', 'chocolate', 'cafe'],
  caramelo: ['caramelo', 'amarelo', 'amarela', 'dourado', 'dourada', 'bege', 'creme', 'fulvo'],
  cinza: ['cinza', 'cinzento', 'cinzenta', 'grafite', 'prata', 'prateado'],
  laranja: ['laranja', 'ruivo', 'ruiva', 'rajado'],
  tigrado: ['tigrado', 'tigrada', 'brindle'],
};

export function colorKey(c: string | null | undefined): string | null {
  if (!c) return null;
  const w = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (const [k, syns] of Object.entries(COLOR_GROUPS)) {
    if (syns.some((s) => w.includes(s))) return k;
  }
  const first = w.split(/[\s,;/]+/)[0];
  return first || null;
}

function marksSimilar(a: string, b: string): boolean {
  const ta = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  return b.split(/\s+/).some((w) => w.length > 2 && ta.has(w));
}

/** Vetor de cor da pelagem: grupo de cor → fração 0..1 (a partir de coat_colors). */
function coatVec(t: VisionTags | null | undefined): Record<string, number> | null {
  if (!t?.coat_colors?.length) return null;
  const v: Record<string, number> = {};
  let s = 0;
  for (const c of t.coat_colors) {
    const k = colorKey(c.color) ?? c.color;
    v[k] = (v[k] ?? 0) + c.pct;
    s += c.pct;
  }
  if (s <= 0) return null;
  for (const k in v) v[k] /= s;
  return v;
}

/** Distância L1/2 entre vetores de cor: 0 = idênticos, 1 = disjuntos. */
function colorDistance(a: Record<string, number>, b: Record<string, number>): number {
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  let d = 0;
  for (const k of ks) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return d / 2;
}

// Escala grosseira de luminância por grupo de cor. O gate só dispara entre cores
// de luminância CLARAMENTE distinta (salto ≥2) — evita punir o MESMO pet quando o
// modelo oscila entre cores confundíveis (marrom↔caramelo, cinza↔preto, branco↔creme).
const COLOR_LIGHTNESS: Record<string, number> = {
  preto: 0, cinza: 1, marrom: 1, tigrado: 1, caramelo: 2, laranja: 2, branco: 3,
};

/**
 * Gate CONSERVADOR de inversão de dominante: só true quando (a) uma cor domina
 * forte (≥65%) num lado e está quase ausente (≤15%) no outro — composições quase
 * invertidas (preto-sólido × branco-manchado) — E (b) os dominantes têm luminância
 * claramente distinta. Variação normal de luz desloca dentro do mesmo grupo
 * (preto continua preto) e nunca atinge esses limiares juntos.
 */
function dominantIncompatible(dS: Record<string, number>, dC: Record<string, number>): boolean {
  const dom = (d: Record<string, number>): [string, number] => {
    const e = Object.entries(d).sort((x, y) => y[1] - x[1])[0];
    return e ? [e[0], e[1]] : ['', 0];
  };
  const [gS, pS] = dom(dS);
  const [gC, pC] = dom(dC);
  const inverted = (pS >= 0.65 && (dC[gS] ?? 0) <= 0.15) || (pC >= 0.65 && (dS[gC] ?? 0) <= 0.15);
  if (!inverted) return false;
  const lS = COLOR_LIGHTNESS[gS];
  const lC = COLOR_LIGHTNESS[gC];
  if (lS == null || lC == null) return false; // cor fora da escala conhecida → não arrisca
  return Math.abs(lS - lC) >= 2;
}

function isOppositeSize(a: string, b: string): boolean {
  return (a === 'pequeno' && b === 'grande') || (a === 'grande' && b === 'pequeno');
}

/**
 * Concordância de atributos entre a foto da busca e um candidato. Retorna um
 * score 0..1 e a lista de motivos (para exibir "por que casou" na UI).
 * O candidato pode ter vision_tags (jsonb) e/ou os campos do cadastro (color, size).
 */
export function attributeAgreement(
  search: VisionTags | null,
  candidate: { vision_tags?: any; color?: string | null; size?: string | null },
): { score: number; reasons: string[]; comparable: number; disagree: number; gate: boolean } {
  if (!search) return { score: 0, reasons: [], comparable: 0, disagree: 0, gate: false };
  const candTags: VisionTags | null =
    candidate.vision_tags && typeof candidate.vision_tags === 'object' ? candidate.vision_tags : null;

  const reasons: string[] = [];
  let hits = 0;
  let comparable = 0;
  let disagree = 0; // discordâncias claras (cor/porte muito diferentes) = sinal de "não é"

  // Cor da pelagem — preferir a COMPOSIÇÃO (coat_colors): distingue "preto sólido"
  // de "branco com manchas pretas", o que a cor #1 sozinha não faz. Se faltar
  // coat_colors (tags antigas), cai no fallback de cor única (comportamento atual).
  let colorGateFired = false;
  const vS = coatVec(search);
  const vC = coatVec(candTags);
  if (vS && vC) {
    comparable++;
    const agree = 1 - colorDistance(vS, vC); // graduado 0..1 (substitui o binário)
    hits += agree;
    if (agree >= 0.65 && search.coat_colors?.length) {
      const top = search.coat_colors[0];
      reasons.push(`cor compatível (${top.color} ~${top.pct}%)`);
    }
    // Gate de inversão de dominante — só com confiança alta dos DOIS lados
    // (foto ruim de sol vem com confidence baixa → gate desligado, sem regressão).
    const conf = (search.confidence ?? 0) >= 0.7 && (candTags?.confidence ?? 0) >= 0.7;
    if (conf && dominantIncompatible(vS, vC)) { disagree++; colorGateFired = true; }
  } else {
    const sColor = colorKey(search.color_primary);
    const cColor = colorKey(candTags?.color_primary) ?? colorKey(candidate.color);
    if (sColor && cColor) {
      comparable++;
      if (sColor === cColor) { hits++; reasons.push(`mesma cor (${sColor})`); }
      else disagree++; // ex.: preto x branco — quase certamente não é o mesmo pet
    }
  }

  // Padrão de pelagem. Com coat_colors vira só REFORÇO (a cor já é o canal de
  // discordância da pelagem) e é suprimido se o gate disparou — evita o chip
  // enganoso "mesmo padrão (bicolor)" e a dupla-contagem do mesmo fenômeno.
  if (search.pattern && candTags?.pattern) {
    if (vS && vC) {
      if (search.pattern === candTags.pattern && !colorGateFired) {
        hits++; reasons.push(`mesmo padrão (${search.pattern})`);
      }
    } else {
      comparable++;
      if (search.pattern === candTags.pattern) { hits++; reasons.push(`mesmo padrão (${search.pattern})`); }
      else disagree++;
    }
  }

  // Porte
  const cSize = candTags?.size_estimate ?? (typeof candidate.size === 'string' ? candidate.size : null);
  if (search.size_estimate && cSize) {
    comparable++;
    if (search.size_estimate === cSize) { hits++; reasons.push('porte parecido'); }
    else if (isOppositeSize(search.size_estimate, cSize)) disagree++; // só pequeno x grande
  }

  // Pelagem (curto/médio/longo)
  if (search.coat && candTags?.coat) {
    comparable++;
    if (search.coat === candTags.coat) { hits++; reasons.push('pelagem parecida'); }
  }

  // Marcas distintivas (peso maior — é o sinal mais identificador)
  if (search.distinctive_marks.length && candTags?.distinctive_marks?.length) {
    comparable++;
    const overlap = search.distinctive_marks.filter((m) =>
      candTags.distinctive_marks.some((cm) => marksSimilar(m, cm)),
    );
    if (overlap.length) {
      hits += Math.min(2, overlap.length); // marca em comum vale mais
      reasons.push(`marca em comum: ${overlap[0]}`);
    }
  }

  const score = comparable > 0 ? Math.min(1, hits / comparable) : 0;
  return { score, reasons, comparable, disagree, gate: colorGateFired };
}

/**
 * Score final 0..1 = visual + atributos + geo. Os pesos são RENORMALIZADOS sobre
 * os sinais disponíveis: se não há atributos comparáveis (vision off/falhou) ou
 * não há geo, esses pesos caem e o score não é penalizado por falta de sinal
 * (no limite, sem atributos e sem geo, score = similaridade visual pura).
 */
export function hybridScore(
  visualSim: number,
  attrScore: number,
  hasAttr: boolean,
  distanceM: number | null,
  radiusM: number,
): number {
  const hasGeo = distanceM != null && Number.isFinite(distanceM);
  const geoScore = hasGeo ? Math.max(0, 1 - (distanceM as number) / Math.max(1, radiusM)) : 0;
  // Visual dominante (CLIP), com atributos/geo como reforço — evita reordenar
  // demais por proximidade. Recalibrar quando houver dados em match_searches.
  let wV = 0.70;
  let wA = hasAttr ? 0.22 : 0;
  let wG = hasGeo ? 0.08 : 0;
  const total = wV + wA + wG;
  wV /= total; wA /= total; wG /= total;
  return wV * Math.max(0, Math.min(1, visualSim)) + wA * attrScore + wG * geoScore;
}
