/**
 * Geração de embeddings de imagem via Replicate (CLIP ViT-L/14 → 768 dimensões).
 *
 * Usa o endpoint /v1/predictions com `version` (modelo da comunidade) +
 * header `Prefer: wait`, que aguarda o resultado de forma síncrona (~60s).
 *
 * Modelo: krthr/clip-embeddings — aceita { image } ou { text }, devolve { embedding }.
 */

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

// Version hash da última versão do modelo krthr/clip-embeddings (CLIP ViT-L/14)
const MODEL_VERSION = '1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4';
export const EMBEDDING_DIMS = 768;

export function isEmbeddingEnabled(): boolean {
  return !!REPLICATE_TOKEN;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 4;

export async function generateImageEmbedding(imageUrl: string, attempt = 0): Promise<number[]> {
  if (!REPLICATE_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN não configurado no .env');
  }

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      version: MODEL_VERSION,
      input: { image: imageUrl },
    }),
  });

  // 429 = limite de taxa (conta com pouco crédito tem burst de 1). Reenvia
  // respeitando o tempo de reset informado pela Replicate.
  if (response.status === 429 && attempt < MAX_RETRIES) {
    const text = await response.text().catch(() => '');
    const retryAfter = Number(response.headers.get('retry-after'));
    const m = text.match(/resets? in (\d+)\s*s/i);
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : m ? Number(m[1]) : 3;
    console.warn(`[embedding] 429 da Replicate — aguardando ${waitSec + 1}s (tentativa ${attempt + 1}/${MAX_RETRIES})`);
    await sleep((waitSec + 1) * 1000);
    return generateImageEmbedding(imageUrl, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 429) {
      throw new Error('Muitas análises em sequência. Aguarde alguns segundos e tente novamente.');
    }
    throw new Error(`Replicate erro ${response.status}: ${text}`);
  }

  const data: any = await response.json();

  if (data.status === 'failed' || data.error) {
    throw new Error(`Replicate prediction falhou: ${data.error ?? 'desconhecido'}`);
  }

  // Output esperado: { embedding: number[] }
  const embedding: number[] | undefined = Array.isArray(data.output)
    ? data.output
    : data.output?.embedding;

  if (!embedding || !Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(`Embedding inválido (esperado ${EMBEDDING_DIMS} dims, recebido ${embedding?.length ?? 'nada'})`);
  }

  return embedding;
}
