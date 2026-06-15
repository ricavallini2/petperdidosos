/**
 * Geração de embeddings de imagem via Replicate (CLIP ViT-L/14 → 768 dimensões).
 *
 * Usa o endpoint /v1/predictions com `version` (modelo da comunidade) +
 * header `Prefer: wait`, que aguarda o resultado de forma síncrona (~60s).
 *
 * As chamadas ao Replicate são SERIALIZADAS (single-flight): a conta tem burst
 * baixo (1 req/s sem cartão de crédito), então disparar chamadas concorrentes
 * (cadastro de pet + busca ao mesmo tempo) gerava HTTP 429. A fila garante uma
 * chamada por vez — elimina o 429 na origem. Cada chamada tem timeout para não
 * travar a request do usuário além da janela do `Prefer: wait`.
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
const DEFAULT_TIMEOUT_MS = 75_000; // acima dos ~60s do `Prefer: wait`

// Fila single-flight: uma chamada ao Replicate por vez (cadastro/busca não competem).
let replicateChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = replicateChain.then(fn, fn);
  replicateChain = run.catch(() => {}); // uma rejeição nunca quebra a fila
  return run as Promise<T>;
}

export async function generateImageEmbedding(
  imageUrl: string,
  opts: { maxRetries?: number; timeoutMs?: number } = {},
): Promise<number[]> {
  return serialize(() =>
    callReplicate(imageUrl, opts.maxRetries ?? MAX_RETRIES, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 0),
  );
}

async function callReplicate(
  imageUrl: string,
  maxRetries: number,
  timeoutMs: number,
  attempt: number,
): Promise<number[]> {
  if (!REPLICATE_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN não configurado no .env');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: any;
  try {
    response = await fetch('https://api.replicate.com/v1/predictions', {
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
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('A análise demorou demais. Tente novamente em instantes.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  // 429 = limite de taxa. Como as chamadas já são serializadas, isso só ocorre
  // sob throttling da conta — reenvia respeitando o tempo de reset + jitter.
  if (response.status === 429 && attempt < maxRetries) {
    const text = await response.text().catch(() => '');
    const retryAfter = Number(response.headers.get('retry-after'));
    const m = text.match(/resets? in (\d+)\s*s/i);
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : m ? Number(m[1]) : 3;
    const jitter = Math.floor(Math.random() * 500);
    console.warn(`[embedding] 429 da Replicate — aguardando ${waitSec + 1}s (tentativa ${attempt + 1}/${maxRetries})`);
    await sleep((waitSec + 1) * 1000 + jitter);
    return callReplicate(imageUrl, maxRetries, timeoutMs, attempt + 1);
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
