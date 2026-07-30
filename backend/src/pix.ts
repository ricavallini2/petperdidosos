// ============================================================================
// PIX — gerador de payload EMV (BR Code / "copia e cola") ESTÁTICO.
// Padrão Banco Central (Manual BR Code): TLV (id + tamanho 2 dígitos + valor)
// com CRC16-CCITT no final. Não processa pagamento — apenas monta o código que
// qualquer app de banco lê. Usado na página pública de doação (/doar).
// ============================================================================

const CRC_POLY = 0x1021;
const CRC_INIT = 0xffff;

function crc16(payload: string): string {
  let crc = CRC_INIT;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ CRC_POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Campo TLV: id (2) + tamanho (2) + valor
function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

// Nome/cidade do recebedor: sem acentos, maiúsculas, tamanho limitado pelo padrão
function sanitize(text: string, maxLen: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 .-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Normalização da chave Pix.
//
// O BR Code aceita a chave literalmente: se o formato estiver errado, o código
// é gerado sem erro nenhum e só falha no app do banco do doador — sem ninguém
// descobrir. Por isso a chave é validada antes de entrar no payload.
//
// Formatos do Banco Central: CPF (11 díg.), CNPJ (14 díg.), e-mail, telefone em
// E.164 (+55DDNNNNNNNNN) e aleatória (UUID).
// ---------------------------------------------------------------------------

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'evp';

/** Dígitos verificadores do CPF — é o que distingue um CPF de um celular com DDD. */
function isValidCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const [len, pos] of [[9, 10], [10, 11]] as const) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (pos - i);
    const rest = sum % 11;
    if (Number(d[len]) !== (rest < 2 ? 0 : 11 - rest)) return false;
  }
  return true;
}

function isValidCnpj(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  for (const len of [12, 13]) {
    let sum = 0;
    let weight = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * weight;
      weight = weight - 1 < 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    if (Number(d[len]) !== (rest < 2 ? 0 : 11 - rest)) return false;
  }
  return true;
}

export type PixKeyResult =
  | { ok: true; key: string; type: PixKeyType }
  | { ok: false; error: string };

/**
 * Interpreta o que foi digitado e devolve a chave no formato exigido pelo BR Code
 * (ou um erro explicando o que está errado). Aceita as máscaras usuais —
 * (11) 98164-0505, 123.456.789-09 — e as remove.
 */
export function normalizePixKey(raw: string): PixKeyResult {
  const input = (raw ?? '').trim();
  if (!input) return { ok: false, error: 'Informe a chave Pix.' };

  // E-mail
  if (input.includes('@')) {
    const email = input.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 77) {
      return { ok: false, error: 'E-mail inválido para chave Pix.' };
    }
    return { ok: true, key: email, type: 'email' };
  }

  // Aleatória (UUID)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    return { ok: true, key: input.toLowerCase(), type: 'evp' };
  }

  const digits = input.replace(/\D/g, '');
  const explicitPhone = input.startsWith('+');

  // Telefone escrito com +: precisa ser brasileiro completo.
  if (explicitPhone) {
    if (!/^55\d{10,11}$/.test(digits)) {
      return {
        ok: false,
        error: 'Telefone deve estar no formato +55 com DDD, ex.: +5511987654321.',
      };
    }
    return { ok: true, key: `+${digits}`, type: 'phone' };
  }

  if (isValidCnpj(digits)) return { ok: true, key: digits, type: 'cnpj' };
  if (isValidCpf(digits)) return { ok: true, key: digits, type: 'cpf' };

  // 10/11 dígitos que NÃO passam no CPF: é telefone com DDD sem o +55. Esse é o
  // erro mais comum — sem o +55 o banco procura um CPF e a doação falha.
  if (/^\d{10,11}$/.test(digits)) {
    return { ok: true, key: `+55${digits}`, type: 'phone' };
  }
  // Já vem com o 55 na frente, só sem o +.
  if (/^55\d{10,11}$/.test(digits)) {
    return { ok: true, key: `+${digits}`, type: 'phone' };
  }

  if (digits.length === 11) {
    return { ok: false, error: 'CPF inválido (dígitos verificadores não conferem).' };
  }
  if (digits.length === 14) {
    return { ok: false, error: 'CNPJ inválido (dígitos verificadores não conferem).' };
  }
  return {
    ok: false,
    error: 'Chave Pix inválida. Use CPF, CNPJ, e-mail, telefone (+55DDNNNNNNNNN) ou chave aleatória.',
  };
}

export interface PixPayloadInput {
  key: string;          // chave Pix do recebedor (e-mail, telefone, CPF/CNPJ ou aleatória)
  merchantName: string; // nome do recebedor (max 25)
  merchantCity: string; // cidade (max 15)
  amount?: number;      // valor em reais; omitido = pagador digita
  txid?: string;        // identificador; '***' = estático padrão
}

export function buildPixPayload({ key, merchantName, merchantCity, amount, txid = '***' }: PixPayloadInput): string {
  const merchantAccount =
    tlv('00', 'br.gov.bcb.pix') + tlv('01', key.trim());

  let payload =
    tlv('00', '01') +                       // payload format indicator
    tlv('01', '11') +                       // static (reutilizável)
    tlv('26', merchantAccount) +            // conta do recebedor (chave Pix)
    tlv('52', '0000') +                     // merchant category
    tlv('53', '986') +                      // moeda BRL
    (amount != null && amount > 0 ? tlv('54', amount.toFixed(2)) : '') +
    tlv('58', 'BR') +
    tlv('59', sanitize(merchantName, 25) || 'PETPERDIDOSOS') +
    tlv('60', sanitize(merchantCity, 15) || 'SAO PAULO') +
    tlv('62', tlv('05', txid.slice(0, 25) || '***'));

  payload += '6304'; // CRC: id + tamanho, calculado sobre tudo incluindo o "6304"
  return payload + crc16(payload);
}
