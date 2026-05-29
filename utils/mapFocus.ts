// Canal simples para pedir foco de um pet no Mapa SOS a partir de outras telas
// (lista de Alertas, chat "Ver alerta"). Passar params para o grupo /(tabs) e
// lê-los no index é pouco confiável no expo-router — este store entrega o alvo
// direto, e o mapa o consome quando ganha foco.

export type MapFocusTarget = { petId: string; details: boolean };

let pending: MapFocusTarget | null = null;

/** Solicita que o mapa centralize/abra um pet. Chame antes de navegar p/ o mapa. */
export function requestMapFocus(petId: string, details: boolean) {
  pending = { petId, details };
}

/** Consome (lê e limpa) o alvo pendente. Retorna null se não houver. */
export function consumeMapFocus(): MapFocusTarget | null {
  const t = pending;
  pending = null;
  return t;
}
