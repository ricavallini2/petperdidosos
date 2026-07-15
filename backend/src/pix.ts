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
