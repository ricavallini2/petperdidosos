// Formata uma distância em metros de forma legível e consistente no app.
//
//   < 1000 m         -> "850 m"
//   múltiplo de km   -> "3 km"
//   caso geral       -> "1 km e 100 m"   (ex.: 1100 m)
//
// Retorna null quando o valor é inválido, para o chamador decidir não exibir.
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  const total = Math.max(0, Math.round(meters));
  if (total < 1000) return `${total} m`;
  const km = Math.floor(total / 1000);
  const rest = total - km * 1000;
  return rest === 0 ? `${km} km` : `${km} km e ${rest} m`;
}
