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
    max_tokens: 400,
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

/**
 * Concordância de atributos entre a foto da busca e um candidato. Retorna um
 * score 0..1 e a lista de motivos (para exibir "por que casou" na UI).
 * O candidato pode ter vision_tags (jsonb) e/ou os campos do cadastro (color, size).
 */
export function attributeAgreement(
  search: VisionTags | null,
  candidate: { vision_tags?: any; color?: string | null; size?: string | null },
): { score: number; reasons: string[]; comparable: number } {
  if (!search) return { score: 0, reasons: [], comparable: 0 };
  const candTags: VisionTags | null =
    candidate.vision_tags && typeof candidate.vision_tags === 'object' ? candidate.vision_tags : null;

  const reasons: string[] = [];
  let hits = 0;
  let comparable = 0;

  // Cor primária (tags do candidato ou cor de cadastro em texto livre)
  const sColor = colorKey(search.color_primary);
  const cColor = colorKey(candTags?.color_primary) ?? colorKey(candidate.color);
  if (sColor && cColor) {
    comparable++;
    if (sColor === cColor) { hits++; reasons.push(`mesma cor (${sColor})`); }
  }

  // Padrão de pelagem
  if (search.pattern && candTags?.pattern) {
    comparable++;
    if (search.pattern === candTags.pattern) { hits++; reasons.push(`mesmo padrão (${search.pattern})`); }
  }

  // Porte
  const cSize = candTags?.size_estimate ?? (typeof candidate.size === 'string' ? candidate.size : null);
  if (search.size_estimate && cSize) {
    comparable++;
    if (search.size_estimate === cSize) { hits++; reasons.push('porte parecido'); }
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
  return { score, reasons, comparable };
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
  let wV = 0.55;
  let wA = hasAttr ? 0.30 : 0;
  let wG = hasGeo ? 0.15 : 0;
  const total = wV + wA + wG;
  wV /= total; wA /= total; wG /= total;
  return wV * Math.max(0, Math.min(1, visualSim)) + wA * attrScore + wG * geoScore;
}
