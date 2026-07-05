import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Image, Dimensions, TouchableOpacity, Animated, Modal, ScrollView, Linking, Platform, TextInput, KeyboardAvoidingView, PanResponder } from 'react-native';
import MapView, { Marker, Circle, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchNearbyPets, getPetDetails, getUserProfile, getUserSettings, reportPet, claimSighting, getPetSightings, getPublicProfile, getNotifications, PET_REPORT_REASONS, PetSighting } from '../../services/api';
import { COMPLETE_PROFILE_KEY } from '../login';
import { useSearcherPresence } from '../../hooks/use-searcher-presence';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { customMapStyle } from '../../constants/mapStyle';
import { Avatar } from '../../components/Avatar';
import { toast, showConfirm, showActionSheet } from '../../components/Feedback';
import { formatDistance } from '../../utils/formatDistance';
import { colorMatches } from '../../utils/colorMatch';
import { consumeMapFocus } from '../../utils/mapFocus';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LinearGradient } from 'expo-linear-gradient';

const sizeLabel = (s?: string) => s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : null;
const speciesLabel = (s?: string | null) => s === 'cachorro' ? 'Cachorro' : s === 'gato' ? 'Gato' : s === 'passaro' ? 'Pássaro' : s === 'outro' ? 'Outro' : null;
// Para chips compactos: só rotula valores conhecidos (desconhecido fica oculto).
const sexLabel = (s?: string) => s === 'macho' ? 'Macho' : s === 'femea' ? 'Fêmea' : null;
const ageLabel = (a?: string) => a === 'filhote' ? 'Filhote' : a === 'adulto' ? 'Adulto' : a === 'idoso' ? 'Idoso' : null;
// Máscara de moeda brasileira: 1234.5 -> "R$ 1.234,50"
const formatBRL = (v: number) => {
  const [int, dec] = Number(v || 0).toFixed(2).split('.');
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
};

const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

// Decodifica a polyline codificada retornada pela Directions API do Google
function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  let index = 0, lat = 0, lng = 0;
  const coords: { latitude: number; longitude: number }[] = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

const openRoute = (lat: number, lng: number) => {
  const url = Platform.select({
    ios: `maps:0,0?q=${lat},${lng}`,
    android: `geo:0,0?q=${lat},${lng}`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  });
  Linking.openURL(url!).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`)
  );
};

// Dois tamanhos do marcador de pet: pequeno (padrão) e grande (selecionado).
// Como o marcador é um PNG capturado, não dá pra escalar em tempo real —
// capturamos os dois e trocamos a imagem do <Marker> conforme a seleção.
const MARKER_SIZES = {
  small: { wrap: 54, ring: 46, clip: 40, img: 46, dot: 16, dotIcon: 8 },
  large: { wrap: 84, ring: 74, clip: 68, img: 74, dot: 24, dotIcon: 12 },
} as const;

// Cor do anel do marcador por tipo de pet:
// perdido = vermelho, visto = amarelo, resgatado = verde, doação = azul.
const PET_RING_COLOR: Record<string, string> = {
  lost: '#FF4757',
  sighted: '#FFC312',
  rescued: '#2ED573',
  donation: '#3B82F6',
};
const ringColorForPet = (pet?: { type?: string }) => PET_RING_COLOR[pet?.type ?? 'lost'] ?? '#FF4757';

// Rótulo e fundo claro do badge por tipo (Perdido / Visto / Resgatado / Doando).
const PET_TYPE_LABEL: Record<string, string> = { lost: 'Perdido', sighted: 'Visto', rescued: 'Resgatado', donation: 'Doando' };
const PET_TYPE_BG: Record<string, string> = { lost: '#FFE5E9', sighted: '#FFF6E5', rescued: '#E8F8F5', donation: '#EFF6FF' };
const petTypeLabel = (pet?: { type?: string }) => PET_TYPE_LABEL[pet?.type ?? 'lost'] ?? 'Perdido';
const petTypeBg = (pet?: { type?: string }) => PET_TYPE_BG[pet?.type ?? 'lost'] ?? '#FFE5E9';

// "Foi visto a primeira/segunda/... vez" conforme a ordem cronológica.
const ORDINAIS = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];
const sightingTitleByIndex = (n: number) => ORDINAIS[n - 1] ? `Foi visto a ${ORDINAIS[n - 1]} vez` : `Foi visto pela ${n}ª vez`;

// Estados brasileiros → UF (a geocodificação às vezes devolve o nome por extenso).
const UF_MAP: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA',
  'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', 'Goiás': 'GO',
  'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
  'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI',
  'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS',
  'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP',
  'Sergipe': 'SE', 'Tocantins': 'TO',
};
const toUF = (region?: string | null): string | null => {
  if (!region) return null;
  if (region.length === 2) return region.toUpperCase();
  return UF_MAP[region.trim()] ?? region;
};

// Endereço aproximado no padrão "Rua, Bairro, Cidade - UF" (sem número).
function formatAddress(a: any): string | null {
  if (!a) return null;
  const rua = a.street ?? a.name;
  const bairro = a.district ?? a.subregion;
  const cidade = a.city ?? (a.subregion !== bairro ? a.subregion : null);
  const uf = toUF(a.region);
  const left = [rua, bairro, cidade].filter(Boolean);
  const dedup = left.filter((p, i) => p && p !== left[i - 1]); // remove duplicatas consecutivas
  let s = dedup.join(', ');
  if (uf) s = s ? `${s} - ${uf}` : uf;
  return s || null;
}

// Máscara de tempo decorrido: "1 ano, 3 meses, 4 dias, 5 horas e 30 minutos".
function formatElapsedMask(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'agora mesmo';
  const totalMin = Math.floor(ms / 60000);
  const minutes = totalMin % 60;
  const totalHours = Math.floor(totalMin / 60);
  const hours = totalHours % 24;
  const totalDays = Math.floor(totalHours / 24);
  const years = Math.floor(totalDays / 365);
  const afterYears = totalDays % 365;
  const months = Math.floor(afterYears / 30);
  const days = afterYears % 30;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years > 1 ? 'anos' : 'ano'}`);
  if (months > 0) parts.push(`${months} ${months > 1 ? 'meses' : 'mês'}`);
  if (days > 0) parts.push(`${days} ${days > 1 ? 'dias' : 'dia'}`);
  if (hours > 0) parts.push(`${hours} ${hours > 1 ? 'horas' : 'hora'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes > 1 ? 'minutos' : 'minuto'}`);
  if (parts.length === 0) return 'agora mesmo';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
}

// Chave de cache do ícone de buscador: cor do pin + se é premium
const searcherIconKey = (color: string, premium: boolean) => `${color}|${premium ? 'p' : 'r'}`;

// Markers de pet/cluster com tracksViewChanges que ASSENTA em false após a imagem
// carregar. Markers de imagem (image={{uri}}) com tracking permanente re-rasterizam
// a cada frame no iOS — principal causa de lentidão do mapa. Mantemos o tracking
// ligado ~700ms (e reativamos só quando o ícone/seleção muda — re-render por callback
// NÃO reseta, pois a effect depende de [icon,isActive]) para a imagem assentar, e
// depois desligamos. Visual idêntico no Android (que rasteriza uma vez de qualquer forma).
const PetSingleMarker = React.memo(function PetSingleMarker({
  latitude, longitude, isActive, icon, onPress,
}: { latitude: number; longitude: number; isActive: boolean; icon?: string; onPress: () => void }) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 700);
    return () => clearTimeout(t);
  }, [icon, isActive]);
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      image={icon ? { uri: icon } : undefined}
      pinColor={icon ? undefined : '#FF4757'}
      zIndex={isActive ? 999 : 1}
      tracksViewChanges={tracks}
      onPress={(e) => { e.stopPropagation(); onPress(); }}
    />
  );
});

const ClusterMarker = React.memo(function ClusterMarker({
  latitude, longitude, icon, onPress,
}: { latitude: number; longitude: number; icon?: string; onPress: () => void }) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 700);
    return () => clearTimeout(t);
  }, [icon]);
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      image={icon ? { uri: icon } : undefined}
      tracksViewChanges={tracks}
      onPress={(e) => { e.stopPropagation(); onPress(); }}
    />
  );
});

export default function MapScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedPet, setSelectedPet] = useState<PetSighting | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  // Galeria do card do mapa (foto principal + extras) com carrossel deslizável.
  const [cardGallery, setCardGallery] = useState<string[]>([]);
  const [cardGalleryIndex, setCardGalleryIndex] = useState(0);
  const [pets, setPets] = useState<PetSighting[]>([]);
  // Filtro por tipo (legenda interativa no mapa).
  const [typeFilter, setTypeFilter] = useState<{ lost: boolean; sighted: boolean; rescued: boolean; donation: boolean }>({ lost: true, sighted: true, rescued: true, donation: true });
  // Filtro por espécie (null = todas) e por cor (texto livre, busca por trecho).
  const [speciesFilter, setSpeciesFilter] = useState<'cachorro' | 'gato' | 'passaro' | 'outro' | null>(null);
  const [colorFilter, setColorFilter] = useState('');
  const [isLoadingPets, setIsLoadingPets] = useState(false);
  const [radius, setRadius] = useState(5000);
  const [showFilter, setShowFilter] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsPet, setDetailsPet] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const slideAnim = useState(new Animated.Value(300))[0];
  const mapRef = useRef<MapView | null>(null);
  // Alvo de foco pendente (vindo de "Ver no mapa"/"Ver alerta"): se o mapa ainda
  // não montou (location null), o onMapReady consome este alvo ao carregar.
  const pendingFocusRef = useRef<{ latitude: number; longitude: number } | null>(null);
  // Box de 1 clique do pet capturado como PNG → Marker nativo acima da foto.
  // Indexado pelo ID do pet (não pela contagem), guardando a "assinatura" (nº de
  // avistamentos) usada. O box aparece assim que a 1ª captura termina e é
  // SOBRESCRITO quando a trilha carrega — não depende de trailLoading nem some.
  const [labelIcons, setLabelIcons] = useState<Record<string, { uri: string; sig: string }>>({});
  const onLabelCaptured = useCallback((petId: string, sig: string, uri: string) => {
    setLabelIcons((prev) => (prev[petId]?.sig === sig ? prev : { ...prev, [petId]: { uri, sig } }));
  }, []);

  const [sightingPoint, setSightingPoint] = useState<{ x: number; y: number } | null>(null);
  const mapLayout = useRef({ width: Dimensions.get('window').width, height: Dimensions.get('window').height });

  const [sightingAddress, setSightingAddress] = useState<string | null>(null);

  // Posição inicial precisa ao tocar na bolinha.
  const computeSightingPoint = useCallback((lat: number, lng: number) => {
    mapRef.current?.pointForCoordinate({ latitude: lat, longitude: lng })
      .then((pt) => { if (pt) setSightingPoint(pt); })
      .catch(() => {});
  }, []);

  // Projeção SÍNCRONA coordenada → tela (centro + span da região). Mantém a caixa
  // colada à bolinha em tempo real durante o arraste (2D, norte para cima).
  // Se a bolinha sair da área visível do mapa, fecha o box automaticamente.
  const projectSighting = useCallback((lat: number, lng: number, region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => {
    const { width, height } = mapLayout.current;
    const x = ((lng - region.longitude) / region.longitudeDelta + 0.5) * width;
    const y = ((region.latitude - lat) / region.latitudeDelta + 0.5) * height;
    if (x < 0 || x > width || y < 0 || y > height) {
      // Avistamento arrastado para fora do mapa → fecha o box.
      setSelectedSighting(null);
      setSightingPoint(null);
      return;
    }
    setSightingPoint({ x, y });
  }, []);

  // Altura animada da foto do card — controlada pela barrinha de arrasto
  const HERO_DEFAULT = 168;
  const HERO_MIN = 100;
  const HERO_MAX = 290;
  const CARD_W = Dimensions.get('window').width - 32; // largura do card (bottomSheet left:16 + right:16) p/ paging do carrossel
  const heroHeight = useRef(new Animated.Value(HERO_DEFAULT)).current;
  const heroHeightCurrent = useRef(HERO_DEFAULT);

  const heroPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 4,
      onPanResponderGrant: () => { heroHeight.stopAnimation(); },
      onPanResponderMove: (_, gs) => {
        const next = Math.min(HERO_MAX, Math.max(HERO_MIN, heroHeightCurrent.current - gs.dy));
        heroHeight.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        const next = Math.min(HERO_MAX, Math.max(HERO_MIN, heroHeightCurrent.current - gs.dy));
        let target = HERO_DEFAULT;
        if (gs.vy < -0.3 || next > (HERO_DEFAULT + HERO_MAX) / 2) target = HERO_MAX;
        else if (gs.vy > 0.3 || next < (HERO_MIN + HERO_DEFAULT) / 2) target = HERO_MIN;
        heroHeightCurrent.current = target;
        Animated.spring(heroHeight, {
          toValue: target,
          useNativeDriver: false,
          tension: 65,
          friction: 9,
        }).start();
      },
    })
  ).current;
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const bellAnim = useRef(new Animated.Value(0)).current;
  const [showOnMap, setShowOnMap] = useState(true);
  const [showProfilePhoto, setShowProfilePhoto] = useState(true);
  const [pinColor, setPinColor] = useState('#3498DB');
  const [customRadius, setCustomRadius] = useState('');
  const [followMode, setFollowMode] = useState(false);
  const [is3D, setIs3D] = useState(false); // visão 3D leve (câmera inclinada + prédios)
  const is3DRef = useRef(false);            // espelho p/ o loop do modo seguir ler sem reiniciar
  useEffect(() => { is3DRef.current = is3D; }, [is3D]);
  const followPitch = () => (is3DRef.current ? 55 : 0);
  // Tipo do mapa: normal, satélite ou terreno
  type MapTypeOption = 'standard' | 'satellite' | 'terrain';
  const MAP_TYPE_CYCLE: MapTypeOption[] = ['standard', 'satellite', 'terrain'];
  const MAP_TYPE_META: Record<MapTypeOption, { icon: string; label: string }> = {
    standard:  { icon: 'map-outline',         label: 'Normal'   },
    satellite: { icon: 'earth',               label: 'Satélite' },
    terrain:   { icon: 'trail-sign-outline',  label: 'Terreno'  },
  };
  const [mapType, setMapType] = useState<MapTypeOption>('standard');
  const cycleMapType = () =>
    setMapType((cur) => MAP_TYPE_CYCLE[(MAP_TYPE_CYCLE.indexOf(cur) + 1) % MAP_TYPE_CYCLE.length]);
  // Raio de busca marcado ao redor do pet selecionado (metros). null = nenhum.
  const PET_RADIUS_OPTIONS = [50, 100, 200, 300, 500, 1000, 2000];
  const [petRadius, setPetRadius] = useState<number | null>(null);
  // Pet ao qual o raio está ancorado — separado de selectedPet para o círculo
  // continuar no mapa mesmo com o card fechado.
  const [radiusPet, setRadiusPet] = useState<PetSighting | null>(null);
  // Região atual do mapa (atualizada via onRegionChangeComplete) — usada para clusterização
  const [currentRegion, setCurrentRegion] = useState<any>(null);
  // Rota em mapa: polyline + info de distância/tempo
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  // Trilha de avistamentos confirmados do pet selecionado (cronológica)
  const [trail, setTrail] = useState<{ id: string; latitude: number; longitude: number; created_at?: string; photo_url?: string | null; source_pet_id?: string | null; finder_id?: string | null }[]>([]);
  const [sightingIcons, setSightingIcons] = useState<Record<string, string>>({});
  const onSightingIconCaptured = useCallback(
    (id: string, uri: string) => setSightingIcons((prev) => (prev[id] ? prev : { ...prev, [id]: uri })),
    [],
  );
  // Avistamento selecionado (toque na bolinha) + área de busca ao redor dele
  const [selectedSighting, setSelectedSighting] = useState<{ id: string; latitude: number; longitude: number; index: number; created_at?: string; photo_url?: string | null; source_pet_id?: string | null; finder_id?: string | null } | null>(null);
  // Dados completos do avistamento (carregados ao abrir os detalhes)
  const [sightingGallery, setSightingGallery] = useState<string[]>([]);
  const [sightingDesc, setSightingDesc] = useState<string | null>(null);
  const [sightingFinder, setSightingFinder] = useState<string | null>(null);
  const [sightingGalleryIndex, setSightingGalleryIndex] = useState(0);
  const [sightingDetails, setSightingDetails] = useState(false); // false = caixa de 1 clique; true = detalhes


  // Endereço aproximado do avistamento (geocodificação reversa).
  const loadSightingAddress = useCallback(async (lat: number, lng: number) => {
    setSightingAddress(null);
    try {
      const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      setSightingAddress(formatAddress(res?.[0]));
    } catch { /* silencioso */ }
  }, []);
  const [sightingArea, setSightingArea] = useState<{ latitude: number; longitude: number; radius: number } | null>(null);

  // Endereço aproximado do pet (geocodificação reversa) — usado no box de DETALHES.
  const [petAddress, setPetAddress] = useState<string | null>(null);

  const loadPetAddress = useCallback(async (lat: number, lng: number) => {
    setPetAddress(null);
    try {
      const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      setPetAddress(formatAddress(res?.[0]));
    } catch { /* silencioso */ }
  }, []);

  // Distância em metros entre dois pontos (Haversine).
  const distMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);
  const [isFetchingRoute, setIsFetchingRoute] = useState(false);
  // Cache de ícones de cluster (count → URI do PNG capturado)
  const [clusterIcons, setClusterIcons] = useState<Record<number, string>>({});
  const onClusterIconCaptured = useCallback((count: number, uri: string) => {
    setClusterIcons((prev) => (prev[count] ? prev : { ...prev, [count]: uri }));
  }, []);
  // Cache de ícones de marker — 2 tamanhos por pet (petId → { small, large })
  const [markerIcons, setMarkerIcons] = useState<Record<string, { small?: string; large?: string }>>({});
  const onMarkerCaptured = useCallback((petId: string, variant: 'small' | 'large', uri: string) => {
    setMarkerIcons((prev) => {
      const cur = prev[petId];
      if (cur?.[variant]) return prev;
      return { ...prev, [petId]: { ...cur, [variant]: uri } };
    });
  }, []);
  // Ícones do buscador capturados como PNG, indexados por cor+premium — contorna
  // o bug de view custom dentro de <Marker> (recorte "pizza") no New Architecture
  const [searcherIcons, setSearcherIcons] = useState<Record<string, string>>({});
  const onSearcherIconCaptured = useCallback((key: string, uri: string) => {
    setSearcherIcons((prev) => (prev[key] ? prev : { ...prev, [key]: uri }));
  }, []);
  // Ícone do próprio usuário capturado como PNG, indexado pela cor do pin —
  // mesma técnica dos pets/buscadores para evitar o recorte "pizza"
  const [meIcons, setMeIcons] = useState<Record<string, string>>({});
  const onMeIconCaptured = useCallback((color: string, uri: string) => {
    setMeIcons((prev) => (prev[color] ? prev : { ...prev, [color]: uri }));
  }, []);
  const isMyPet = (pet?: PetSighting | { user_id?: string; user?: { id?: string } }) => {
    if (!user || !pet) return false;
    const ownerId = (pet as any).user_id ?? (pet as any).user?.id;
    return ownerId === user.id;
  };

  // Denúncia de alerta inapropriado
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // Alerta pode ser denunciado se não estiver pausado/encontrado/cancelado.
  const isReportable = (pet?: { status?: string } | null) =>
    !!pet && pet.status !== 'pausado' && pet.status !== 'encontrado' && pet.status !== 'cancelado';

  const submitReport = async (reason: string) => {
    if (!reportTarget || !user || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      const result = await reportPet(reportTarget.id, user.id, reason);
      setReportTarget(null);
      if (result.paused) {
        toast.warning(
          'Este alerta recebeu várias denúncias e foi enviado para análise da nossa equipe. Obrigado por ajudar a manter o app seguro.',
          'Alerta pausado',
        );
        setShowDetails(false);
        setSelectedPet(null);
        loadPets();
      } else {
        toast.success('Obrigado. Nossa equipe vai avaliar este alerta.', 'Denúncia enviada');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente mais tarde.', 'Não foi possível denunciar');
    } finally {
      setReportSubmitting(false);
    }
  };

  // Carrega perfil + settings pra avatar do header e presence
  useFocusEffect(useCallback(() => {
    if (!user) return;
    getUserProfile(user.id).then(setProfile).catch(() => {});
    getUserSettings(user.id).then((s) => {
      if (s && typeof s.show_on_map === 'boolean') setShowOnMap(s.show_on_map);
      if (s) setShowProfilePhoto(s.show_profile_photo !== false);
      if (s?.pin_color) setPinColor(s.pin_color);
    }).catch(() => {});
  }, [user]));

  // Notificações não lidas: atualiza no foco e a cada 30s (pra pegar novas
  // enquanto o mapa está aberto). Alimenta o contador + animação do sino.
  const refreshUnread = useCallback(() => {
    if (!user) return;
    getNotifications(user.id)
      .then((list: any[]) => setUnreadCount((list ?? []).filter((n) => !n.read).length))
      .catch(() => {});
  }, [user]);

  useFocusEffect(useCallback(() => {
    refreshUnread();
    const id = setInterval(refreshUnread, 30000);
    return () => clearInterval(id);
  }, [refreshUnread]));

  // Anima o sino (balança) em loop enquanto houver notificações não lidas.
  useEffect(() => {
    if (unreadCount > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bellAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.timing(bellAnim, { toValue: -1, duration: 240, useNativeDriver: true }),
          Animated.timing(bellAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
          Animated.delay(1600), // pausa entre os "toques" para não cansar
        ]),
      );
      loop.start();
      return () => { loop.stop(); bellAnim.setValue(0); };
    }
    bellAnim.setValue(0);
  }, [unreadCount, bellAnim]);

  // Presence: sempre vê os outros se logado; só publica a si mesmo se show_on_map=true
  const selfPresence = (user && location && profile) ? {
    user_id: user.id,
    name: profile.full_name ?? profile.name ?? 'Buscador',
    photo_url: showProfilePhoto ? (profile.photo_url ?? undefined) : undefined,
    rescues_count: Number(profile.rescues_count ?? 0),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    is_premium: profile.is_premium === true,
    pin_color: pinColor,
  } : null;

  const searchers = useSearcherPresence(selfPresence, showOnMap);

  // Combos únicos (cor do pin + premium) de ícone de buscador a capturar
  const searcherIconNeeds = (() => {
    const seen = new Set<string>();
    const items: { key: string; color: string; premium: boolean }[] = [];
    for (const s of searchers) {
      if (s.user_id === user?.id) continue;
      const color = s.pin_color || '#3498DB';
      const premium = !!s.is_premium;
      const key = searcherIconKey(color, premium);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, color, premium });
    }
    return items;
  })();

  // Pet visto/resgatado: o tutor reivindica ("é o meu pet") escolhendo seu
  // alerta de pet perdido. A conversa abre no chat do CASO (pet perdido).
  const handleSightingContact = async (pet: { id: string }) => {
    if (!user) return;
    try {
      const prof = await getUserProfile(user.id);
      const lostPets = (prof?.pets ?? []).filter((p: any) => p.type === 'lost' && p.status === 'ativo');
      if (lostPets.length === 0) {
        toast.info(
          'Para dizer que este pet é o seu, você precisa ter um alerta de pet perdido ativo.',
          'Nenhum pet perdido ativo',
        );
        return;
      }
      const claim = async (lostPetId: string) => {
        try {
          const r = await claimSighting(pet.id, lostPetId);
          router.push(`/chat/${r.petId}?tutorId=${r.tutorId}&finderId=${r.finderId}`);
        } catch (e: any) {
          toast.error(e?.message ?? 'Não foi possível abrir o chat.', 'Erro');
        }
      };
      if (lostPets.length === 1) {
        await claim(lostPets[0].id);
      } else {
        showActionSheet({
          title: 'Qual é o seu pet?',
          message: 'Escolha o seu alerta de pet perdido',
          icon: 'paw',
          options: lostPets.slice(0, 4).map((p: any, i: number) => ({
            label: p.name || 'Pet perdido',
            icon: 'megaphone-outline',
            primary: i === 0,
            onPress: () => claim(p.id),
          })),
        });
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro');
    }
  };

  const openDetails = async (pet: PetSighting) => {
    setShowDetails(true);
    setDetailsLoading(true);
    setGalleryIndex(0);
    try {
      const full = await getPetDetails(pet.id);
      setDetailsPet(full);
    } catch (e) {
      console.warn(e);
      setDetailsPet({ ...pet, main_photo_url: pet.photo_url, pet_photos: [] });
    } finally {
      setDetailsLoading(false);
    }
  };

  // Busca rota no app via Directions API e desenha a polyline no mapa
  const fetchInAppRoute = useCallback(async (lat: number, lng: number) => {
    if (!location) return;
    setIsFetchingRoute(true);
    setRouteCoords([]);
    setRouteInfo(null);
    try {
      const origin = `${location.coords.latitude},${location.coords.longitude}`;
      const dest = `${lat},${lng}`;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${dest}&mode=walking&key=${GMAPS_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const leg = route.legs[0];
        setRouteCoords(decodePolyline(route.overview_polyline.points));
        setRouteInfo({ distance: leg.distance.text, duration: leg.duration.text });
        mapRef.current?.fitToCoordinates(
          [
            { latitude: location.coords.latitude, longitude: location.coords.longitude },
            { latitude: lat, longitude: lng },
          ],
          { edgePadding: { top: 130, right: 40, bottom: 320, left: 40 }, animated: true }
        );
      } else {
        // Sem rota encontrada — abre app externo como fallback
        openRoute(lat, lng);
      }
    } catch {
      openRoute(lat, lng);
    } finally {
      setIsFetchingRoute(false);
    }
  }, [location]);

  // Clusterização manual: agrupa pets próximos quando o mapa está afastado.
  // Usa uma grade cujo tamanho é proporcional ao zoom (latitudeDelta).
  const clusteredPets = useMemo(() => {
    // Aplica os filtros: tipo (legenda), espécie e cor (texto livre, com
    // tolerância a gênero/plural e sinônimos via colorMatches).
    // Doação NÃO aparece no mapa SOS — tem área própria (aba Doação).
    const visiblePets = pets.filter((p) => {
      const t = (p.type ?? 'lost') as 'lost' | 'sighted' | 'rescued' | 'donation';
      if (t === 'donation') return false;
      if (typeFilter[t] === false) return false;
      if (speciesFilter && (p.species ?? null) !== speciesFilter) return false;
      if (!colorMatches(p.color, colorFilter)) return false;
      return true;
    });
    const delta = currentRegion?.latitudeDelta ?? 0;
    if (delta < 0.025) {
      // Zoom suficiente para mostrar todos individualmente
      return { clusters: [] as { id: string; count: number; latitude: number; longitude: number }[], singles: visiblePets };
    }
    const cellSize = delta * 0.12;
    const grid: Record<string, PetSighting[]> = {};
    for (const pet of visiblePets) {
      const lat = Number(pet.latitude);
      const lng = Number(pet.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = `${Math.floor(lat / cellSize)},${Math.floor(lng / cellSize)}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(pet);
    }
    const clusters: { id: string; count: number; latitude: number; longitude: number }[] = [];
    const singles: PetSighting[] = [];
    for (const [key, group] of Object.entries(grid)) {
      if (group.length > 1) {
        const clat = group.reduce((s, p) => s + Number(p.latitude), 0) / group.length;
        const clng = group.reduce((s, p) => s + Number(p.longitude), 0) / group.length;
        clusters.push({ id: key, count: group.length, latitude: clat, longitude: clng });
      } else {
        singles.push(group[0]);
      }
    }
    return { clusters, singles };
  }, [pets, currentRegion, typeFilter, speciesFilter, colorFilter]);

  // Contagem de pets por tipo (respeita os filtros de espécie/cor) para os
  // badges da legenda. Não considera o toggle de tipo — mostra quantos existem.
  const typeCounts = useMemo(() => {
    const c: Record<'lost' | 'sighted' | 'rescued' | 'donation', number> = { lost: 0, sighted: 0, rescued: 0, donation: 0 };
    for (const p of pets) {
      const t = (p.type ?? 'lost') as 'lost' | 'sighted' | 'rescued' | 'donation';
      if (t === 'donation') continue; // doação não entra no mapa
      if (speciesFilter && (p.species ?? null) !== speciesFilter) continue;
      if (!colorMatches(p.color, colorFilter)) continue;
      if (t in c) c[t]++;
    }
    return c;
  }, [pets, speciesFilter, colorFilter]);


  // Toque no pet: abre o card JÁ no 1º toque (marcador também destaca via selectedPet).
  const handlePetPress = (pet: PetSighting) => {
    if (selectedPet?.id === pet.id) {
      setCardOpen(true);
    } else {
      setSelectedPet(pet);
      setCardOpen(true);
      setTrail([]); // Limpa a trilha do pet anterior imediatamente para evitar fantasmas visuais
      // Nova seleção limpa a rota anterior
      setRouteCoords([]);
      setRouteInfo(null);
    }
  };

  const loadPets = useCallback(async () => {
    if (!location) return;
    setIsLoadingPets(true);
    try {
      const data = await fetchNearbyPets(location.coords.latitude, location.coords.longitude, radius);
      setPets(data);
    } catch (e) {
      console.warn('fetchNearbyPets falhou', e);
    } finally {
      setIsLoadingPets(false);
    }
  }, [location, radius]);

  useEffect(() => { loadPets(); }, [loadPets]);
  useFocusEffect(useCallback(() => { loadPets(); }, [loadPets]));

  // Trilha de avistamentos confirmados do pet selecionado (cronológica).
  useEffect(() => {
    setSelectedSighting(null);
    setSightingDetails(false);
    setSightingArea(null);
    setSightingAddress(null);
    if (!selectedPet) { setTrail([]); setPetAddress(null); return; }
    // Carrega o endereço aproximado (mostrado no box de detalhes).
    loadPetAddress(Number(selectedPet.latitude), Number(selectedPet.longitude));
    let cancelled = false;
    getPetSightings(selectedPet.id)
      .then((pts) => {
        if (cancelled) return;
        setTrail(pts.map((p) => ({ id: p.id, latitude: Number(p.latitude), longitude: Number(p.longitude), created_at: p.created_at, photo_url: p.photo_url, source_pet_id: p.source_pet_id, finder_id: p.finder_id })));
      })
      .catch(() => { if (!cancelled) setTrail([]); });
    return () => { cancelled = true; };
  }, [selectedPet?.id]);

  // Ao abrir os DETALHES do avistamento: carrega galeria + descrição (do alerta
  // de origem) e o nome de quem viu.
  useEffect(() => {
    if (!sightingDetails || !selectedSighting) return;
    let cancelled = false;
    setSightingGallery(selectedSighting.photo_url ? [selectedSighting.photo_url] : []);
    setSightingDesc(null);
    setSightingFinder(null);
    setSightingGalleryIndex(0);
    if (selectedSighting.source_pet_id) {
      getPetDetails(selectedSighting.source_pet_id)
        .then((d: any) => {
          if (cancelled || !d) return;
          const extras = (d.pet_photos ?? []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((p: any) => p.photo_url);
          const gallery = [d.main_photo_url, ...extras].filter(Boolean);
          setSightingGallery(gallery.length ? gallery : (selectedSighting.photo_url ? [selectedSighting.photo_url] : []));
          setSightingDesc(d.description || d.extra_info || null);
        })
        .catch(() => {});
    }
    if (selectedSighting.finder_id) {
      getPublicProfile(selectedSighting.finder_id)
        .then((p: any) => { if (!cancelled) setSightingFinder(p?.full_name ?? null); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [sightingDetails, selectedSighting?.id]);

  // Foco vindo da aba "Alertas" / do chat ("Ver alerta"): centraliza no pet e
  // abre card/detalhes. O alvo chega pelo store mapFocus (não por params, que
  // não propagam de forma confiável para o índice do grupo /(tabs)).
  const focusOnPet = useCallback(async (petId: string, wantDetails: boolean) => {
    let pet: any = pets.find((p) => p.id === petId);
    if (!pet) {
      try {
        const full = await getPetDetails(petId);
        pet = full ? { ...full, photo_url: full.main_photo_url } : null;
      } catch {
        pet = null;
      }
    }
    if (!pet) return;
    const lat = Number(pet.latitude);
    const lng = Number(pet.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // Guarda o alvo: se o mapa já está pronto anima agora; se ainda não montou
      // (location carregando), o onMapReady consome este alvo ao carregar.
      pendingFocusRef.current = { latitude: lat, longitude: lng };
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        600,
      );
    }
    setSelectedPet(pet);
    if (wantDetails) {
      // "Ver detalhes": abre o box com as informações.
      setCardOpen(true);
      openDetails(pet);
    } else {
      // "Ver no mapa": apenas aponta/centraliza no pet (sem abrir o box).
      setCardOpen(false);
    }
  }, [pets]);

  // Consome um pedido de foco sempre que o mapa ganha foco (troca de aba ou
  // volta do chat). Pequeno atraso garante que o MapView já montou.
  useFocusEffect(useCallback(() => {
    const t = consumeMapFocus();
    if (t) {
      // Se veio da lista de Alertas com um raio maior que o do mapa, amplia a
      // busca para que o pet (além do raio atual) apareça como marcador.
      if (t.radius && t.radius > radius) setRadius(t.radius);
      const id = setTimeout(() => focusOnPet(t.petId, t.details), 300);
      return () => clearTimeout(id);
    }
  }, [focusOnPet, radius]));

  // Acompanha o GPS continuamente: o pin do usuário segue a posição real mesmo
  // FORA do modo seguir. Aqui só atualizamos a `location` (move o pin) — NUNCA
  // movemos a câmera; o recentrar do mapa fica exclusivo do modo seguir.
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permissão para acessar localização foi negada.');
        return;
      }
      // Posição inicial rápida para o 1º render.
      try {
        const loc = await Location.getCurrentPositionAsync({});
        if (!cancelled) setLocation(loc);
      } catch {}
      // Monitor contínuo (move o pin conforme o usuário anda).
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 2000 },
        (loc) => { if (!cancelled) setLocation(loc); }
      );
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, []);

  // Após o cadastro + 1º acesso, lembra o usuário de completar o perfil.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const pending = await AsyncStorage.getItem(COMPLETE_PROFILE_KEY);
      if (pending !== 'pending' || cancelled) return;
      await AsyncStorage.removeItem(COMPLETE_PROFILE_KEY);
      setTimeout(() => {
        if (cancelled) return;
        showConfirm({
          title: 'Complete seu perfil',
          message: 'Adicione seu nome, telefone e uma foto. Um perfil completo passa mais confiança para outros tutores e voluntários — e agiliza o resgate.',
          icon: 'person-circle',
          confirmText: 'Completar perfil',
          cancelText: 'Agora não',
          onConfirm: () => router.push('/profile/edit'),
        });
      }, 700);
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (cardOpen) {
      // Abre com a foto já expandida ao máximo (carrossel)
      heroHeightCurrent.current = HERO_MAX;
      heroHeight.setValue(HERO_MAX);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [cardOpen]);

  // Carrega a galeria do card (foto principal + fotos extras) ao abrir/trocar de pet
  // e mantém a foto expandida ao máximo. Mostra a principal já, completa com extras.
  useEffect(() => {
    if (!cardOpen || !selectedPet) return;
    heroHeightCurrent.current = HERO_MAX;
    heroHeight.setValue(HERO_MAX);
    setCardGalleryIndex(0);
    setCardGallery(selectedPet.photo_url ? [selectedPet.photo_url] : []);
    let cancelled = false;
    getPetDetails(selectedPet.id)
      .then((d: any) => {
        if (cancelled || !d) return;
        const extras = (d.pet_photos ?? [])
          .slice()
          .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
          .map((p: any) => p.photo_url);
        const g = [d.main_photo_url ?? selectedPet.photo_url, ...extras].filter(Boolean);
        if (g.length) setCardGallery(g);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cardOpen, selectedPet?.id]);

  // ---- Raio de busca ao redor do pet ----------------------------------
  // Cancela o raio só ao trocar para OUTRO pet. Fechar o card mantém o raio
  // (selectedPet vira null, mas a condição abaixo não dispara).
  useEffect(() => {
    if (selectedPet && radiusPet && selectedPet.id !== radiusPet.id) {
      setPetRadius(null);
      setRadiusPet(null);
    }
  }, [selectedPet?.id]);


  // Enquadra o mapa no círculo do raio (pet posicionado acima do card)
  const fitMapToRadius = (r: number, pet: PetSighting) => {
    if (!mapRef.current) return;
    // metros -> graus (1° lat ≈ 111.320 m). Span 3.2x p/ folga e p/ caber
    // acima do card; centro deslocado p/ baixo p/ o pet subir na tela.
    const delta = (r * 3.2) / 111320;
    mapRef.current.animateToRegion(
      {
        latitude: pet.latitude - delta * 0.16,
        longitude: pet.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      550,
    );
  };

  // Chip de preset: marca o raio (ou cancela se r === null) e enquadra o mapa
  const selectPresetRadius = (r: number | null) => {
    if (r == null) { setPetRadius(null); setRadiusPet(null); return; }
    setPetRadius(r);
    setRadiusPet(selectedPet);
    if (selectedPet) fitMapToRadius(r, selectedPet);
  };

  // Modo seguir (estilo Waze). Diretriz anti-tremor:
  //  • Em movimento, a direção vem do CURSO DO GPS (coords.heading) — estável,
  //    pois deriva da trajetória, não do magnetômetro ruidoso.
  //  • Parado, usa a bússola com filtro forte; leituras descalibradas são
  //    descartadas (accuracy <= 1).
  //  • A câmera é movida por um LOOP de cadência fixa (250 ms) — nunca por
  //    evento — evitando animações que se interrompem e causam o "elástico".
  useEffect(() => {
    if (!followMode) return;
    let posSub: Location.LocationSubscription | undefined;
    let headSub: Location.LocationSubscription | undefined;
    let camLoop: ReturnType<typeof setInterval> | undefined;

    let currentCenter: { latitude: number; longitude: number } | null = null;
    let gpsHeading = 0;       // curso do GPS — estável em movimento
    let compassHeading = 0;   // bússola filtrada — usada parado
    let lastMoveTs = 0;       // marca do último deslocamento real
    let cameraReady = false;
    let appliedHeading = 0, appliedLat = 0, appliedLng = 0;

    const angleDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;
    const MOVING_SPEED = 0.7; // m/s — acima disso confiamos no curso do GPS
    const MOVE_HOLD = 8000;   // ms — mantém "em movimento" após o último passo
    const CADENCE = 250;      // ms — uma atualização de câmera a cada 250 ms
    const FOLLOW_ZOOM = 18;   // zoom fixo do seguir (evita o zoom "escorregar")
    const CENTER_DEADZONE_M = 4; // só recentra se o usuário andou ≥ 4 m (ignora o "vagar" do GPS parado)

    // ---- 1€ Filter (Casiez et al.) — passa-baixa adaptativo p/ a bússola ----
    const ONE_EURO = { minCutoff: 0.1, beta: 0.1, dCutoff: 1.0 };
    const euroAlpha = (cutoff: number, dt: number) => {
      const r = 2 * Math.PI * cutoff * dt;
      return r / (r + 1);
    };
    let euroX = 0, euroDx = 0, euroT = 0, euroReady = false;
    const oneEuro = (x: number, tMs: number) => {
      if (!euroReady) { euroX = x; euroDx = 0; euroT = tMs; euroReady = true; return x; }
      const dt = Math.min(Math.max((tMs - euroT) / 1000, 1 / 90), 0.25);
      const dx = (x - euroX) / dt;
      const aD = euroAlpha(ONE_EURO.dCutoff, dt);
      euroDx = aD * dx + (1 - aD) * euroDx;
      const cutoff = ONE_EURO.minCutoff + ONE_EURO.beta * Math.abs(euroDx);
      const a = euroAlpha(cutoff, dt);
      euroX = a * x + (1 - a) * euroX;
      euroT = tMs;
      return euroX;
    };
    let unwrapped = 0, lastRaw = 0, unwrapReady = false;

    (async () => {
      try {
        // entrada estilo Waze: centraliza, aproxima e inclina
        const loc0 = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setLocation(loc0);
        currentCenter = { latitude: loc0.coords.latitude, longitude: loc0.coords.longitude };
        appliedLat = currentCenter.latitude;
        appliedLng = currentCenter.longitude;
        mapRef.current?.animateCamera(
          { center: currentCenter, zoom: FOLLOW_ZOOM, heading: 0, pitch: followPitch() },
          { duration: 700 }
        );
        cameraReady = true;

        // Posição: recentra e capta o curso do GPS quando há movimento real.
        posSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 3 },
          (loc) => {
            setLocation(loc);
            currentCenter = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            const spd = loc.coords.speed ?? -1;
            const crs = loc.coords.heading ?? -1;
            if (spd >= MOVING_SPEED && crs >= 0) {
              gpsHeading = crs;
              lastMoveTs = Date.now();
            }
          }
        );

        // Bússola: alimenta apenas o valor "parado"; descarta sensor ruim.
        headSub = await Location.watchHeadingAsync((h) => {
          if ((h.accuracy ?? 3) <= 1) return; // sensor descalibrado
          const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (raw < 0) return;
          if (!unwrapReady) { unwrapped = raw; lastRaw = raw; unwrapReady = true; }
          else { unwrapped += angleDelta(raw, lastRaw); lastRaw = raw; }
          const filtered = oneEuro(unwrapped, Date.now());
          compassHeading = ((filtered % 360) + 360) % 360;
        });

        // Loop de cadência fixa — única coisa que mexe na câmera.
        camLoop = setInterval(() => {
          if (!cameraReady || !currentCenter) return;
          const moving = Date.now() - lastMoveTs < MOVE_HOLD;
          const target = moving ? gpsHeading : compassHeading;
          // zona morta de 2° (heading) + dead-zone de ~4 m (centro): parado, o
          // GPS pode vaguear que a câmera não persegue — elimina a tremida.
          const headingChanged = Math.abs(angleDelta(target, appliedHeading)) >= 2;
          const centerChanged =
            distMeters(appliedLat, appliedLng, currentCenter.latitude, currentCenter.longitude) >= CENTER_DEADZONE_M;
          if (!headingChanged && !centerChanged) return;
          appliedHeading = target;
          appliedLat = currentCenter.latitude;
          appliedLng = currentCenter.longitude;
          mapRef.current?.animateCamera(
            { center: currentCenter, heading: target, pitch: followPitch(), zoom: FOLLOW_ZOOM },
            { duration: CADENCE }
          );
        }, CADENCE);
      } catch (e) {
        console.warn('Erro no modo seguir', e);
      }
    })();

    return () => {
      posSub?.remove();
      headSub?.remove();
      if (camLoop) clearInterval(camLoop);
    };
  }, [followMode]);

  if (!location) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF4757" />
        <Text style={styles.loadingText}>Localizando você no mapa...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        onLayout={(e) => { mapLayout.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}
        provider={PROVIDER_GOOGLE}
        googleRenderer="LEGACY"
        mapType={mapType}
        customMapStyle={mapType === 'standard' ? customMapStyle : undefined}
        showsBuildings={true}
        pitchEnabled={true}
        initialRegion={{
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        onMapReady={() => {
          // Se há um foco pendente (veio de "Ver no mapa"/"Ver alerta"), centraliza
          // nele; senão, garante o zoom na minha localização (alguns Android
          // ignoram o initialRegion).
          const target = pendingFocusRef.current;
          if (target) {
            pendingFocusRef.current = null;
            mapRef.current?.animateToRegion(
              { latitude: target.latitude, longitude: target.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
              600,
            );
            return;
          }
          mapRef.current?.animateToRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }, 600);
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onRegionChange={(region) => {
          // Cola a caixa "PET VISTO" à coordenada durante o arraste (2D). Em 3D a
          // projeção linear não vale → reancora preciso ao soltar.
          if (is3D) return;
          if (selectedSighting && !sightingDetails && !cardOpen) {
            projectSighting(selectedSighting.latitude, selectedSighting.longitude, region);
          }
        }}
        onRegionChangeComplete={(region) => {
          setCurrentRegion(region);
          if (selectedSighting && !sightingDetails && !cardOpen) {
            // 3D: projeção nativa precisa; 2D: a mesma linear do arraste (sem pulo).
            if (is3D) computeSightingPoint(selectedSighting.latitude, selectedSighting.longitude);
            else projectSighting(selectedSighting.latitude, selectedSighting.longitude, region);
          }
        }}
        onPress={() => { setSelectedPet(null); setCardOpen(false); setRouteCoords([]); setRouteInfo(null); if (selectedSighting && !sightingDetails) setSelectedSighting(null); }}
        scrollEnabled={!followMode}
        rotateEnabled={!followMode}
      >
        {/* Minha posição — ícone customizado no lugar do ponto azul nativo */}
        <Marker
          coordinate={{ latitude: location.coords.latitude, longitude: location.coords.longitude }}
          anchor={meIcons[pinColor] ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
          image={meIcons[pinColor] ? { uri: meIcons[pinColor] } : undefined}
          pinColor={meIcons[pinColor] ? undefined : pinColor}
          title="Você"
        />

        {/* Raio de busca visual — só mostra quando não é "Brasil inteiro" */}
        {radius < 5_000_000 && (
          <Circle
            center={{ latitude: location.coords.latitude, longitude: location.coords.longitude }}
            radius={radius}
            fillColor="rgba(255,71,87,0.06)"
            strokeColor="rgba(255,71,87,0.30)"
            strokeWidth={2}
          />
        )}

        {/* Raio de busca marcado ao redor do pet (persiste com o card fechado) */}
        {radiusPet && petRadius != null && (
          <Circle
            center={{ latitude: radiusPet.latitude, longitude: radiusPet.longitude }}
            radius={petRadius}
            fillColor="rgba(15,185,177,0.14)"
            strokeColor="rgba(15,185,177,0.95)"
            strokeWidth={3}
          />
        )}

        {/* Polyline de rota até o pet selecionado */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#3498DB"
            strokeWidth={4}
            lineDashPattern={[0]}
          />
        )}

        {/* Trilha de avistamentos — só a LINHA (as bolinhas são overlays projetados,
            fora do MapView, porque o <Marker> nativo desta bolinha renderiza fora
            do ponto neste device). */}
        {selectedPet && trail.length > 0 && (
          <Polyline
            coordinates={[
              { latitude: Number(selectedPet.latitude), longitude: Number(selectedPet.longitude) },
              ...trail.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
            ]}
            strokeColor="#F79F1F"
            strokeWidth={4}
            lineDashPattern={[8, 8]}
            geodesic
          />
        )}


        {/* Área de busca ao redor de um avistamento */}
        {sightingArea && (
          <Circle
            center={{ latitude: sightingArea.latitude, longitude: sightingArea.longitude }}
            radius={sightingArea.radius}
            fillColor="rgba(255,195,18,0.18)"
            strokeColor="rgba(247,159,31,0.95)"
            strokeWidth={3}
          />
        )}

        {/* Clusters — grupo de pets próximos quando o mapa está afastado */}
        {clusteredPets.clusters.map((cluster) => (
          <ClusterMarker
            key={`cluster-${cluster.id}`}
            latitude={cluster.latitude}
            longitude={cluster.longitude}
            icon={clusterIcons[cluster.count]}
            onPress={() => {
              mapRef.current?.animateToRegion({
                latitude: cluster.latitude,
                longitude: cluster.longitude,
                latitudeDelta: (currentRegion?.latitudeDelta ?? 0.1) * 0.4,
                longitudeDelta: (currentRegion?.longitudeDelta ?? 0.1) * 0.4,
              }, 400);
            }}
          />
        ))}

        {clusteredPets.singles.map((pet) => {
          const lat = Number(pet.latitude);
          const lng = Number(pet.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const isActive = selectedPet?.id === pet.id;
          const ic = markerIcons[pet.id];
          const icon = isActive ? (ic?.large ?? ic?.small) : (ic?.small ?? ic?.large);
          return (
            <PetSingleMarker
              key={pet.id}
              latitude={lat}
              longitude={lng}
              isActive={isActive}
              icon={icon}
              onPress={() => handlePetPress(pet)}
            />
          );
        })}


        {/* Markers de buscadores em tempo real (não renderiza o próprio —
            o ponto azul nativo do GPS já marca a posição do usuário) */}
        {searchers.map((s) => {
          if (s.user_id === user?.id) return null;
          const lat = Number(s.latitude);
          const lng = Number(s.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const color = s.pin_color || '#3498DB';
          const icon = searcherIcons[searcherIconKey(color, !!s.is_premium)];
          return (
            <Marker
              key={`searcher-${s.user_id}`}
              coordinate={{ latitude: lat, longitude: lng }}
              anchor={{ x: 0.5, y: 1 }}
              image={icon ? { uri: icon } : undefined}
              pinColor={icon ? undefined : color}
              title={s.is_premium ? `⭐ ${s.name}` : s.name}
              description={s.rescues_count > 0 ? `${s.rescues_count} resgates` : 'Buscador ativo'}
            />
          );
        })}

        {/* Box de 1 clique do pet — PNG capturado, ancorado acima da foto (colado
            nativamente). Fica abaixo do box do avistamento (que é overlay). */}
        {selectedPet && !cardOpen
          && labelIcons[selectedPet.id]
          && Number.isFinite(Number(selectedPet.latitude))
          && Number.isFinite(Number(selectedPet.longitude)) && (
            // Mostra assim que houver QUALQUER PNG capturado para este pet (não
            // espera a trilha). A key inclui a assinatura → quando a contagem muda,
            // remonta JÁ com a nova imagem (sem fase de pino/opacity).
            <Marker
              key={`label-${selectedPet.id}-${labelIcons[selectedPet.id].sig}`}
              coordinate={{ latitude: Number(selectedPet.latitude), longitude: Number(selectedPet.longitude) }}
              anchor={{ x: 0.5, y: 1 }}
              image={{ uri: labelIcons[selectedPet.id].uri }}
              zIndex={1000}
              onPress={(e) => { e.stopPropagation(); handlePetPress(selectedPet); }}
            />
          )}

        {/* Bolinhas da trilha como Markers nativos (para evitar bugs de desalinhamento de projeção linear e dynamic swap do Android) */}
        {selectedPet && trail.length > 0 && !sightingDetails && !cardOpen && trail.map((p, i) => {
          const lat = Number(p.latitude);
          const lng = Number(p.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const active = selectedSighting?.id === p.id;
          const iconUri = sightingIcons[p.id];
          
          if (iconUri) {
            return (
              <Marker
                key={`trail-marker-img-${p.id}`}
                coordinate={{ latitude: lat, longitude: lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={active ? 1001 : 1000}
                image={{ uri: iconUri }}
                onPress={(e) => {
                  e.stopPropagation();
                  setSightingDetails(false);
                  setSelectedSighting({
                    id: p.id,
                    latitude: lat,
                    longitude: lng,
                    index: i + 1,
                    created_at: p.created_at,
                    photo_url: p.photo_url,
                    source_pet_id: p.source_pet_id,
                    finder_id: p.finder_id
                  });
                  computeSightingPoint(lat, lng);
                  loadSightingAddress(lat, lng);
                }}
              />
            );
          }

          return (
            <Marker
              key={`trail-marker-pin-${p.id}`}
              coordinate={{ latitude: lat, longitude: lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={active ? 1001 : 1000}
              pinColor="#FFC312"
              onPress={(e) => {
                e.stopPropagation();
                setSightingDetails(false);
                setSelectedSighting({
                  id: p.id,
                  latitude: lat,
                  longitude: lng,
                  index: i + 1,
                  created_at: p.created_at,
                  photo_url: p.photo_url,
                  source_pet_id: p.source_pet_id,
                  finder_id: p.finder_id
                });
                computeSightingPoint(lat, lng);
                loadSightingAddress(lat, lng);
              }}
            />
          );
        })}

      </MapView>

      {/* Área oculta — renderiza e captura os markers de pet como imagem.
          Necessário porque <Image> dentro de <Marker> quebra no New Architecture.
          O view-shot gera um PNG que é usado como ícone nativo do marker. */}
      <View style={styles.hiddenCaptureArea} pointerEvents="none">
        {pets
          .filter((p) => p.photo_url)
          .map((p) => {
            const ic = markerIcons[p.id];
            return (
              <React.Fragment key={`cap-${p.id}`}>
                {!ic?.small && <MarkerCapture pet={p} variant="small" onCaptured={onMarkerCaptured} />}
                {!ic?.large && <MarkerCapture pet={p} variant="large" onCaptured={onMarkerCaptured} />}
              </React.Fragment>
            );
          })}
        {/* Captura o box de 1 clique do pet. Captura assim que o pet é selecionado
            (contagem atual) e RECAPTURA quando o nº de avistamentos muda — sem
            depender de trailLoading. */}
        {selectedPet && labelIcons[selectedPet.id]?.sig !== `${trail.length}` && (
          <PetLabelCapture
            // key = só o petId (NÃO inclui trail.length): se a contagem muda
            // durante os 180ms da captura, o componente continua montado e a
            // captura conclui — senão era desmontado/cancelado e o box não abria.
            key={`labelcap-${selectedPet.id}`}
            pet={selectedPet}
            nSight={trail.length}
            distance={typeof selectedPet.distance === 'number' ? selectedPet.distance : null}
            onCaptured={(uri) => onLabelCaptured(selectedPet.id, `${trail.length}`, uri)}
          />
        )}
        {searcherIconNeeds
          .filter((it) => !searcherIcons[it.key])
          .map((it) => (
            <SearcherIconCapture
              key={it.key}
              iconKey={it.key}
              color={it.color}
              premium={it.premium}
              onCaptured={onSearcherIconCaptured}
            />
          ))}
        {!meIcons[pinColor] && (
          <MeIconCapture key={pinColor} color={pinColor} onCaptured={onMeIconCaptured} />
        )}
        {/* Captura ícones de cluster — um PNG por quantidade distinta */}
        {Array.from(new Set(clusteredPets.clusters.map((c) => c.count)))
          .filter((count) => !clusterIcons[count])
          .map((count) => (
            <ClusterCapture key={`cluster-icon-${count}`} count={count} onCaptured={onClusterIconCaptured} />
          ))}

        {/* Captura bolinhas de avistamento (trilha) com posicionamento absoluto para evitar offset acumulado */}
        {selectedPet && trail.map((p, i) => {
          if (!p.photo_url || sightingIcons[p.id]) return null;
          return (
            <View key={`sightcap-wrap-${p.id}`} style={{ position: 'absolute', left: 0, top: 0 }}>
              <SightingMarkerCapture
                id={p.id}
                photo={p.photo_url}
                index={i + 1}
                onCaptured={onSightingIconCaptured}
              />
            </View>
          );
        })}
      </View>

      {/* Floating Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {/* Esquerda: marca (logo + nome) */}
          <View style={styles.headerLeft}>
            <View style={styles.headerLogoWrap}>
              <View style={styles.headerLogoGlow} />
              <Image
                source={require('../../logotipo/icon.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
            </View>
            <View style={styles.headerTitleContainer}>
              <View style={styles.headerTitleWrap}>
                {/* Camadas de brilho: cópias transparentes do texto, só com a
                    sombra branca, empilhadas atrás — o glow segue as letras */}
                <Text style={[styles.headerTitle, styles.headerTitleGlowLayer]} numberOfLines={1}>
                  PetPerdidoSOS
                </Text>
                <Text style={[styles.headerTitle, styles.headerTitleGlowLayer]} numberOfLines={1}>
                  PetPerdidoSOS
                </Text>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  PetPerdido<Text style={styles.headerTitleHighlight}>SOS</Text>
                </Text>
              </View>
              <View style={styles.headerSubtitleWrap}>
                {/* Mesmo glow do nome: cópias transparentes empilhadas atrás */}
                <Text style={[styles.headerSubtitle, styles.headerSubtitleGlowLayer]} numberOfLines={1}>
                  Ajude a encontrar pets próximos
                </Text>
                <Text style={[styles.headerSubtitle, styles.headerSubtitleGlowLayer]} numberOfLines={1}>
                  Ajude a encontrar pets próximos
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>Ajude a encontrar pets próximos</Text>
              </View>
            </View>
          </View>

          {/* Direita: sino de alertas + miniatura do usuário */}
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.notificationBtn}
              onPress={() => { setUnreadCount(0); router.push('/profile/notifications'); }}
            >
              <Animated.View style={{
                transform: [{ rotate: bellAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] }) }],
              }}>
                <Ionicons
                  name={unreadCount > 0 ? 'notifications' : 'notifications-outline'}
                  size={26}
                  color={unreadCount > 0 ? '#FF4757' : '#2F3542'}
                />
              </Animated.View>
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')}>
              {profile?.photo_url ? (
                <Image source={{ uri: profile.photo_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: '#DFE4EA', justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="person" size={22} color="#A4B0BE" />
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
        
        <TouchableOpacity style={styles.searchBar} onPress={() => setShowFilter(true)}>
          <Ionicons name="location" size={20} color="#FF4757" />
          <Text style={styles.searchPlaceholder}>
            {radius === 5000000
              ? 'Buscando em todo o Brasil'
              : radius >= 1000
                ? `Buscando em ${radius / 1000}km`
                : `Buscando em ${radius}m`}
          </Text>
          <Ionicons name="options-outline" size={20} color="#2F3542" />
        </TouchableOpacity>

        {/* Atalhos do SOS: ver em Lista e ir para Adoção (saíram da barra inferior) */}
        <View style={styles.sosQuickRow}>
          <TouchableOpacity style={styles.sosQuickBtn} activeOpacity={0.85} onPress={() => router.push('/alertas')}>
            <Ionicons name="list" size={16} color="#FF4757" />
            <Text style={styles.sosQuickText}>Ver em lista</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sosQuickBtn, styles.sosQuickAdocao]} activeOpacity={0.85} onPress={() => router.push('/doacao')}>
            <Ionicons name="heart" size={15} color="#3B82F6" />
            <Text style={[styles.sosQuickText, { color: '#3B82F6' }]}>Adoção</Text>
            <Ionicons name="chevron-forward" size={13} color="#3B82F6" />
          </TouchableOpacity>
        </View>

        {/* Legenda interativa = filtro por tipo (toque para mostrar/ocultar) */}
        <View style={styles.legendBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.legendScrollContent}
          >
            {([
              { key: 'lost', label: 'Perdido', color: '#FF4757', icon: 'megaphone' },
              { key: 'sighted', label: 'Visto', color: '#FFC312', icon: 'eye' },
              { key: 'rescued', label: 'Resgatado', color: '#2ED573', icon: 'alert-circle' },
            ] as { key: 'lost' | 'sighted' | 'rescued' | 'donation'; label: string; color: string; icon: any }[]).map((it) => {
              const on = typeFilter[it.key];
              return (
                <TouchableOpacity
                  key={it.key}
                  activeOpacity={0.7}
                  onPress={() => setTypeFilter((prev) => ({ ...prev, [it.key]: !prev[it.key] }))}
                  style={[styles.legendItem, on ? { borderColor: it.color } : { opacity: 0.55 }]}
                >
                  <Ionicons name={it.icon} size={13} color={on ? it.color : '#8A93A0'} />
                  <Text style={[styles.legendText, { color: on ? it.color : '#8A93A0' }]}>{it.label}</Text>
                  <View style={[styles.legendCount, { backgroundColor: on ? it.color : '#CED6E0' }]}>
                    <Text style={styles.legendCountText}>{typeCounts[it.key]}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* FAB de localização — toggle do "modo seguir" */}
      <TouchableOpacity
        style={[styles.fabLocation, followMode && styles.fabLocationActive]}
        onPress={() => {
          if (followMode) {
            // desativa: volta ao norte; mantém a inclinação se o 3D estiver ligado
            setFollowMode(false);
            mapRef.current?.animateCamera({ heading: 0, pitch: is3D ? 55 : 0 }, { duration: 500 });
          } else {
            setFollowMode(true);
          }
        }}
      >
        <Ionicons name="navigate" size={24} color={followMode ? '#FFF' : '#FF4757'} />
      </TouchableOpacity>

      {/* FAB — Alternar 2D / 3D (câmera inclinada + prédios) */}
      <TouchableOpacity
        style={[styles.fab3D, is3D && styles.fab3DActive]}
        activeOpacity={0.85}
        onPress={() => {
          const next = !is3D;
          setIs3D(next);
          is3DRef.current = next; // imediato para o loop do modo seguir
          mapRef.current?.animateCamera({ pitch: next ? 55 : 0 }, { duration: 500 });
          // Após a inclinação, reancora a caixa "PET VISTO" pela projeção nativa
          // (as bolinhas da trilha são <Marker> nativo e o mapa as reposiciona).
          setTimeout(() => {
            if (selectedSighting && !sightingDetails && !cardOpen) {
              computeSightingPoint(selectedSighting.latitude, selectedSighting.longitude);
            }
          }, 600);
        }}
      >
        <Ionicons name="cube-outline" size={20} color={is3D ? '#FFF' : '#2F3542'} />
        <Text style={[styles.fab3DText, is3D && { color: '#FFF' }]}>{is3D ? '3D' : '2D'}</Text>
      </TouchableOpacity>

      {/* FAB — Alternar tipo de mapa (Normal / Satélite / Terreno) */}
      <TouchableOpacity style={styles.fabMapType} onPress={cycleMapType} activeOpacity={0.85}>
        <Ionicons name={MAP_TYPE_META[mapType].icon as any} size={20} color={mapType === 'standard' ? '#2F3542' : '#FF4757'} />
        <Text style={[styles.fabMapTypeText, mapType !== 'standard' && { color: '#FF4757' }]}>
          {MAP_TYPE_META[mapType].label}
        </Text>
      </TouchableOpacity>

      {/* Botão flutuante — cancelar o raio de busca marcado no pet.
          Aparece acima do "Encontrei um pet" enquanto houver raio ativo. */}
      {radiusPet && petRadius != null && !cardOpen && (
        <TouchableOpacity
          style={styles.fabCancelRadius}
          onPress={() => selectPresetRadius(null)}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={16} color="#0FB9B1" />
        </TouchableOpacity>
      )}

      {/* FAB — Encontrei um pet (reconhecimento por IA) */}
      <TouchableOpacity style={styles.fabFindPet} onPress={() => router.push('/find-pet')} activeOpacity={0.9}>
        <Ionicons name="sparkles" size={20} color="#FFF" />
        <Text style={styles.fabFindPetText}>Encontrei um pet</Text>
      </TouchableOpacity>

      {/* Bolinhas da trilha — renderizadas nativamente como markers dentro do MapView */}


      {/* Avistamento — caixa de 1 clique (OVERLAY acima do mapa → sempre à frente
          de qualquer marcador). Posicionada na bolinha e colada a ela ao arrastar
          (projeção). Sem botões: toque abre os detalhes. */}
      {selectedSighting && !sightingDetails && !cardOpen && sightingPoint && (() => {
        const W = Dimensions.get('window').width;
        const cardW = Math.min(250, W - 24);
        const px = Math.max(8, Math.min(sightingPoint.x - cardW / 2, W - cardW - 8));
        const aboveTop = sightingPoint.y - 200;
        const placedBelow = aboveTop < 80;
        const top = placedBelow ? sightingPoint.y + 24 : aboveTop;
        const arrowLeft = Math.max(16, Math.min(sightingPoint.x - px - 9, cardW - 34));
        const elapsed = formatElapsedMask(selectedSighting.created_at);
        return (
          <View style={[styles.sightingOverlay, { left: px, top, width: cardW }]} onStartShouldSetResponder={() => true}>
            {placedBelow
              ? <View style={[styles.sightingOvArrowUp, { left: arrowLeft }]} />
              : <View style={[styles.sightingOvArrowDown, { left: arrowLeft }]} />}
            <TouchableOpacity activeOpacity={0.9} onPress={() => setSightingDetails(true)}>
              {/* Cabeçalho: badge + fechar */}
              <View style={styles.sightingOvHead}>
                <View style={styles.sightingOvBadge}>
                  <Ionicons name="eye" size={11} color="#fff" />
                  <Text style={styles.sightingOvBadgeText}>PET VISTO</Text>
                </View>
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={styles.sightingOvClose} onPress={() => setSelectedSighting(null)} hitSlop={8}>
                  <Ionicons name="close" size={15} color="#A4B0BE" />
                </TouchableOpacity>
              </View>

              {/* Data e hora do avistamento */}
              {!!selectedSighting.created_at && (
                <View style={[styles.sightingOvInfoRow, { marginTop: 11 }]}>
                  <Ionicons name="time-outline" size={13} color="#A4B0BE" />
                  <Text style={styles.sightingOvInfoText} numberOfLines={1}>{new Date(selectedSighting.created_at).toLocaleString('pt-BR')}</Text>
                </View>
              )}

              {/* Tempo decorrido (abaixo da data/hora) */}
              {!!elapsed && (
                <View style={styles.sightingOvInfoRow}>
                  <Ionicons name="hourglass-outline" size={13} color="#F79F1F" />
                  <Text style={[styles.sightingOvInfoText, { color: '#F79F1F', fontWeight: '800' }]} numberOfLines={2}>{elapsed}</Text>
                </View>
              )}

              {/* Endereço aproximado: rua, bairro, cidade, estado (sem número) */}
              <View style={styles.sightingOvInfoRow}>
                <Ionicons name="location-outline" size={13} color="#A4B0BE" />
                <Text style={styles.sightingOvInfoText} numberOfLines={2}>{sightingAddress ?? 'Buscando endereço…'}</Text>
              </View>

              <View style={styles.sightingOvDivider} />

              {/* Indicador "toque para ver detalhes" (3 pontinhos) */}
              <View style={styles.sightingOvMoreRow}>
                <Ionicons name="ellipsis-horizontal" size={18} color="#F79F1F" />
                <Text style={styles.sightingOvMoreText}>Toque para ver detalhes</Text>
              </View>
            </TouchableOpacity>
          </View>
        );
      })()}




      {/* Avistamento — caixa de detalhes (carrossel + info) */}
      {selectedSighting && sightingDetails && !cardOpen && (() => {
        const heroW = Dimensions.get('window').width - 32;
        const gallery = sightingGallery.length ? sightingGallery : (selectedSighting.photo_url ? [selectedSighting.photo_url] : []);
        const distTxt = location
          ? (() => { const d = distMeters(location.coords.latitude, location.coords.longitude, selectedSighting.latitude, selectedSighting.longitude); return `${formatDistance(d)} de você`; })()
          : null;
        const elapsed = formatElapsedMask(selectedSighting.created_at);
        return (
        <View style={styles.bottomSheet}>
          {/* Hero: carrossel com altura ajustável (arraste) + badge .PET VISTO */}
          <Animated.View style={[styles.sheetHero, { height: heroHeight }]}>
            {gallery.length > 0 ? (
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={StyleSheet.absoluteFill}
                onMomentumScrollEnd={(e) => setSightingGalleryIndex(Math.round(e.nativeEvent.contentOffset.x / heroW))}
              >
                {gallery.map((u, idx) => (
                  <Image key={idx} source={{ uri: u }} style={{ width: heroW, height: '100%' }} resizeMode="cover" />
                ))}
              </ScrollView>
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#FFF1C9', justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="paw" size={40} color="#F79F1F" /></View>
            )}
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.78)']} style={styles.sheetHeroGradient} pointerEvents="none" />
            {/* Barrinha de arrasto — ↑ expande a foto, ↓ comprime */}
            <View style={styles.sheetIndicatorWrap} {...heroPanResponder.panHandlers}>
              <View style={styles.sheetIndicatorPill} />
            </View>
            {/* Badge .PET VISTO (topo esquerdo, amarelo) */}
            <View style={styles.sightingHeroBadge}>
              <Ionicons name="eye" size={12} color="#fff" />
              <Text style={styles.sightingHeroBadgeText}>PET VISTO</Text>
            </View>
            <TouchableOpacity style={styles.sheetCloseBtnTop} onPress={() => setSightingDetails(false)}>
              <Ionicons name="close" size={16} color="#2F3542" />
            </TouchableOpacity>
            {gallery.length > 1 && (
              <View style={styles.sightingDots} pointerEvents="none">
                {gallery.map((_, idx) => <View key={idx} style={[styles.sightingDot, idx === sightingGalleryIndex && styles.sightingDotActive]} />)}
              </View>
            )}
            <View style={styles.sheetHeroInfo} pointerEvents="none">
              <Text style={styles.sheetHeroName} numberOfLines={1}>{sightingTitleByIndex(selectedSighting.index)}</Text>
            </View>
          </Animated.View>

          {/* Corpo */}
          <View style={styles.sheetBody}>
            {/* Cartão de informações principais */}
            <View style={styles.sightingInfoCard}>
              {!!selectedSighting.created_at && (
                <View style={styles.sightingInfoLine}>
                  <View style={styles.sightingInfoIcon}><Ionicons name="calendar-outline" size={15} color="#F79F1F" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sightingInfoLabel}>Data e hora</Text>
                    <Text style={styles.sightingInfoValue}>{new Date(selectedSighting.created_at).toLocaleString('pt-BR')}</Text>
                  </View>
                </View>
              )}
              {!!elapsed && (
                <View style={styles.sightingInfoLine}>
                  <View style={styles.sightingInfoIcon}><Ionicons name="hourglass-outline" size={15} color="#F79F1F" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sightingInfoLabel}>Tempo decorrido</Text>
                    <Text style={[styles.sightingInfoValue, { color: '#F79F1F', fontWeight: '800' }]}>{elapsed}</Text>
                  </View>
                </View>
              )}
              <View style={styles.sightingInfoLine}>
                <View style={styles.sightingInfoIcon}><Ionicons name="location-outline" size={15} color="#F79F1F" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sightingInfoLabel}>Local aproximado</Text>
                  <Text style={styles.sightingInfoValue} numberOfLines={2}>{sightingAddress ?? 'Buscando endereço…'}</Text>
                </View>
              </View>
              {!!distTxt && (
                <View style={[styles.sightingInfoLine, styles.sightingInfoLineLast]}>
                  <View style={styles.sightingInfoIcon}><Ionicons name="navigate-outline" size={15} color="#F79F1F" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sightingInfoLabel}>Distância</Text>
                    <Text style={styles.sightingInfoValue}>{distTxt}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Descrição do avistamento */}
            {!!sightingDesc && (
              <View style={styles.sightingDescBox}>
                <Text style={styles.sightingDescTitle}>Detalhes do avistamento</Text>
                <Text style={styles.sightingDescText}>{sightingDesc}</Text>
              </View>
            )}

            {/* Visto por */}
            <View style={styles.sightingFinderRow}>
              <View style={styles.sightingFinderAvatar}><Ionicons name="person" size={16} color="#F79F1F" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sightingInfoLabel}>Visto por</Text>
                <Text style={styles.sightingFinderName} numberOfLines={1}>{sightingFinder ?? '—'}</Text>
              </View>
            </View>

            {/* Ações: Rota + Raio de busca */}
            {(() => {
              const areaActive = sightingArea && sightingArea.latitude === selectedSighting.latitude && sightingArea.longitude === selectedSighting.longitude;
              return (
                <View style={styles.sightingActions}>
                  <TouchableOpacity style={[styles.sightingBtn, styles.sightingBtnRoute]} onPress={() => { setSightingDetails(false); fetchInAppRoute(selectedSighting.latitude, selectedSighting.longitude); }}>
                    <Ionicons name="navigate" size={16} color="#fff" />
                    <Text style={[styles.sightingBtnText, { color: '#fff' }]}>Traçar rota</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sightingBtn, areaActive ? styles.sightingBtnAreaActive : styles.sightingBtnArea]}
                    onPress={() => {
                      if (areaActive) { setSightingArea(null); return; }
                      setSightingArea({ latitude: selectedSighting.latitude, longitude: selectedSighting.longitude, radius: 300 });
                      setSightingDetails(false);
                      mapRef.current?.animateToRegion({ latitude: selectedSighting.latitude, longitude: selectedSighting.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
                    }}
                  >
                    <Ionicons name="locate" size={16} color={areaActive ? '#fff' : '#F79F1F'} />
                    <Text style={[styles.sightingBtnText, { color: areaActive ? '#fff' : '#F79F1F' }]}>{areaActive ? 'Remover raio' : 'Raio de busca'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
          </View>
        </View>
        );
      })()}

      {/* Premium Bottom Sheet for Pet Details */}
      <Animated.View style={[styles.bottomSheet, { transform: [{ translateY: slideAnim }] }]}>
        {cardOpen && selectedPet && (
          <>
            {/* Hero: foto full-width com gradiente e info sobreposta */}
            <Animated.View style={[styles.sheetHero, { height: heroHeight }]}>
              {cardGallery.length > 0 ? (
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={cardGallery.length > 1}
                  style={StyleSheet.absoluteFillObject}
                  onMomentumScrollEnd={(e) => setCardGalleryIndex(Math.round(e.nativeEvent.contentOffset.x / CARD_W))}
                >
                  {cardGallery.map((uri, i) => (
                    <Image key={i} source={{ uri }} style={{ width: CARD_W, height: HERO_MAX }} resizeMode="cover" />
                  ))}
                </ScrollView>
              ) : (
                <Image
                  source={{ uri: selectedPet.photo_url || 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=400' }}
                  style={StyleSheet.absoluteFillObject}
                  resizeMode="cover"
                />
              )}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.78)']}
                style={styles.sheetHeroGradient}
                pointerEvents="none"
              />
              {/* Barrinha de arrasto — arraste ↑ para expandir a foto, ↓ para comprimir */}
              <View style={styles.sheetIndicatorWrap} {...heroPanResponder.panHandlers}>
                <View style={styles.sheetIndicatorPill} />
              </View>
              {/* Contador de fotos (carrossel) */}
              {cardGallery.length > 1 && (
                <View pointerEvents="none" style={styles.heroPhotoCounter}>
                  <View style={styles.heroPhotoCounterPill}>
                    <Ionicons name="images" size={11} color="#FFF" />
                    <Text style={styles.heroPhotoCounterText}>{cardGalleryIndex + 1}/{cardGallery.length}</Text>
                  </View>
                </View>
              )}
              {/* Badge de tipo (topo esquerdo): PET PERDIDO / VISTO / RESGATADO */}
              <View pointerEvents="none" style={[styles.sightingHeroBadge, { backgroundColor: ringColorForPet(selectedPet) }]}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                <Text style={styles.sightingHeroBadgeText}>PET {petTypeLabel(selectedPet).toUpperCase()}</Text>
              </View>
              {/* Botão fechar */}
              <TouchableOpacity
                style={styles.sheetCloseBtnTop}
                onPress={() => { setSelectedPet(null); setCardOpen(false); }}
              >
                <Ionicons name="close" size={16} color="#2F3542" />
              </TouchableOpacity>
              {/* Nome + recompensa na base da foto */}
              <View pointerEvents="none" style={styles.sheetHeroInfo}>
                <Text style={styles.sheetHeroName} numberOfLines={1}>{selectedPet.name}</Text>
                {selectedPet.reward && selectedPet.reward.amount > 0 && (
                  <View style={styles.sheetHeroReward}>
                    <Text style={styles.sheetHeroRewardLabel}>Recompensa</Text>
                    <View style={styles.sheetHeroRewardValueRow}>
                      <Ionicons name="gift" size={12} color="#FFF" />
                      <Text style={styles.sheetHeroRewardText}>{formatBRL(selectedPet.reward.amount)}</Text>
                    </View>
                  </View>
                )}
              </View>
            </Animated.View>

            {/* Corpo */}
            <View style={styles.sheetBody}>
              {(() => {
                const tColor = ringColorForPet(selectedPet);
                const tBg = petTypeBg(selectedPet);
                const tLabel = petTypeLabel(selectedPet);
                const tElapsed = selectedPet.lost_date ? formatElapsedMask(selectedPet.lost_date) : null;
                return (
                  <>
                    {/* Cartão de informações principais */}
                    <View style={styles.sightingInfoCard}>
                      {!!tElapsed && (
                        <View style={styles.sightingInfoLine}>
                          <View style={[styles.sightingInfoIcon, { backgroundColor: tBg }]}><Ionicons name="hourglass-outline" size={15} color={tColor} /></View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.sightingInfoLabel}>Tempo {tLabel === 'Perdido' ? 'perdido' : `desde ${tLabel.toLowerCase()}`}</Text>
                            <Text style={[styles.sightingInfoValue, { color: tColor, fontWeight: '800' }]}>{tElapsed}</Text>
                          </View>
                        </View>
                      )}
                      <View style={styles.sightingInfoLine}>
                        <View style={[styles.sightingInfoIcon, { backgroundColor: tBg }]}><Ionicons name="navigate-outline" size={15} color={tColor} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.sightingInfoLabel}>Distância</Text>
                          <Text style={styles.sightingInfoValue}>{(() => {
                            // Calcula ao vivo a partir da localização do aparelho (o
                            // selectedPet.distance às vezes vem null); cai pro pré-calculado.
                            const m = location && Number.isFinite(Number(selectedPet.latitude)) && Number.isFinite(Number(selectedPet.longitude))
                              ? distMeters(location.coords.latitude, location.coords.longitude, Number(selectedPet.latitude), Number(selectedPet.longitude))
                              : selectedPet.distance;
                            const t = formatDistance(m);
                            return t ? `${t} de você` : 'Localização indisponível';
                          })()}</Text>
                        </View>
                      </View>
                      <View style={[styles.sightingInfoLine, styles.sightingInfoLineLast]}>
                        <View style={[styles.sightingInfoIcon, { backgroundColor: tBg }]}><Ionicons name="location-outline" size={15} color={tColor} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.sightingInfoLabel}>Local aproximado</Text>
                          <Text style={styles.sightingInfoValue} numberOfLines={2}>{petAddress ?? 'Buscando endereço…'}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Características */}
                    {(speciesLabel(selectedPet.species) || selectedPet.breed || selectedPet.color || selectedPet.size || sexLabel(selectedPet.sex) || ageLabel(selectedPet.age_group)) && (
                      <View style={styles.tagsRow}>
                        {speciesLabel(selectedPet.species) ? <View style={styles.tag}><Text style={styles.tagText}>{speciesLabel(selectedPet.species)}</Text></View> : null}
                        {selectedPet.breed ? <View style={styles.tag}><Text style={styles.tagText}>{selectedPet.breed}</Text></View> : null}
                        {selectedPet.color ? <View style={styles.tag}><Text style={styles.tagText}>{selectedPet.color}</Text></View> : null}
                        {sizeLabel(selectedPet.size) ? <View style={styles.tag}><Text style={styles.tagText}>{sizeLabel(selectedPet.size)}</Text></View> : null}
                        {sexLabel(selectedPet.sex) ? <View style={styles.tag}><Text style={styles.tagText}>{sexLabel(selectedPet.sex)}</Text></View> : null}
                        {ageLabel(selectedPet.age_group) ? <View style={styles.tag}><Text style={styles.tagText}>{ageLabel(selectedPet.age_group)}</Text></View> : null}
                      </View>
                    )}

                    {/* Tutor */}
                    <View style={styles.sightingFinderRow}>
                      <View style={[styles.sightingFinderAvatar, { backgroundColor: tBg }]}><Ionicons name="person" size={16} color={tColor} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sightingInfoLabel}>Tutor</Text>
                        <Text style={styles.sightingFinderName} numberOfLines={1}>{selectedPet.user?.name || 'Desconhecido'}</Text>
                      </View>
                      {(selectedPet.user?.rescues_count ?? 0) > 0 && (
                        <View style={styles.rescuesBadge}>
                          <Ionicons name="trophy" size={10} color="#FFF" />
                          <Text style={styles.rescuesBadgeText}>{selectedPet.user!.rescues_count}</Text>
                        </View>
                      )}
                    </View>
                  </>
                );
              })()}

              {/* Regras de adoção — só para doação */}
              {selectedPet.type === 'donation' && !!selectedPet.adoption_rules?.trim() && (
                <View style={styles.adoptCard}>
                  <View style={styles.adoptHeader}>
                    <Ionicons name="gift" size={15} color="#3B82F6" />
                    <Text style={styles.adoptTitle}>Regras para adoção</Text>
                  </View>
                  <Text style={styles.adoptText}>{selectedPet.adoption_rules!.trim()}</Text>
                </View>
              )}

              {/* Raio de busca ao redor do pet — não faz sentido para resgatado/doação */}
              {!['rescued', 'donation'].includes(selectedPet.type ?? 'lost') && (
              <View style={styles.radiusSection}>
                <View style={styles.radiusHeader}>
                  <Ionicons name="locate" size={15} color="#0FB9B1" />
                  <Text style={styles.radiusTitle}>Marcar raio de busca</Text>
                  {petRadius != null && (
                    <TouchableOpacity
                      style={styles.radiusClearBtn}
                      onPress={() => selectPresetRadius(null)}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={11} color="#747D8C" />
                      <Text style={styles.radiusClearText}>Limpar</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Presets rápidos — scroll horizontal: nunca quebra linha */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.radiusChipsRow}
                >
                  {PET_RADIUS_OPTIONS.map((opt) => {
                    const active = petRadius === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={[styles.radiusChip, active && styles.radiusChipActive]}
                        onPress={() => selectPresetRadius(active ? null : opt)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.radiusChipText, active && styles.radiusChipTextActive]}>
                          {opt >= 1000 ? `${opt / 1000} km` : `${opt} m`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              )}

              {/* Info de rota — aparece quando a rota está traçada */}
              {routeInfo && (
                <View style={styles.routeInfoBar}>
                  <Ionicons name="navigate-circle" size={18} color="#3498DB" />
                  <Text style={styles.routeInfoText}>{routeInfo.distance} · {routeInfo.duration} a pé</Text>
                  <TouchableOpacity onPress={() => { setRouteCoords([]); setRouteInfo(null); }}>
                    <Ionicons name="close-circle" size={18} color="#A4B0BE" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Ações */}
              <View style={styles.sheetActions}>
                <TouchableOpacity
                  style={[styles.sheetActionIcon, isFetchingRoute && { opacity: 0.6 }]}
                  onPress={() => fetchInAppRoute(selectedPet.latitude, selectedPet.longitude)}
                  disabled={isFetchingRoute}
                >
                  {isFetchingRoute
                    ? <ActivityIndicator size="small" color="#FF4757" />
                    : <Ionicons name="navigate" size={20} color="#FF4757" />
                  }
                  <Text style={styles.sheetActionIconText}>Rota</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetActionIcon} onPress={() => openDetails(selectedPet)}>
                  <Ionicons name="document-text-outline" size={20} color="#FF4757" />
                  <Text style={styles.sheetActionIconText}>Detalhes</Text>
                </TouchableOpacity>
                {isMyPet(selectedPet) ? (
                  <TouchableOpacity
                    style={[styles.sheetActionPrimary, { backgroundColor: '#747D8C', shadowColor: '#747D8C' }]}
                    onPress={() => router.push('/(tabs)/chats')}
                  >
                    <Ionicons name="chatbubbles-outline" size={18} color="#FFF" />
                    <Text style={styles.sheetActionPrimaryText}>Meus chats</Text>
                  </TouchableOpacity>
                ) : selectedPet.type === 'lost' ? (
                  <TouchableOpacity
                    style={styles.sheetActionPrimary}
                    onPress={() => router.push(`/chat/${selectedPet.id}?tutorId=${selectedPet.user?.id}`)}
                  >
                    <Ionicons name="chatbubbles" size={18} color="#FFF" />
                    <Text style={styles.sheetActionPrimaryText}>Conversar</Text>
                  </TouchableOpacity>
                ) : selectedPet.type === 'donation' ? (
                  <TouchableOpacity
                    style={[styles.sheetActionPrimary, { backgroundColor: '#3B82F6', shadowColor: '#3B82F6' }]}
                    onPress={() => router.push(`/chat/${selectedPet.id}?tutorId=${selectedPet.user?.id}`)}
                  >
                    <Ionicons name="heart" size={18} color="#FFF" />
                    <Text style={styles.sheetActionPrimaryText}>Tenho interesse</Text>
                  </TouchableOpacity>
                ) : (selectedPet.type === 'sighted' && selectedPet.allow_contact === false) ? (
                  <View style={[styles.sheetActionPrimary, { backgroundColor: '#CED6E0' }]}>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFF" />
                    <Text style={styles.sheetActionPrimaryText}>Sem contato</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.sheetActionPrimary}
                    onPress={() => handleSightingContact(selectedPet)}
                  >
                    <Ionicons name="paw" size={18} color="#FFF" />
                    <Text style={styles.sheetActionPrimaryText}>É o meu pet?</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Denunciar alerta inapropriado */}
              {!isMyPet(selectedPet) && isReportable(selectedPet) && (
                <TouchableOpacity
                  style={styles.reportLink}
                  onPress={() => setReportTarget({ id: selectedPet.id, name: selectedPet.name })}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flag-outline" size={15} color="#747D8C" />
                  <Text style={styles.reportLinkText}>Denunciar este alerta</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </Animated.View>

      {/* Details Modal — full screen */}
      <Modal visible={showDetails} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowDetails(false)}>
        <PetDetailsView
          pet={detailsPet}
          loading={detailsLoading}
          galleryIndex={galleryIndex}
          setGalleryIndex={setGalleryIndex}
          isMine={isMyPet(detailsPet)}
          canReport={isReportable(detailsPet)}
          onClose={() => setShowDetails(false)}
          onChat={() => {
            setShowDetails(false);
            if (!detailsPet) return;
            const dt = detailsPet.type ?? 'lost';
            if (dt === 'lost' || dt === 'donation') {
              // Doação: o interessado fala direto com o doador (chat no próprio alerta).
              router.push(`/chat/${detailsPet.id}?tutorId=${detailsPet.user_id}`);
            } else {
              handleSightingContact(detailsPet);
            }
          }}
          onMyChats={() => {
            setShowDetails(false);
            router.push('/(tabs)/chats');
          }}
          onRoute={() => detailsPet && openRoute(detailsPet.latitude, detailsPet.longitude)}
          onReport={() => detailsPet && setReportTarget({ id: detailsPet.id, name: detailsPet.name })}
          address={detailsPet && selectedPet && detailsPet.id === selectedPet.id ? petAddress : null}
          distanceM={detailsPet && selectedPet && detailsPet.id === selectedPet.id && typeof selectedPet.distance === 'number' ? selectedPet.distance : null}
          sightings={detailsPet && selectedPet && detailsPet.id === selectedPet.id ? trail : []}
          onOpenSighting={(s, idx) => {
            // Fecha o caso e abre o box de detalhes do avistamento no mapa.
            setShowDetails(false);
            setCardOpen(false);
            setSightingDetails(false);
            setSelectedSighting({ id: s.id, latitude: s.latitude, longitude: s.longitude, index: idx, created_at: s.created_at, photo_url: s.photo_url, source_pet_id: s.source_pet_id, finder_id: s.finder_id });
            computeSightingPoint(s.latitude, s.longitude);
            loadSightingAddress(s.latitude, s.longitude);
            mapRef.current?.animateToRegion({ latitude: s.latitude, longitude: s.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
            setTimeout(() => setSightingDetails(true), 350);
          }}
        />
      </Modal>

      {/* Filter Modal — abre como card logo abaixo da barra de filtro */}
      <Modal visible={showFilter} transparent animationType="fade" onRequestClose={() => setShowFilter(false)}>
        <TouchableOpacity
          style={styles.modalContainer}
          activeOpacity={1}
          onPress={() => setShowFilter(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filtros</Text>
              <TouchableOpacity onPress={() => setShowFilter(false)}>
                <Ionicons name="close" size={24} color="#2F3542" />
              </TouchableOpacity>
            </View>

            {/* Contadores por status (em tempo real) */}
            {isLoadingPets ? (
              <ActivityIndicator size="small" color="#FF4757" style={{ alignSelf: 'flex-start', marginBottom: 4 }} />
            ) : (
              <View style={styles.filterCountRow}>
                {([
                  { key: 'lost', color: '#FF4757', label: 'Perdido' },
                  { key: 'sighted', color: '#FFC312', label: 'Visto' },
                  { key: 'rescued', color: '#2ED573', label: 'Resgatado' },
                ] as { key: 'lost' | 'sighted' | 'rescued'; color: string; label: string }[]).map((s) => {
                  const n = typeCounts[s.key];
                  return (
                    <View key={s.key} style={[styles.statusCount, { backgroundColor: s.color + '1A' }]}>
                      <View style={[styles.statusDot, { backgroundColor: s.color }]} />
                      <Text style={[styles.statusCountText, { color: s.color }]}>
                        {n} {s.label}{n === 1 ? '' : 's'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Raio de busca — título, stepper (ajuste fino) e atalhos */}
            <Text style={styles.filterSectionLabel}>Raio de busca</Text>
            <View style={styles.radiusStepper}>
                <TouchableOpacity
                  style={styles.radiusStepBtn}
                  onPress={() => { setCustomRadius(''); setRadius((r) => { const b = r >= 5000000 ? 50000 : r; return Math.max(1000, b - 1000); }); }}
                >
                  <Ionicons name="remove" size={20} color="#FF4757" />
                </TouchableOpacity>
                <View style={styles.radiusValueWrap}>
                  <TextInput
                    style={styles.radiusValueInput}
                    keyboardType="numeric"
                    value={customRadius !== '' ? customRadius : (radius >= 5000000 ? 'BR' : String(Math.round(radius / 1000)))}
                    onChangeText={(t) => {
                      const digits = t.replace(/[^0-9]/g, '');
                      setCustomRadius(digits);
                      const v = Number(digits);
                      if (Number.isFinite(v) && v > 0) setRadius(Math.min(500, v) * 1000);
                    }}
                    onBlur={() => setCustomRadius('')}
                    maxLength={3}
                    textAlign="center"
                  />
                  <Text style={styles.radiusValueUnit}>km</Text>
                </View>
                <TouchableOpacity
                  style={styles.radiusStepBtn}
                  onPress={() => { setCustomRadius(''); setRadius((r) => { const b = r >= 5000000 ? 50000 : r; return Math.min(500000, b + 1000); }); }}
                >
                  <Ionicons name="add" size={20} color="#FF4757" />
                </TouchableOpacity>

                {/* Brasil todo — busca em todo o país */}
                <TouchableOpacity
                  style={[styles.brasilBtn, radius >= 5000000 && styles.brasilBtnActive]}
                  activeOpacity={0.85}
                  onPress={() => { setCustomRadius(''); setRadius(5000000); }}
                >
                  <Ionicons name="globe-outline" size={16} color={radius >= 5000000 ? '#FFF' : '#FF4757'} />
                  <Text style={[styles.brasilBtnText, radius >= 5000000 && styles.brasilBtnTextActive]}>Brasil todo</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.radiusPresetsRow}>
              {[1, 5, 10, 30, 50].map((km) => {
                const active = radius === km * 1000;
                return (
                  <TouchableOpacity
                    key={km}
                    style={[styles.radiusPreset, active && styles.radiusPresetActive]}
                    onPress={() => { setCustomRadius(''); setRadius(km * 1000); }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[styles.radiusPresetText, active && styles.radiusPresetTextActive]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {km} km
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Espécie — todos os itens em uma única linha */}
            <Text style={styles.filterSectionLabel}>Espécie</Text>
            <View style={styles.filterSpeciesRow}>
              {([
                { key: null, label: 'Todas' },
                { key: 'cachorro', label: 'Cachorro' },
                { key: 'gato', label: 'Gato' },
                { key: 'passaro', label: 'Pássaro' },
                { key: 'outro', label: 'Outro' },
              ] as { key: 'cachorro' | 'gato' | 'passaro' | 'outro' | null; label: string }[]).map((opt) => {
                const active = speciesFilter === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.filterSpeciesPill, active && styles.filterPillSelected]}
                    onPress={() => setSpeciesFilter(opt.key)}
                  >
                    <Text
                      style={[styles.filterSpeciesText, active && styles.filterPillTextSelected]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Cor */}
            <Text style={styles.filterSectionLabel}>Cor</Text>
            <View style={styles.filterColorWrap}>
              <Ionicons name="color-palette-outline" size={20} color="#A4B0BE" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.filterCustomInput}
                placeholder="Ex: caramelo, preto, branco..."
                placeholderTextColor="#A4B0BE"
                value={colorFilter}
                onChangeText={setColorFilter}
                autoCapitalize="none"
              />
              {colorFilter !== '' && (
                <TouchableOpacity onPress={() => setColorFilter('')}>
                  <Ionicons name="close-circle" size={20} color="#A4B0BE" />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.filterApplyBtn}
              onPress={() => { setCustomRadius(''); setShowFilter(false); }}
            >
              <Text style={styles.filterApplyText}>
                {isLoadingPets
                  ? 'Buscando...'
                  : (() => {
                      const total = typeCounts.lost + typeCounts.sighted + typeCounts.rescued;
                      return total === 0
                        ? 'Nenhum pet encontrado'
                        : `Ver ${total} ${total === 1 ? 'pet' : 'pets'}`;
                    })()}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report Modal — escolha do motivo da denúncia */}
      <Modal
        visible={!!reportTarget}
        transparent
        animationType="slide"
        onRequestClose={() => !reportSubmitting && setReportTarget(null)}
      >
        <View style={styles.reportOverlay}>
          <View style={styles.reportSheet}>
            <View style={styles.reportHeader}>
              <Text style={styles.reportTitle}>Denunciar alerta</Text>
              <TouchableOpacity onPress={() => setReportTarget(null)} disabled={reportSubmitting}>
                <Ionicons name="close" size={24} color="#2F3542" />
              </TouchableOpacity>
            </View>
            <Text style={styles.reportSubtitle}>
              Por que você está denunciando {reportTarget ? `o alerta de ${reportTarget.name}` : 'este alerta'}?
            </Text>
            {PET_REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={styles.reportOption}
                onPress={() => submitReport(reason)}
                disabled={reportSubmitting}
                activeOpacity={0.7}
              >
                <Text style={styles.reportOptionText}>{reason}</Text>
                <Ionicons name="chevron-forward" size={18} color="#A4B0BE" />
              </TouchableOpacity>
            ))}
            {reportSubmitting && <ActivityIndicator color="#FF4757" style={{ marginTop: 14 }} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============================================================================
// PetLabelCapture — box de 1 clique do pet, capturado como PNG (vira a imagem
// de um Marker ancorado acima da foto). Tudo síncrono (sem endereço, que foi
// para o box de detalhes), então o PNG renderiza de uma vez.
// ============================================================================
function PetLabelCapture({
  pet, nSight, distance, onCaptured,
}: {
  pet: PetSighting;
  nSight: number;
  distance: number | null;
  onCaptured: (uri: string) => void;
}) {
  const shotRef = useRef<ViewShot>(null);
  const done = useRef(false);
  // onCaptured é um arrow inline (nova referência a cada render do pai). Guardo em
  // ref e disparo a captura UMA vez na montagem — senão cada re-render do pai
  // cancelava a captura em andamento e o box não aparecia no 1º clique.
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;

  useEffect(() => {
    if (done.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await new Promise((r) => setTimeout(r, 180));
      if (cancelled || done.current) return;
      try {
        const uri = await shotRef.current?.capture?.();
        if (uri && !cancelled) { done.current = true; onCapturedRef.current(uri); }
      } catch (e) { /* ignora */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const petType = pet.type ?? 'lost';
  const isRescued = petType === 'rescued';
  const isDonation = petType === 'donation';
  // Resgatado: título só com specs (sem nome). Doação tem cadastro completo (mostra nome).
  // Ambos escondem a linha de avistamentos.
  const specOnly = isRescued;
  const hideSightings = isRescued || isDonation;
  const typeColor = ringColorForPet(pet);
  const statusLabel = petType === 'sighted' ? 'PET VISTO' : petType === 'rescued' ? 'PET RESGATADO' : petType === 'donation' ? 'PET DOANDO' : 'PET PERDIDO';
  const specs = [pet.breed?.trim(), sizeLabel(pet.size), sexLabel(pet.sex), ageLabel(pet.age_group)].filter(Boolean).join(' · ');
  // Resgatado/doação: sem nome — destaca espécie · sexo · cor · porte (nessa ordem).
  const rescuedSpecs = [speciesLabel(pet.species), sexLabel(pet.sex), pet.color?.trim(), sizeLabel(pet.size)].filter(Boolean).join(' · ');
  const dateTimeTxt = pet.lost_date
    ? new Date(pet.lost_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const elapsed = (() => {
    if (!pet.lost_date) return null;
    const ms = Date.now() - new Date(pet.lost_date).getTime();
    if (ms < 60000) return 'agora mesmo';
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    if (days >= 1) return `há ${days} dia${days > 1 ? 's' : ''}`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours >= 1) {
      return mins > 0
        ? `há ${hours} hora${hours > 1 ? 's' : ''} e ${mins} min`
        : `há ${hours} hora${hours > 1 ? 's' : ''}`;
    }
    return `há ${mins} min`;
  })();
  const distTxt = typeof distance === 'number'
    ? `${formatDistance(distance)} de você`
    : null;
  const txt = { flex: 1, fontSize: 12, color: '#747D8C', fontWeight: '600' as const, marginLeft: 6 };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 4 };

  return (
    <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
      <View collapsable={false} style={{ width: 250, alignItems: 'center', backgroundColor: 'transparent' }}>
        <View collapsable={false} style={{ width: 250, backgroundColor: '#FFF', borderRadius: 15, paddingHorizontal: 11, paddingVertical: 10, borderWidth: 1, borderColor: '#E3E8EC' }}>
          {/* Cabeçalho: badge + tempo perdido ao lado */}
          <View collapsable={false} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: typeColor, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 6 }}>
              <View collapsable={false} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff' }} />
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.3, marginLeft: 4 }}>{statusLabel}</Text>
            </View>
            {!!elapsed && <Text style={{ flex: 1, fontSize: 11, color: typeColor, fontWeight: '800', marginLeft: 7 }} numberOfLines={1}>{elapsed}</Text>}
          </View>

          {/* Título: resgatado mostra espécie·porte·cor (sem nome); demais mostram nome + specs */}
          {specOnly ? (
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#2F3542', letterSpacing: -0.2, marginTop: 7 }} numberOfLines={2}>{rescuedSpecs || 'Pet resgatado'}</Text>
          ) : (<>
            <Text style={{ fontSize: 15.5, fontWeight: '900', color: '#2F3542', letterSpacing: -0.3, marginTop: 7 }} numberOfLines={1}>{pet.name}</Text>
            {!!specs && <Text style={{ fontSize: 11.5, color: '#747D8C', fontWeight: '600', marginTop: 1 }} numberOfLines={1}>{specs}</Text>}
          </>)}

          <View collapsable={false} style={{ height: 1, backgroundColor: '#EEF1F4', marginTop: 8 }} />

          {/* Data e hora */}
          {!!dateTimeTxt && (
            <View collapsable={false} style={{ ...row, marginTop: 7 }}>
              <Ionicons name="calendar-outline" size={12} color="#A4B0BE" />
              <Text style={txt} numberOfLines={1}>{dateTimeTxt}</Text>
            </View>
          )}
          {/* Avistamentos — não exibido para resgatado/doação */}
          {!hideSightings && (
          <View collapsable={false} style={row}>
            <Ionicons name="eye-outline" size={12} color="#A4B0BE" />
            <Text style={txt} numberOfLines={1}>{nSight === 0 ? 'Nenhum avistamento ainda' : `${nSight} avistamento${nSight > 1 ? 's' : ''} confirmado${nSight > 1 ? 's' : ''}`}</Text>
          </View>
          )}
          {/* Distância */}
          {!!distTxt && (
            <View collapsable={false} style={row}>
              <Ionicons name="navigate-outline" size={12} color="#A4B0BE" />
              <Text style={txt} numberOfLines={1}>{distTxt}</Text>
            </View>
          )}

          <View collapsable={false} style={{ height: 1, backgroundColor: '#EEF1F4', marginTop: 8 }} />

          {/* Toque para ver detalhes */}
          <View collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 7 }}>
            <Ionicons name="ellipsis-horizontal" size={16} color={typeColor} />
            <Text style={{ fontSize: 11, color: typeColor, fontWeight: '800', marginLeft: 5 }}>Toque para ver detalhes</Text>
          </View>
        </View>
        {/* Setinha apontando para a foto */}
        <View collapsable={false} style={{ width: 0, height: 0, borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 11, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFF' }} />
        {/* Espaçador transparente: ergue o box acima da foto grande do pet
            (raio ≈ 42px) em vez de ficar sobre ela. */}
        <View collapsable={false} style={{ width: 1, height: 42 }} />
      </View>
    </ViewShot>
  );
}

// ============================================================================
// SightingMarkerCapture — bolinha com a foto do avistamento (anel roxo + nº),
// capturada como PNG (mesma técnica dos markers de pet).
// ============================================================================
function SightingMarkerCapture({
  id, photo, index, onCaptured,
}: {
  id: string;
  photo: string;
  index: number;
  onCaptured: (id: string, uri: string) => void;
}) {
  const shotRef = useRef<ViewShot>(null);
  const done = useRef(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (!imgLoaded || done.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await new Promise((r) => setTimeout(r, 130));
      if (cancelled || done.current) return;
      try {
        const uri = await shotRef.current?.capture?.();
        if (uri && !cancelled) { done.current = true; onCaptured(id, uri); }
      } catch (e) { /* ignora */ }
    })();
    return () => { cancelled = true; };
  }, [imgLoaded, id, onCaptured]);

  return (
    <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
      <View collapsable={false} style={{ width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }}>
        <View collapsable={false} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFC312', padding: 3, justifyContent: 'center', alignItems: 'center' }}>
          <View collapsable={false} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
            <Image source={{ uri: photo }} style={{ width: 36, height: 36, borderRadius: 18 }} resizeMode="cover" onLoad={() => setImgLoaded(true)} onError={() => setImgLoaded(true)} />
          </View>
        </View>
        <View collapsable={false} style={{ position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9, backgroundColor: '#F79F1F', borderWidth: 2, borderColor: '#FFF', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '900' }}>{index}</Text>
        </View>
      </View>
    </ViewShot>
  );
}

// ============================================================================
// MarkerCapture — renderiza o design do marker (foto circular + borda) numa
// área oculta e captura como PNG via view-shot. O PNG vira ícone nativo do
// Marker, contornando o bug do <Image> dentro de <Marker> no New Architecture.
// ============================================================================
function MarkerCapture({
  pet, variant, onCaptured,
}: {
  pet: PetSighting;
  variant: 'small' | 'large';
  onCaptured: (id: string, variant: 'small' | 'large', uri: string) => void;
}) {
  const shotRef = useRef<ViewShot>(null);
  const done = useRef(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const S = MARKER_SIZES[variant];

  // Captura só depois que a foto carregou E foi efetivamente composta na tela.
  // Esperar 2 frames + folga evita a corrida em que o view-shot fotografa o
  // marcador antes da imagem pintar (resultando no círculo vermelho sozinho).
  useEffect(() => {
    if (!imgLoaded || done.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );
      await new Promise((r) => setTimeout(r, 150));
      if (cancelled || done.current) return;
      try {
        const uri = await shotRef.current?.capture?.();
        if (uri && !cancelled) {
          done.current = true;
          onCaptured(pet.id, variant, uri);
        }
      } catch (e) {
        console.warn('[marker capture] falhou', pet.id, e);
      }
    })();
    return () => { cancelled = true; };
  }, [imgLoaded, pet.id, variant, onCaptured]);

  const hasReward = !!pet.reward && pet.reward.amount > 0;

  return (
    <ViewShot
      ref={shotRef}
      options={{ format: 'png', quality: 1, result: 'tmpfile' }}
    >
      <View
        collapsable={false}
        style={{ width: S.wrap, height: S.wrap, justifyContent: 'center', alignItems: 'center' }}
      >
        {/* Anel colorido por tipo (perdido=vermelho, visto=amarelo, resgatado=verde) */}
        <View
          collapsable={false}
          style={{
            width: S.ring, height: S.ring, borderRadius: S.ring / 2,
            backgroundColor: ringColorForPet(pet), padding: 3,
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          {/* Recorte da foto — fundo branco isola a imagem do vermelho do anel */}
          <View
            collapsable={false}
            style={{
              width: S.clip, height: S.clip, borderRadius: S.clip / 2,
              backgroundColor: '#FFFFFF', overflow: 'hidden',
              justifyContent: 'center', alignItems: 'center',
            }}
          >
            <Image
              source={{ uri: pet.photo_url }}
              style={{ width: S.img, height: S.img, borderRadius: S.img / 2 }}
              resizeMode="cover"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(true)}
            />
          </View>
        </View>
        {hasReward && (
          <View
            collapsable={false}
            style={{
              position: 'absolute', top: 2, right: 2,
              width: S.dot, height: S.dot, borderRadius: S.dot / 2,
              backgroundColor: '#2ED573', borderWidth: 2, borderColor: '#FFFFFF',
              justifyContent: 'center', alignItems: 'center',
            }}
          >
            <Ionicons name="cash" size={S.dotIcon} color="#FFF" />
          </View>
        )}
      </View>
    </ViewShot>
  );
}

// ============================================================================
// SearcherIconCapture — captura o ícone do buscador (footsteps) como PNG.
// Renderiza fora da tela e fotografa via view-shot, igual aos markers de pet —
// contorna o bug de view custom dentro de <Marker> (recorte "pizza") no New Arch.
// ============================================================================
function SearcherIconCapture({
  iconKey, color, premium, onCaptured,
}: {
  iconKey: string;
  color: string;
  premium: boolean;
  onCaptured: (key: string, uri: string) => void;
}) {
  const shotRef = useRef<ViewShot>(null);
  const done = useRef(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Captura só depois que a silhueta (PNG) carregou + 2 frames + folga,
  // para o view-shot não fotografar antes da imagem pintar.
  useEffect(() => {
    if (!imgLoaded || done.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );
      await new Promise((r) => setTimeout(r, 150));
      if (cancelled || done.current) return;
      try {
        const uri = await shotRef.current?.capture?.();
        if (uri && !cancelled) {
          done.current = true;
          onCaptured(iconKey, uri);
        }
      } catch (e) {
        console.warn('[searcher icon capture] falhou', iconKey, e);
      }
    })();
    return () => { cancelled = true; };
  }, [imgLoaded, iconKey, onCaptured]);

  // Silhueta do buscador (PNG monocromático) recolorida por `tintColor` com a
  // cor de cada buscador. Âncora do Marker nos pés (0.5, 1).
  return (
    <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
      <View collapsable={false} style={styles.searcherSil}>
        <Image
          source={require('../../assets/images/searcher.png')}
          style={[styles.searcherSilImg, { tintColor: color }]}
          resizeMode="contain"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(true)}
        />
        {premium && (
          <View collapsable={false} style={styles.captureSearcherStar}>
            <Ionicons name="star" size={9} color="#FFF" />
          </View>
        )}
      </View>
    </ViewShot>
  );
}

// ============================================================================
// MeIconCapture — captura o ícone do próprio usuário (walk) como PNG, na cor
// escolhida nas configurações. Mesma proteção de corrida dos demais markers.
// ============================================================================
function MeIconCapture({
  color, onCaptured,
}: {
  color: string;
  onCaptured: (color: string, uri: string) => void;
}) {
  const shotRef = useRef<ViewShot>(null);
  const done = useRef(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (!imgLoaded || done.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );
      await new Promise((r) => setTimeout(r, 150));
      if (cancelled || done.current) return;
      try {
        const uri = await shotRef.current?.capture?.();
        if (uri && !cancelled) {
          done.current = true;
          onCaptured(color, uri);
        }
      } catch (e) {
        console.warn('[me icon capture] falhou', color, e);
      }
    })();
    return () => { cancelled = true; };
  }, [imgLoaded, color, onCaptured]);

  // Mesma silhueta do buscador, recolorida pela cor do usuário e um pouco MAIOR
  // (para diferenciar dos buscadores no mapa).
  return (
    <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
      <View collapsable={false} style={styles.captureMe}>
        <Image
          source={require('../../assets/images/searcher.png')}
          style={[styles.captureMeImg, { tintColor: color }]}
          resizeMode="contain"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(true)}
        />
      </View>
    </ViewShot>
  );
}

// ============================================================================
// ClusterCapture — captura o ícone de um cluster (círculo vermelho + número)
// como PNG via view-shot. Mesma técnica dos demais markers para contornar o
// bug de custom views dentro de <Marker> no New Architecture.
// ============================================================================
function ClusterCapture({
  count, onCaptured,
}: {
  count: number;
  onCaptured: (count: number, uri: string) => void;
}) {
  const shotRef = useRef<ViewShot>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );
      await new Promise((r) => setTimeout(r, 100));
      if (cancelled || done.current) return;
      try {
        const uri = await shotRef.current?.capture?.();
        if (uri && !cancelled) {
          done.current = true;
          onCaptured(count, uri);
        }
      } catch (e) {
        console.warn('[cluster capture] falhou', count, e);
      }
    })();
    return () => { cancelled = true; };
  }, [count, onCaptured]);

  const label = count > 99 ? '99+' : String(count);

  return (
    <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
      <View
        collapsable={false}
        style={{ width: 60, height: 60, justifyContent: 'center', alignItems: 'center' }}
      >
        {/* Anel externo translúcido */}
        <View
          collapsable={false}
          style={{
            position: 'absolute',
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: 'rgba(255,71,87,0.22)',
          }}
        />
        {/* Círculo principal */}
        <View
          collapsable={false}
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: '#FF4757',
            borderWidth: 3, borderColor: '#FFFFFF',
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <Text style={{
            color: '#FFF', fontWeight: '900',
            fontSize: label.length > 2 ? 12 : 16,
          }}>
            {label}
          </Text>
        </View>
      </View>
    </ViewShot>
  );
}

// ============================================================================
// PetDetailsView — modal full-screen com galeria
// ============================================================================
function PetDetailsView({
  pet, loading, galleryIndex, setGalleryIndex, isMine, canReport, onClose, onChat, onMyChats, onRoute, onReport, sightings, onOpenSighting, address, distanceM,
}: {
  pet: any;
  loading: boolean;
  galleryIndex: number;
  setGalleryIndex: (i: number) => void;
  isMine: boolean;
  canReport: boolean;
  onClose: () => void;
  onChat: () => void;
  onMyChats: () => void;
  onRoute: () => void;
  onReport: () => void;
  sightings: { id: string; latitude: number; longitude: number; created_at?: string; photo_url?: string | null; source_pet_id?: string | null; finder_id?: string | null }[];
  onOpenSighting: (s: { id: string; latitude: number; longitude: number; created_at?: string; photo_url?: string | null; source_pet_id?: string | null; finder_id?: string | null }, index: number) => void;
  address: string | null;
  distanceM: number | null;
}) {
  const width = Dimensions.get('window').width;
  const insets = useSafeAreaInsets();
  // Apenas safe area do sistema (barra de gestos/botões do celular)
  const actionBarPaddingBottom = Math.max(insets.bottom, 8) + 8;

  if (loading || !pet) {
    return (
      <View style={detStyles.fullCenter}>
        <ActivityIndicator size="large" color="#FF4757" />
        <Text style={detStyles.loadingText}>Carregando detalhes...</Text>
        <TouchableOpacity onPress={onClose} style={{ marginTop: 20 }}>
          <Text style={detStyles.loadingCancel}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Monta a galeria: foto principal + pet_photos ordenadas
  const extras = (pet.pet_photos ?? [])
    .slice()
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
    .map((p: any) => p.photo_url);
  const gallery: string[] = [pet.main_photo_url, ...extras].filter(Boolean);

  const reward = Array.isArray(pet.rewards)
    ? pet.rewards.find((r: any) => r.status === 'locked' || r.status === 'pending')
    : pet.reward;

  const profile = pet.profiles ?? pet.user ?? {};
  const ownerName = profile.full_name ?? profile.name ?? 'Tutor';
  const ownerPhoto = profile.photo_url;
  const ownerRescues = profile.rescues_count ?? 0;
  const ownerRating = profile.rating ? Number(profile.rating) : null;

  const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
    ativo:      { label: 'Procurando', color: '#FF4757', bg: '#FFE5E9' },
    pausado:    { label: 'Pausado',    color: '#FFA502', bg: '#FFF6E5' },
    encontrado: { label: 'Encontrado', color: '#2ED573', bg: '#E8F8F5' },
    cancelado:  { label: 'Cancelado',  color: '#747D8C', bg: '#F1F2F6' },
    doado:      { label: 'Doado',       color: '#3B82F6', bg: '#EFF6FF' },
  };
  const status = statusMeta[pet.status] ?? statusMeta.ativo;

  // Metadados por tipo (perdido / visto / resgatado / doação)
  const petType = pet.type ?? 'lost';
  const TYPE_META: Record<string, { label: string; color: string; bg: string; verb: string; chat: string }> = {
    lost:     { label: 'Perdido',   color: '#FF4757', bg: '#FFE5E9', verb: 'Perdido',   chat: 'Conversar com tutor' },
    sighted:  { label: 'Visto',     color: '#F79F1F', bg: '#FFF6E5', verb: 'Visto',     chat: 'É o meu pet?' },
    rescued:  { label: 'Resgatado', color: '#20BF6B', bg: '#E8F8F5', verb: 'Resgatado', chat: 'É o meu pet?' },
    donation: { label: 'Doando',    color: '#3B82F6', bg: '#EFF6FF', verb: 'Doação',    chat: 'Tenho interesse' },
  };
  const tm = TYPE_META[petType] ?? TYPE_META.lost;
  // lost/rescued/donation sempre permitem chat; sighted respeita allow_contact.
  const chatAllowed = petType !== 'sighted' || pet.allow_contact !== false;
  // Badge sobre a foto: enquanto o alerta está ativo, mostra o TIPO em destaque
  // (PET PERDIDO / PET VISTO / PET RESGATADO) em vez de "Procurando". Para os
  // demais status (encontrado/cancelado/pausado) mantém o rótulo do status.
  const headBadge = pet.status === 'ativo'
    ? { label: `PET ${tm.label.toUpperCase()}`, color: tm.color, bg: tm.bg }
    : status;

  return (
    <View style={{ flex: 1, backgroundColor: '#F1F2F6' }}>
      {/* Galeria */}
      <View style={{ position: 'relative' }}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setGalleryIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {gallery.map((url, i) => (
            <Image key={i} source={{ uri: url }} style={{ width, height: 360 }} resizeMode="cover" />
          ))}
        </ScrollView>

        {/* Botão fechar */}
        <TouchableOpacity style={detStyles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={22} color="#2F3542" />
        </TouchableOpacity>

        {/* Status badge */}
        <View style={[detStyles.statusBadgeAbs, { backgroundColor: headBadge.bg }]}>
          <View style={[detStyles.statusDot, { backgroundColor: headBadge.color }]} />
          <Text style={[detStyles.statusBadgeText, { color: headBadge.color }]}>{headBadge.label}</Text>
        </View>

        {/* Dots da galeria */}
        {gallery.length > 1 && (
          <View style={detStyles.dotsRow}>
            {gallery.map((_, i) => (
              <View key={i} style={[detStyles.dot, i === galleryIndex && detStyles.dotActive]} />
            ))}
          </View>
        )}

        {/* Contador "1/4" */}
        {gallery.length > 1 && (
          <View style={detStyles.counter}>
            <Ionicons name="images" size={12} color="#FFF" />
            <Text style={detStyles.counterText}>{galleryIndex + 1}/{gallery.length}</Text>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: actionBarPaddingBottom + 80 }}>
        <View style={detStyles.body}>
          {/* Nome */}
          <View style={detStyles.titleRow}>
            <Text style={detStyles.petName}>{pet.name}</Text>
          </View>

          {/* Recompensa garantida (logo abaixo do nome) */}
          {reward && Number(reward.amount) > 0 && (
            <View style={[detStyles.rewardCard, { marginTop: 12, marginBottom: 0 }]}>
              <View style={detStyles.rewardIcon}><Ionicons name="shield-checkmark" size={22} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={detStyles.rewardCardTitle}>Recompensa garantida</Text>
                <Text style={detStyles.rewardCardSub}>O valor está reservado e será pago a quem ajudar a encontrar.</Text>
              </View>
              <Text style={detStyles.rewardCardValue}>{formatBRL(Number(reward.amount))}</Text>
            </View>
          )}

          {/* Informações principais: distância, data/hora, tempo, local */}
          <View style={detStyles.infoCard}>
            {distanceM != null && (
              <View style={detStyles.infoLine}>
                <View style={[detStyles.infoIcon, { backgroundColor: tm.bg }]}><Ionicons name="navigate-outline" size={15} color={tm.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={detStyles.infoLabel}>Distância de você</Text>
                  <Text style={detStyles.infoValue}>{formatDistance(distanceM)}</Text>
                </View>
              </View>
            )}
            {!!pet.lost_date && (
              <View style={detStyles.infoLine}>
                <View style={[detStyles.infoIcon, { backgroundColor: tm.bg }]}><Ionicons name="calendar-outline" size={15} color={tm.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={detStyles.infoLabel}>Data e hora</Text>
                  <Text style={detStyles.infoValue}>{new Date(pet.lost_date).toLocaleString('pt-BR')}</Text>
                </View>
              </View>
            )}
            {!!pet.lost_date && (
              <View style={detStyles.infoLine}>
                <View style={[detStyles.infoIcon, { backgroundColor: tm.bg }]}><Ionicons name="hourglass-outline" size={15} color={tm.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={detStyles.infoLabel}>Tempo {tm.verb === 'Perdido' ? 'perdido' : `desde ${tm.verb.toLowerCase()}`}</Text>
                  <Text style={[detStyles.infoValue, { color: tm.color, fontWeight: '800' }]}>{formatElapsedMask(pet.lost_date)}</Text>
                </View>
              </View>
            )}
            <View style={[detStyles.infoLine, !(petType === 'rescued' && pet.is_with_finder) && detStyles.infoLineLast]}>
              <View style={[detStyles.infoIcon, { backgroundColor: tm.bg }]}><Ionicons name="location-outline" size={15} color={tm.color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={detStyles.infoLabel}>Local aproximado</Text>
                <Text style={detStyles.infoValue} numberOfLines={2}>{address ?? 'Buscando endereço…'}</Text>
              </View>
            </View>
            {petType === 'rescued' && pet.is_with_finder && (
              <View style={[detStyles.infoLine, detStyles.infoLineLast]}>
                <View style={[detStyles.infoIcon, { backgroundColor: '#E8F8F0' }]}><Ionicons name="home-outline" size={15} color="#20BF6B" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={detStyles.infoLabel}>Situação</Text>
                  <Text style={detStyles.infoValue}>Está com quem resgatou</Text>
                </View>
              </View>
            )}
          </View>

          {/* Cards de características */}
          <View style={detStyles.specGrid}>
            {speciesLabel(pet.species) ? <SpecCard icon="paw-outline" label="Espécie" value={speciesLabel(pet.species)!} /> : null}
            {pet.breed ? <SpecCard icon="ribbon-outline" label="Raça" value={pet.breed} /> : null}
            {pet.color ? <SpecCard icon="color-palette-outline" label="Cor" value={pet.color} /> : null}
            {sizeLabel(pet.size) ? <SpecCard icon="resize-outline" label="Porte" value={sizeLabel(pet.size)!} /> : null}
            <SpecCard icon="male-female-outline" label="Sexo" value={sexLabel(pet.sex) ?? 'Não sei'} />
            <SpecCard icon="hourglass-outline" label="Idade" value={ageLabel(pet.age_group) ?? 'Não sei'} />
          </View>

          {/* Descrição */}
          {pet.description ? (
            <View style={detStyles.section}>
              <Text style={detStyles.sectionTitle}>Descrição</Text>
              <Text style={detStyles.sectionBody}>{pet.description}</Text>
            </View>
          ) : null}

          {/* Mais informações */}
          {pet.extra_info ? (
            <View style={detStyles.section}>
              <Text style={detStyles.sectionTitle}>Maiores informações</Text>
              <Text style={detStyles.sectionBody}>{pet.extra_info}</Text>
            </View>
          ) : null}

          {/* Regras para adoção — só para doação */}
          {petType === 'donation' && !!pet.adoption_rules?.trim() && (
            <View style={[detStyles.section, { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#DBEAFE' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Ionicons name="gift" size={16} color="#3B82F6" />
                <Text style={[detStyles.sectionTitle, { color: '#3B82F6', marginBottom: 0 }]}>Regras para adoção</Text>
              </View>
              <Text style={detStyles.sectionBody}>{pet.adoption_rules.trim()}</Text>
            </View>
          )}

          {/* Linha do tempo dos avistamentos confirmados */}
          {sightings.length > 0 && (
            <View style={detStyles.section}>
              <Text style={detStyles.sectionTitle}>
                Avistamentos confirmados ({sightings.length})
              </Text>
              <View style={{ marginTop: 6 }}>
                {sightings.map((s, i) => {
                  const last = i === sightings.length - 1;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={detStyles.tlRow}
                      activeOpacity={0.7}
                      onPress={() => onOpenSighting(s, i + 1)}
                    >
                      {/* Trilho + ponto */}
                      <View style={detStyles.tlRail}>
                        <View style={detStyles.tlDot} />
                        {!last && <View style={detStyles.tlLine} />}
                      </View>
                      {/* Foto */}
                      {s.photo_url
                        ? <Image source={{ uri: s.photo_url }} style={detStyles.tlPhoto} />
                        : <View style={[detStyles.tlPhoto, { backgroundColor: '#FFF7E6', justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="paw" size={18} color="#F79F1F" /></View>}
                      {/* Texto */}
                      <View style={{ flex: 1 }}>
                        <Text style={detStyles.tlTitle}>{sightingTitleByIndex(i + 1)}</Text>
                        {!!s.created_at && (
                          <Text style={detStyles.tlDate}>{new Date(s.created_at).toLocaleString('pt-BR')}</Text>
                        )}
                        {!!s.created_at && (
                          <Text style={detStyles.tlElapsed}>{formatElapsedMask(s.created_at)}</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#C7CDD4" />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Card do Tutor */}
          <View style={detStyles.ownerCard}>
            <Avatar uri={ownerPhoto} size={56} style={detStyles.ownerAvatar} />
            <View style={{ flex: 1 }}>
              <Text style={detStyles.ownerLabel}>Tutor</Text>
              <Text style={detStyles.ownerName}>{ownerName}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                {ownerRescues > 0 && (
                  <View style={detStyles.ownerBadge}>
                    <Ionicons name="trophy" size={11} color="#FFF" />
                    <Text style={detStyles.ownerBadgeText}>{ownerRescues} resgates</Text>
                  </View>
                )}
                {ownerRating != null && ownerRating > 0 && (
                  <View style={[detStyles.ownerBadge, { backgroundColor: '#3498DB' }]}>
                    <Ionicons name="star" size={11} color="#FFF" />
                    <Text style={detStyles.ownerBadgeText}>{ownerRating.toFixed(1)}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Denunciar alerta inapropriado */}
          {!isMine && canReport && (
            <TouchableOpacity style={detStyles.reportLink} onPress={onReport} activeOpacity={0.7}>
              <Ionicons name="flag-outline" size={16} color="#747D8C" />
              <Text style={detStyles.reportLinkText}>Denunciar este alerta</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Barra inferior de ações */}
      <View style={[detStyles.actionBar, { paddingBottom: actionBarPaddingBottom }]}>
        <TouchableOpacity style={detStyles.secondaryAction} onPress={onRoute}>
          <Ionicons name="navigate" size={20} color="#FF4757" />
          <Text style={detStyles.secondaryActionText}>Rota</Text>
        </TouchableOpacity>
        {isMine ? (
          <TouchableOpacity style={[detStyles.primaryAction, { backgroundColor: '#747D8C', shadowColor: '#747D8C' }]} onPress={onMyChats}>
            <Ionicons name="chatbubbles-outline" size={20} color="#FFF" />
            <Text style={detStyles.primaryActionText}>Ver meus chats</Text>
          </TouchableOpacity>
        ) : chatAllowed ? (
          <TouchableOpacity style={detStyles.primaryAction} onPress={onChat}>
            <Ionicons name="chatbubbles" size={20} color="#FFF" />
            <Text style={detStyles.primaryActionText}>{tm.chat}</Text>
          </TouchableOpacity>
        ) : (
          <View style={[detStyles.primaryAction, { backgroundColor: '#CED6E0', shadowOpacity: 0 }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#FFF" />
            <Text style={detStyles.primaryActionText}>Contato indisponível</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function SpecCard({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={detStyles.specCard}>
      <Ionicons name={icon} size={20} color="#FF4757" />
      <Text style={detStyles.specLabel}>{label}</Text>
      <Text style={detStyles.specValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const detStyles = StyleSheet.create({
  fullCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F2F6' },
  loadingText: { marginTop: 14, color: '#2F3542', fontSize: 15, fontWeight: '700' },
  loadingCancel: { color: '#747D8C', fontSize: 14, fontWeight: '600' },
  closeBtn: {
    position: 'absolute', top: 50, left: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  statusBadgeAbs: {
    position: 'absolute', top: 56, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusBadgeText: { fontWeight: '800', fontSize: 12 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
  },
  dotsRow: { position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#FFF', width: 20 },
  counter: {
    position: 'absolute', top: 56, left: 70, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  body: { padding: 20 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  petName: { fontSize: 30, fontWeight: '900', color: '#2F3542', letterSpacing: -0.5, flex: 1 },
  rewardChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2ED573',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  rewardChipText: { color: '#FFF', fontWeight: '900', fontSize: 14 },
  // Cartão de informações principais
  infoCard: { backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#EEF1F4', paddingHorizontal: 12, marginTop: 12, marginBottom: 18 },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F2F4F6' },
  infoLineLast: { borderBottomWidth: 0 },
  infoIcon: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  infoLabel: { fontSize: 10.5, color: '#A4B0BE', fontWeight: '700', letterSpacing: 0.3 },
  infoValue: { fontSize: 13.5, color: '#2F3542', fontWeight: '700', lineHeight: 18 },
  // Card "Recompensa garantida"
  rewardCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E8F8F0',
    borderWidth: 1, borderColor: '#B8ECCF', borderRadius: 16, padding: 14, marginBottom: 18,
  },
  rewardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2ED573', justifyContent: 'center', alignItems: 'center' },
  rewardCardTitle: { fontSize: 14.5, fontWeight: '900', color: '#1E7E47' },
  rewardCardSub: { fontSize: 11.5, color: '#3C9D6A', fontWeight: '600', lineHeight: 15, marginTop: 1 },
  rewardCardValue: { fontSize: 17, fontWeight: '900', color: '#1E7E47' },
  // Linha do tempo de avistamentos
  tlRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tlRail: { width: 16, alignSelf: 'stretch', alignItems: 'center' },
  tlDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#F79F1F', marginTop: 14, borderWidth: 2, borderColor: '#FFE3B3' },
  tlLine: { flex: 1, width: 2, backgroundColor: '#FFE3B3', marginTop: 2 },
  tlPhoto: { width: 46, height: 46, borderRadius: 23, marginVertical: 8, backgroundColor: '#EEF1F4', borderWidth: 2, borderColor: '#FFC312' },
  tlTitle: { fontSize: 14, fontWeight: '800', color: '#2F3542' },
  tlDate: { fontSize: 12, color: '#747D8C', fontWeight: '600', marginTop: 1 },
  tlElapsed: { fontSize: 11.5, color: '#F79F1F', fontWeight: '700', marginTop: 1 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12, marginBottom: 18 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: '#57606F', fontSize: 13, fontWeight: '600' },

  specGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  specCard: {
    flexGrow: 1, flexBasis: '28%', minWidth: 96,
    backgroundColor: '#FFF', borderRadius: 14, padding: 14, alignItems: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 5, elevation: 2,
  },
  specLabel: { fontSize: 11, color: '#747D8C', marginTop: 6, fontWeight: '700', textTransform: 'uppercase' },
  specValue: { fontSize: 14, fontWeight: '800', color: '#2F3542', marginTop: 2 },

  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase', marginBottom: 8 },
  sectionBody: { fontSize: 15, color: '#2F3542', lineHeight: 22, fontWeight: '500' },

  ownerCard: {
    backgroundColor: '#FFF', padding: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  ownerAvatar: { width: 56, height: 56, borderRadius: 28 },
  ownerLabel: { fontSize: 11, color: '#747D8C', fontWeight: '700', textTransform: 'uppercase' },
  ownerName: { fontSize: 16, fontWeight: '800', color: '#2F3542', marginTop: 2 },
  ownerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFD32A', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ownerBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16,
    backgroundColor: '#FFF', flexDirection: 'row', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 8,
  },
  secondaryAction: {
    width: 110, height: 56, borderRadius: 16, backgroundColor: '#FFF0F1',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  secondaryActionText: { color: '#FF4757', fontWeight: '800', fontSize: 14 },
  primaryAction: {
    flex: 1, height: 56, borderRadius: 16, backgroundColor: '#FF4757',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryActionText: { color: '#FFF', fontWeight: '900', fontSize: 15 },

  reportLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 6, paddingVertical: 12,
  },
  reportLinkText: { color: '#747D8C', fontWeight: '700', fontSize: 13 },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F2F6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F1F2F6',
  },
  loadingText: {
    marginTop: 12,
    color: '#747D8C',
    fontSize: 16,
    fontWeight: '500',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  // Área oculta de captura — fora da tela, mas montada (RN ainda pinta)
  hiddenCaptureArea: {
    position: 'absolute',
    left: -9999,
    top: -9999,
  },
  // (o design do marker de pet é capturado com estilos inline em MarkerCapture,
  //  parametrizados por MARKER_SIZES para os tamanhos pequeno/grande)
  header: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  headerLogoWrap: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Brilho branco em camadas atrás do logo. Técnica recomendada p/ RN 0.76+:
  // uma View dedicada atrás do elemento com boxShadow branco em várias camadas
  // (blur/spread crescentes). Fundo transparente — só o halo da sombra aparece.
  headerLogoGlow: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    boxShadow:
      '0px 0px 12px 6px rgba(255,255,255,0.7), 0px 0px 26px 14px rgba(255,255,255,0.55), 0px 0px 46px 26px rgba(255,255,255,0.3)',
  },
  headerLogo: {
    width: 50,
    height: 50,
  },
  headerTitleContainer: {
    marginLeft: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  headerTitleWrap: {
    alignSelf: 'flex-start',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#2F3542',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(255,255,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  // Cópia transparente do texto, só com a sombra branca. Empilhada 2x atrás
  // do texto real para intensificar o glow (RN não permite múltiplos
  // text-shadow numa única camada).
  headerTitleGlowLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    color: 'transparent',
    textShadowColor: 'rgba(255,255,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  headerTitleHighlight: {
    color: '#FF4757',
    textShadowColor: 'rgba(255,255,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  headerSubtitleWrap: {
    alignSelf: 'flex-start',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#57606F',
    fontWeight: '500',
    textShadowColor: 'rgba(255,255,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  // Mesma técnica do nome: cópia transparente só com a sombra branca,
  // empilhada 2x atrás do texto real para intensificar o glow.
  headerSubtitleGlowLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    color: 'transparent',
    textShadowColor: 'rgba(255,255,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  notificationBtn: {
    width: 48,
    height: 48,
    backgroundColor: '#FFF',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 19,
    height: 19,
    borderRadius: 9.5,
    paddingHorizontal: 4,
    backgroundColor: '#FF4757',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10.5,
    fontWeight: '900',
  },
  searchBar: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  // Barra de filtros: linha única com rolagem horizontal (nunca quebra).
  // Legenda = chips brancos flutuantes (sem caixa de fundo, harmoniza com o mapa).
  sosQuickRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10 },
  sosQuickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF', paddingLeft: 12, paddingRight: 14, paddingVertical: 8, borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  sosQuickAdocao: { paddingRight: 8, backgroundColor: '#EFF6FF' },
  sosQuickText: { fontSize: 13, fontWeight: '800', color: '#FF4757' },
  legendBar: { width: '100%', marginTop: 10, alignSelf: 'center', backgroundColor: 'transparent' },
  // Centraliza os chips quando cabem; rola quando passam da largura.
  legendScrollContent: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 2, paddingVertical: 2 },
  legendItem: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingLeft: 9, paddingRight: 6, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#FFF', borderWidth: 1.5, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 7, elevation: 4,
  },
  legendDot: { width: 11, height: 11, borderRadius: 5.5 },
  legendText: { fontSize: 11, fontWeight: '800', color: '#2F3542' },
  legendCount: { minWidth: 18, paddingHorizontal: 4, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  legendCountText: { fontSize: 10, fontWeight: '900', color: '#FFF' },
  adoptCard: { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 14, marginTop: 4, marginBottom: 4, borderWidth: 1, borderColor: '#DBEAFE' },
  adoptHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  adoptTitle: { fontSize: 13, fontWeight: '800', color: '#3B82F6' },
  adoptText: { fontSize: 13.5, color: '#2F3542', lineHeight: 19, fontWeight: '500' },

  sightingAnchor: {
    position: 'absolute',
    backgroundColor: '#FFF', borderRadius: 18, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 14,
  },
  sightingArrowDown: {
    position: 'absolute', bottom: -10, width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 11,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFF',
  },
  sightingArrowUp: {
    position: 'absolute', top: -10, width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderBottomWidth: 11,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FFF',
  },
  sightingDots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  sightingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  sightingDotActive: { backgroundColor: '#FFF', width: 18 },
  sightingDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  sightingDetailText: { flex: 1, fontSize: 13.5, color: '#2F3542', fontWeight: '600', lineHeight: 19 },
  // Box de detalhes do avistamento (redesenho)
  sightingHeroBadge: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F79F1F', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },
  sightingHeroBadgeText: { color: '#fff', fontSize: 11.5, fontWeight: '900', letterSpacing: 0.5 },
  sightingInfoCard: { backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#EEF1F4', paddingHorizontal: 12, paddingVertical: 2, marginBottom: 9 },
  sightingInfoLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F2F4F6' },
  sightingInfoLineLast: { borderBottomWidth: 0 },
  sightingInfoIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFF7E6', justifyContent: 'center', alignItems: 'center' },
  sightingInfoLabel: { fontSize: 10, color: '#A4B0BE', fontWeight: '700', letterSpacing: 0.3 },
  sightingInfoValue: { fontSize: 12.5, color: '#2F3542', fontWeight: '700', lineHeight: 16 },
  sightingDescBox: { backgroundColor: '#FFF7E6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 9 },
  sightingDescTitle: { fontSize: 10, color: '#F79F1F', fontWeight: '900', letterSpacing: 0.4, marginBottom: 3 },
  sightingDescText: { fontSize: 12.5, color: '#5A4B2E', fontWeight: '600', lineHeight: 17 },
  sightingFinderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sightingFinderAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFF7E6', justifyContent: 'center', alignItems: 'center' },
  sightingFinderName: { fontSize: 13.5, color: '#2F3542', fontWeight: '800' },
  sightingClose: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  sightingHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 28 },
  sightingThumb: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F1F2F6', borderWidth: 2, borderColor: '#FFC312' },
  sightingTitle: { fontSize: 16, fontWeight: '900', color: '#2F3542' },
  sightingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 28 },
  sightingTitleDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFC312' },
  sightingInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  sightingInfoText: { flex: 1, fontSize: 12.5, color: '#747D8C', fontWeight: '600' },
  sightingDate: { fontSize: 12, color: '#747D8C', marginTop: 1 },
  sightingDist: { fontSize: 12, color: '#F79F1F', fontWeight: '800', marginTop: 2 },
  sightingActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sightingBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 40, borderRadius: 12, borderWidth: 1, borderColor: '#DFE4EA', backgroundColor: '#FFF' },
  sightingBtnText: { fontSize: 12, fontWeight: '800', color: '#3498DB' },
  sightingBtnRoute: { backgroundColor: '#3498DB', borderColor: '#3498DB' },
  sightingBtnArea: { borderColor: '#F79F1F' },
  sightingBtnAreaActive: { backgroundColor: '#F79F1F', borderColor: '#F79F1F' },
  // Caixa de 1 clique do avistamento — OVERLAY acima do mapa (sempre à frente)
  sightingOverlay: {
    position: 'absolute', backgroundColor: '#FFF', borderRadius: 16, padding: 13,
    borderWidth: 1, borderColor: '#EEF1F4',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 16,
    zIndex: 50,
  },
  sightingOvArrowDown: {
    position: 'absolute', bottom: -10, width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 11,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFF',
  },
  sightingOvArrowUp: {
    position: 'absolute', top: -10, width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderBottomWidth: 11,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FFF',
  },
  sightingOvHead: { flexDirection: 'row', alignItems: 'center' },
  sightingOvBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F79F1F', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  sightingOvBadgeText: { fontSize: 10.5, fontWeight: '900', color: '#fff', letterSpacing: 0.4 },
  sightingOvElapsed: { flex: 1, fontSize: 11.5, color: '#A4B0BE', fontWeight: '700', marginLeft: 8 },
  sightingOvClose: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center', marginLeft: 6 },
  sightingOvDistRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 11 },
  sightingOvDistValue: { fontSize: 19, fontWeight: '900', color: '#2F3542' },
  sightingOvDistLabel: { fontSize: 12.5, color: '#A4B0BE', fontWeight: '700' },
  sightingOvInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 5 },
  sightingOvInfoText: { flex: 1, fontSize: 12.5, color: '#747D8C', fontWeight: '600' },
  sightingOvDivider: { height: 1, backgroundColor: '#EEF1F4', marginTop: 12 },
  sightingOvMoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  sightingOvMoreText: { fontSize: 11.5, color: '#F79F1F', fontWeight: '800' },
  // Endereço aproximado no box de detalhes do pet
  sheetAddressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  sheetAddressText: { flex: 1, fontSize: 13.5, color: '#57606F', fontWeight: '600', lineHeight: 19 },
  searchPlaceholder: {
    flex: 1,
    marginLeft: 12,
    color: '#747D8C',
    fontSize: 15,
    fontWeight: '500',
  },
  fabLocation: {
    position: 'absolute',
    bottom: 138,
    right: 20,
    width: 50,
    height: 50,
    backgroundColor: '#FFF',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
  },
  fabLocationActive: {
    backgroundColor: '#FF4757',
    shadowColor: '#FF4757',
    shadowOpacity: 0.4,
  },
  fab3D: {
    position: 'absolute',
    bottom: 262,
    right: 20,
    width: 50,
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  fab3DActive: { backgroundColor: '#FF4757' },
  fab3DText: { fontSize: 10, fontWeight: '800', color: '#2F3542' },
  fabMapType: {
    position: 'absolute',
    bottom: 200,
    right: 20,
    width: 50,
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  fabMapTypeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#747D8C',
  },
  fabCancelRadius: {
    position: 'absolute',
    bottom: 198,
    left: 20,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1.5,
    borderColor: 'rgba(15,185,177,0.85)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 5,
  },
  fabFindPet: {
    position: 'absolute',
    bottom: 138,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FF4757',
    paddingHorizontal: 18,
    height: 50,
    borderRadius: 25,
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  fabFindPetText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 130,
    left: 16,
    right: 16,
    backgroundColor: '#FFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 16,
  },
  // Hero
  sheetHero: {
    overflow: 'hidden',
  },
  sheetHeroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 110,
  },
  sheetIndicatorWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 36,          // área de toque generosa
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetIndicatorPill: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  heroPhotoCounter: { position: 'absolute', top: 42, left: 0, right: 0, alignItems: 'center' },
  heroPhotoCounterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 11,
  },
  heroPhotoCounterText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  sheetCloseBtnTop: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  sheetHeroInfo: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetHeroName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFF',
    flex: 1,
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  sheetHeroReward: {
    alignItems: 'center',
    backgroundColor: '#2ED573',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 10,
    marginLeft: 8,
    shadowColor: '#2ED573',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  sheetHeroRewardLabel: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 8.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    opacity: 0.95,
  },
  sheetHeroRewardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  sheetHeroRewardText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 13,
  },
  // Corpo
  sheetBody: {
    padding: 14,
  },
  sheetMetaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  sheetMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFE5E9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  sheetMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF4757',
  },
  sheetOwnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetOwnerText: {
    marginLeft: 6,
    fontSize: 13,
    color: '#747D8C',
    fontWeight: '600',
    flex: 1,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  sheetActionIcon: {
    width: 58,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FFF0F1',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  sheetActionIconText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF4757',
  },
  sheetActionPrimary: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FF4757',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  sheetActionPrimaryText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: {
    backgroundColor: '#F1F2F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: { fontSize: 12, color: '#2F3542', fontWeight: '600' },

  // Denúncia de alerta
  reportLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 8, paddingVertical: 6,
  },
  reportLinkText: { color: '#747D8C', fontWeight: '700', fontSize: 13 },
  reportOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  reportSheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reportTitle: { fontSize: 20, fontWeight: '900', color: '#2F3542' },
  reportSubtitle: { fontSize: 14, color: '#747D8C', fontWeight: '500', marginTop: 6, marginBottom: 12 },
  reportOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F2F6',
  },
  reportOptionText: { fontSize: 15, color: '#2F3542', fontWeight: '600', flex: 1 },

  radiusSection: {
    marginTop: 4,
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F2F6',
  },
  radiusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 9,
  },
  radiusTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2F3542',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  radiusClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  radiusClearText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#747D8C',
  },
  radiusChipsRow: {
    flexDirection: 'row',
    gap: 7,
    paddingRight: 2,
  },
  radiusChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: '#F1F2F6',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  radiusChipActive: {
    backgroundColor: '#E4FBF7',
    borderColor: '#0FB9B1',
  },
  radiusChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#747D8C',
  },
  radiusChipTextActive: {
    color: '#0B8C84',
  },
  rescuesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD32A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 8,
    gap: 3,
  },
  rescuesBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  detailRow: { fontSize: 14, color: '#2F3542', marginBottom: 6, lineHeight: 22 },
  detailLabel: { fontWeight: '800', color: '#2F3542' },
  detailsFullText: {
    fontSize: 16,
    color: '#2F3542',
    lineHeight: 24,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    marginTop: 140, // logo abaixo do box de filtro (header top:50 + headerTop ~52 + searchBar)
    marginHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2F3542',
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F2F6',
  },
  filterOptionSelected: {
    backgroundColor: '#FFF0F1',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0,
  },
  filterOptionText: {
    fontSize: 16,
    color: '#57606F',
  },
  filterOptionTextSelected: {
    color: '#FF4757',
    fontWeight: 'bold',
  },
  filterSectionLabel: {
    fontSize: 12, fontWeight: '800', color: '#747D8C',
    textTransform: 'uppercase', marginTop: 10, marginBottom: 10,
  },
  filterPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#F1F2F6', borderWidth: 1, borderColor: 'transparent',
  },
  filterPillSelected: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  filterPillText: { color: '#2F3542', fontWeight: '700', fontSize: 14 },
  filterPillTextSelected: { color: '#FFF' },
  // Raio: título, stepper (ajuste fino, alinhado à esquerda) e atalhos abaixo.
  radiusStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6, marginBottom: 10 },
  radiusStepBtn: {
    width: 36, height: 40, borderRadius: 11, backgroundColor: '#FFF0F1',
    justifyContent: 'center', alignItems: 'center',
  },
  radiusValueWrap: {
    minWidth: 66, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    height: 40, borderRadius: 11, backgroundColor: '#F1F2F6',
  },
  radiusValueInput: { fontSize: 18, fontWeight: '900', color: '#2F3542', minWidth: 22, padding: 0 },
  radiusValueUnit: { fontSize: 12.5, fontWeight: '800', color: '#747D8C' },
  brasilBtn: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 40, paddingHorizontal: 12, borderRadius: 11,
    backgroundColor: '#FFF0F1', borderWidth: 1, borderColor: '#FFD6DB',
  },
  brasilBtnActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  brasilBtnText: { fontSize: 12.5, fontWeight: '800', color: '#FF4757' },
  brasilBtnTextActive: { color: '#FFF' },
  // Atalhos em linha cheia, pills de largura igual (sem scroll).
  radiusPresetsRow: { flexDirection: 'row', gap: 7 },
  radiusPreset: {
    flex: 1, height: 44, borderRadius: 12, paddingHorizontal: 4,
    backgroundColor: '#F1F2F6', borderWidth: 1, borderColor: 'transparent',
    justifyContent: 'center', alignItems: 'center',
  },
  radiusPresetActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  radiusPresetText: { fontSize: 14, fontWeight: '800', color: '#2F3542' },
  radiusPresetTextActive: { color: '#FFF' },
  filterColorWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F1F2F6', borderRadius: 12, paddingHorizontal: 14, height: 48,
  },
  // Espécie em uma única linha (colunas iguais)
  filterSpeciesRow: { flexDirection: 'row', gap: 6 },
  filterSpeciesPill: {
    flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 11,
    backgroundColor: '#F1F2F6', borderWidth: 1, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  filterSpeciesText: { color: '#2F3542', fontWeight: '700', fontSize: 12.5, textAlign: 'center' },
  filterApplyBtn: {
    marginTop: 20, height: 52, borderRadius: 14, backgroundColor: '#FF4757',
    justifyContent: 'center', alignItems: 'center',
  },
  filterApplyText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  filterCountRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  statusCount: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, height: 28, borderRadius: 14,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusCountText: { fontSize: 12.5, fontWeight: '800' },
  filterCustomRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  filterCustomInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F1F2F6', borderRadius: 12, paddingHorizontal: 14, height: 48,
  },
  filterCustomInput: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '700' },
  filterCustomUnit: { color: '#747D8C', fontWeight: '700' },
  filterCustomBtn: {
    paddingHorizontal: 18, height: 48, borderRadius: 12,
    backgroundColor: '#FF4757', justifyContent: 'center',
  },
  filterCustomBtnText: { color: '#FFF', fontWeight: '800' },
  filterBrasilBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    paddingHorizontal: 16, height: 56, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FFE5E9', backgroundColor: '#FFF',
    justifyContent: 'center',
  },
  filterBrasilBtnActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  filterBrasilText: { color: '#FF4757', fontWeight: '800', fontSize: 15 },

  // Buscadores (presence) — silhueta recolorida por tintColor (PNG via ViewShot)
  searcherSil: {
    width: 42,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  searcherSilImg: {
    width: 40,
    height: 40,
  },
  captureSearcherStar: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFA502',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Minha posição — ícone capturado como PNG (indexado pela cor do pin)
  captureMe: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Silhueta do próprio usuário — um pouco maior que a do buscador (40) para diferenciar
  captureMeImg: {
    width: 48,
    height: 48,
  },
  // Barra de info da rota traçada no mapa (distância + tempo)
  routeInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EBF5FB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  routeInfoText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#3498DB',
  },
});

