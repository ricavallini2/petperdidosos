// Formata uma distância em metros de forma legível e consistente no app.
//
//   < 1000 m       -> "850 m"
//   km inteiro     -> "5 km"
//   caso geral     -> "4.9 km"   (ex.: 4967 m → uma casa decimal)
//
// Acima de 1 km usamos km com 1 casa decimal (truncada, não arredondada, para
// não "inflar" a distância — 4967 m vira 4.9 km, não 5.0 km).
// Retorna null quando o valor é inválido, para o chamador decidir não exibir.
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  const total = Math.max(0, Math.round(meters));
  if (total < 1000) return `${total} m`;
  const kmTenths = Math.floor(total / 100) / 10; // ex.: 4967 -> 49 -> 4.9
  return Number.isInteger(kmTenths) ? `${kmTenths} km` : `${kmTenths.toFixed(1)} km`;
}
