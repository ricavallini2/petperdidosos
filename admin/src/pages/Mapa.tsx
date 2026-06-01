import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, MapData } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';

const TYPE_COLOR: Record<string, string> = {
  lost: '#ff4757',
  sighted: '#f0a020',
  rescued: '#1f9d55',
};
const TYPE_LABEL: Record<string, string> = {
  lost: 'Perdidos',
  sighted: 'Vistos',
  rescued: 'Resgatados',
};
const SIGHTING_COLOR = '#2f7ed1';

// Tiles claros (OSM) e escuros (CARTO dark) — ambos grátis, sem API key.
const TILES = {
  light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

// Marcador circular colorido como divIcon (sem depender de imagens do Leaflet)
function dot(color: string, ring = false) {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);${
      ring ? 'outline:3px solid ' + color + '55;' : ''
    }"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

type Filter = 'lost' | 'sighted' | 'rescued' | 'sightings';

export function Mapa() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Record<Filter, boolean>>({
    lost: true,
    sighted: true,
    rescued: true,
    sightings: true,
  });

  // Inicializa o mapa uma vez
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = L.map(mapRef.current, { zoomControl: true }).setView([-15.78, -47.93], 4);
    tileRef.current = L.tileLayer(TILES[theme], { maxZoom: 19, attribution: '© OpenStreetMap' });
    tileRef.current.addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapObj.current = map;
    return () => {
      map.remove();
      mapObj.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega os dados
  useEffect(() => {
    api
      .map()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar o mapa'));
  }, []);

  // Troca o tile ao mudar o tema
  useEffect(() => {
    if (!mapObj.current || !tileRef.current) return;
    tileRef.current.setUrl(TILES[theme]);
  }, [theme]);

  // Redesenha os marcadores quando dados ou filtros mudam
  useEffect(() => {
    const map = mapObj.current;
    const group = layerRef.current;
    if (!map || !group || !data) return;
    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    data.pets.forEach((p) => {
      if (!filters[p.type as Filter]) return;
      const color = TYPE_COLOR[p.type] ?? '#888';
      const m = L.marker([p.lat, p.lng], { icon: dot(color) }).addTo(group);
      m.bindPopup(
        `<div style="min-width:150px">
          <strong>${p.name}</strong><br/>
          <span style="color:${color};font-weight:700">${TYPE_LABEL[p.type] ?? p.type}</span>
          ${p.species ? ' · ' + p.species : ''}<br/>
          <a href="#/casos/${p.id}" data-pet="${p.id}" style="color:#ff4757;font-weight:700">Ver caso →</a>
        </div>`
      );
      m.on('popupopen', (e) => {
        const link = (e.popup.getElement() as HTMLElement)?.querySelector('a[data-pet]');
        link?.addEventListener('click', (ev) => {
          ev.preventDefault();
          navigate(`/casos/${p.id}`);
        });
      });
      bounds.push([p.lat, p.lng]);
    });

    if (filters.sightings) {
      data.sightings.forEach((s) => {
        const m = L.marker([s.lat, s.lng], { icon: dot(SIGHTING_COLOR, true) }).addTo(group);
        m.bindPopup(
          `<div><strong>Avistamento</strong><br/>${new Date(s.created_at).toLocaleString('pt-BR')}<br/>${
            s.confirmed === true ? 'Confirmado' : s.confirmed === false ? 'Não confirmado' : 'Pendente'
          }</div>`
        );
        bounds.push([s.lat, s.lng]);
      });
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40], maxZoom: 13 });
    }
  }, [data, filters, navigate]);

  const toggle = (f: Filter) => setFilters((prev) => ({ ...prev, [f]: !prev[f] }));

  const counts = {
    lost: data?.pets.filter((p) => p.type === 'lost').length ?? 0,
    sighted: data?.pets.filter((p) => p.type === 'sighted').length ?? 0,
    rescued: data?.pets.filter((p) => p.type === 'rescued').length ?? 0,
    sightings: data?.sightings.length ?? 0,
  };

  const chips: { key: Filter; label: string; color: string }[] = [
    { key: 'lost', label: `${TYPE_LABEL.lost} (${counts.lost})`, color: TYPE_COLOR.lost },
    { key: 'sighted', label: `${TYPE_LABEL.sighted} (${counts.sighted})`, color: TYPE_COLOR.sighted },
    { key: 'rescued', label: `${TYPE_LABEL.rescued} (${counts.rescued})`, color: TYPE_COLOR.rescued },
    { key: 'sightings', label: `Avistamentos (${counts.sightings})`, color: SIGHTING_COLOR },
  ];

  return (
    <div className="page">
      <h1>Mapa operacional</h1>
      <p className="page-desc">
        Distribuição geográfica dos casos ativos e avistamentos. Clique num marcador para ver
        o caso.
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="map-legend">
        {chips.map((c) => (
          <button
            key={c.key}
            className={'map-chip' + (filters[c.key] ? ' active' : '')}
            onClick={() => toggle(c.key)}
            style={{ ['--chip' as string]: c.color }}
          >
            <span className="map-chip-dot" style={{ background: c.color }} />
            {c.label}
          </button>
        ))}
      </div>

      <div className="map-wrap" ref={mapRef} />
    </div>
  );
}
