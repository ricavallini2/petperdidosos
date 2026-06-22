import * as ImageManipulator from 'expo-image-manipulator';

// Largura máxima das fotos enviadas. O pipeline de upload (readAsStringAsync base64
// + decode em ArrayBuffer) mantinha a foto full-res (12MP) inteira na heap, em
// dobro e de forma síncrona — pico de dezenas de MB que o iOS mata por memória
// (OOM) no "Publicando...". 1280px preserva qualidade visual e de match (CLIP) e
// derruba o arquivo para ~150–300KB. Melhoria cross-platform (Android também ganha
// upload mais rápido); não altera o fluxo (pick → preview → upload), só o tamanho.
const MAX_UPLOAD_WIDTH = 1280;

/**
 * Redimensiona/comprime uma foto LOCAL antes do upload. URLs remotas (http/https)
 * passam direto (foto reaproveitada da busca por IA). Chamar logo após o pick para
 * o preview e o upload já usarem a versão leve. O resize roda no lado nativo (não
 * infla a heap JS). Se o manipulador falhar, devolve a uri original (best-effort —
 * nunca bloqueia o cadastro).
 */
export async function prepareForUpload(uri: string): Promise<string> {
  if (/^https?:\/\//.test(uri)) return uri;
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_UPLOAD_WIDTH } }],
      // 0.82: a foto já vem comprimida do picker (quality 0.7); um 2º passe alto
      // evita perda dupla de qualidade (importa para o match por IA).
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
    );
    return out.uri;
  } catch {
    return uri;
  }
}
