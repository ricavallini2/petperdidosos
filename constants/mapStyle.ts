// Estilo "soft light" do mapa — base neutra e dessaturada para os marcadores
// coloridos (perdido/visto/resgatado/buscadores) se destacarem. Água em azul
// suave, parques verdes discretos, ruas brancas com hierarquia leve nas
// rodovias, POIs/transporte sem poluição visual e rótulos com contorno nítido.
export const customMapStyle = [
  // ---- Base ----
  { elementType: 'geometry', stylers: [{ color: '#f3f5f7' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5b6470' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 2 }] },

  // ---- Administrativo (limpa parcelas, mantém só nomes) ----
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#9aa4b0' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#4a5560' }] },

  // ---- Pontos de interesse (declutter) ----
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eaecf0' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d8e8d4' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },

  // ---- Terreno/vegetação neutro (sem verde aleatório) ----
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#f3f5f7' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#edeff3' }] },

  // ---- Vias ----
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#9aa4b0' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#6b7480' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f6e8cf' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#efd9b0' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#80714f' }] },

  // ---- Transporte público (oculto para limpar) ----
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  // ---- Água em azul suave ----
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c6e0f0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7fa8c4' }] },
];
