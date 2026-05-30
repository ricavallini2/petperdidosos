// Canal simples para pedir foco de um pet no Mapa SOS a partir de outras telas
// (lista de Alertas, chat "Ver alerta"). Passar params para o grupo /(tabs) e
// lê-los no index é pouco confiável no expo-router — este store entrega o alvo
// direto, e o mapa o consome quando ganha foco.

export type MapFocusTarget = { petId: string; details: boolean; radius?: number };

let pending: MapFocusTarget | null = null;

/**
 * Solicita que o mapa centralize/abra um pet. Chame antes de navegar p/ o mapa.
 * `radius` (em metros) garante que o mapa amplie a busca para incluir o pet
 * quando ele estiver além do raio atual do mapa (ex.: vindo da lista de Alertas).
 */
export function requestMapFocus(petId: string, details: boolean, radius?: number) {
  pending = { petId, details, radius };
}

/** Consome (lê e limpa) o alvo pendente. Retorna null se não houver. */
export function consumeMapFocus(): MapFocusTarget | null {
  const t = pending;
  pending = null;
  return t;
}
