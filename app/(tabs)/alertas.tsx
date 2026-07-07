import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, FlatList, TouchableOpacity, TextInput,
  Image, ActivityIndicator, ScrollView, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { fetchNearbyPets, getUserSettings, PetSighting, PetType, PetSpecies } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { showActionSheet, toast } from '../../components/Feedback';
import { CollapsibleFilters } from '../../components/CollapsibleFilters';
import { formatDistance } from '../../utils/formatDistance';
import { colorMatches } from '../../utils/colorMatch';
import { requestMapFocus } from '../../utils/mapFocus';

const TYPE_META: Record<PetType, { label: string; color: string; bg: string }> = {
  lost: { label: 'Perdido', color: '#FF4757', bg: '#FFE5E9' },
  sighted: { label: 'Visto', color: '#F79F1F', bg: '#FFF6E5' },
  rescued: { label: 'Resgatado', color: '#20BF6B', bg: '#E8F8F5' },
  donation: { label: 'Doando', color: '#3B82F6', bg: '#EFF6FF' },
};
// Doação tem área própria (aba Doação) — não aparece nesta lista do mapa SOS.
const TYPE_TABS: { value: PetType; label: string }[] = [
  { value: 'lost', label: 'Perdidos' },
  { value: 'sighted', label: 'Vistos' },
  { value: 'rescued', label: 'Resgatados' },
];
const SPECIES_FILTERS: { value: PetSpecies | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'cachorro', label: 'Cachorro' },
  { value: 'gato', label: 'Gato' },
  { value: 'passaro', label: 'Pássaro' },
  { value: 'outro', label: 'Outro' },
];
const RADIUS_OPTIONS = [1000, 5000, 10000, 25000, 50000];

const formatBRL = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const speciesLabel = (s?: string | null) =>
  s === 'cachorro' ? 'Cachorro' : s === 'gato' ? 'Gato' : s === 'passaro' ? 'Pássaro' : s === 'outro' ? 'Outro' : null;
const sizeLabel = (s?: string | null) =>
  s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : null;

export default function AlertasScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pets, setPets] = useState<PetSighting[]>([]);
  const [loading, setLoading] = useState(false);
  const [radius, setRadius] = useState(5000);
  const [locationDenied, setLocationDenied] = useState(false);

  const [activeTab, setActiveTab] = useState<PetType>('lost');
  const [speciesFilter, setSpeciesFilter] = useState<PetSpecies | 'all'>('all');
  const [breedText, setBreedText] = useState('');
  const [colorText, setColorText] = useState('');

  // Busca por CEP/endereço (sobrepõe o GPS como centro da busca)
  const [searchCenter, setSearchCenter] = useState<{ latitude: number; longitude: number; label?: string } | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [searchingAddress, setSearchingAddress] = useState(false);

  // Endereço aproximado de cada pet (reverse-geocode, cacheado por id)
  const [petAddresses, setPetAddresses] = useState<Record<string, string>>({});
  const addrCacheRef = useRef<Record<string, string>>({});

  // Localização + raio padrão das configurações
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationDenied(true); return; }
      setLocationDenied(false);
      // 1) Última posição conhecida (instantânea) → já dispara a 1ª busca rápido.
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last) setLocation({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      } catch {}
      // 2) Posição atual (mais precisa) → refina em seguida.
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {}
    })();
    if (user) {
      getUserSettings(user.id)
        .then((s) => { if (s?.default_search_radius_m) setRadius(Number(s.default_search_radius_m)); })
        .catch(() => {});
    }
  }, [user]);

  const load = useCallback(async () => {
    const center = searchCenter ?? location;
    if (!center) return;
    setLoading(true);
    try {
      const data = await fetchNearbyPets(center.latitude, center.longitude, radius);
      setPets(data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, [location, radius, searchCenter]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Busca por CEP (ViaCEP) ou endereço (geocoding): define o centro da busca
  // para listar pets ao redor daquele ponto.
  const handleSearchAddress = async () => {
    const raw = addressQuery.trim();
    if (!raw || searchingAddress) return;
    setSearchingAddress(true);
    try {
      Keyboard.dismiss();
      let query = raw;
      let label = raw;
      const digits = raw.replace(/\D/g, '');
      if (/^\d{8}$/.test(digits)) {
        const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const data = await resp.json().catch(() => null);
        if (data && !data.erro) {
          query = [data.logradouro, data.bairro, data.localidade, data.uf, 'Brasil'].filter(Boolean).join(', ');
          label = [data.logradouro || data.bairro, data.localidade].filter(Boolean).join(', ') || raw;
        } else {
          toast.error('CEP não encontrado. Tente o endereço.', 'CEP inválido');
          setSearchingAddress(false);
          return;
        }
      }
      const results = await Location.geocodeAsync(query);
      if (results && results.length > 0) {
        const { latitude, longitude } = results[0];
        setSearchCenter({ latitude, longitude, label });
      } else {
        toast.error('Não localizamos esse endereço. Tente ser mais específico.', 'Endereço não encontrado');
      }
    } catch {
      toast.error('Falha ao buscar o endereço. Verifique sua conexão.', 'Erro na busca');
    } finally {
      setSearchingAddress(false);
    }
  };

  // Reverse-geocode dos pets carregados → endereço no card. Cache por id para
  // não refazer ao mudar de aba/filtro. Pequeno respiro entre chamadas.
  useEffect(() => {
    if (!pets.length) return;
    let cancelled = false;
    (async () => {
      for (const p of pets) {
        if (cancelled) break;
        if (addrCacheRef.current[p.id]) continue;
        try {
          const res = await Location.reverseGeocodeAsync({ latitude: Number(p.latitude), longitude: Number(p.longitude) });
          if (cancelled) break;
          const a = res?.[0];
          if (a) {
            const bairro = a.district ?? null;
            const cidade = a.city ?? (a.subregion !== bairro ? a.subregion : null);
            const parts = [a.street, bairro, cidade].filter(Boolean) as string[];
            // remove duplicatas consecutivas (street == district às vezes)
            const dedup = parts.filter((x, i) => x !== parts[i - 1]);
            const text = dedup.slice(0, 3).join(', ');
            if (text) {
              addrCacheRef.current[p.id] = text;
              setPetAddresses((prev) => ({ ...prev, [p.id]: text }));
            }
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 60));
      }
    })();
    return () => { cancelled = true; };
  }, [pets]);

  // Aplica filtros (espécie/raça/cor) e separa por tipo, com contadores por aba.
  const { counts, list } = useMemo(() => {
    const b = breedText.trim().toLowerCase();
    const base = pets.filter((p) => {
      if (speciesFilter !== 'all' && (p.species ?? null) !== speciesFilter) return false;
      if (b && !(p.breed ?? '').toLowerCase().includes(b)) return false;
      if (!colorMatches(p.color, colorText)) return false;
      return true;
    });
    const counts: Record<PetType, number> = { lost: 0, sighted: 0, rescued: 0, donation: 0 };
    base.forEach((p) => { counts[(p.type ?? 'lost') as PetType]++; });
    let list = base.filter((p) => (p.type ?? 'lost') === activeTab);
    // Perdidos: prioriza quem tem recompensa, depois maior valor, depois mais perto.
    if (activeTab === 'lost') {
      list = [...list].sort((a, b) => {
        const ra = a.reward?.amount ?? 0;
        const rb = b.reward?.amount ?? 0;
        if ((rb > 0 ? 1 : 0) !== (ra > 0 ? 1 : 0)) return (rb > 0 ? 1 : 0) - (ra > 0 ? 1 : 0);
        if (rb !== ra) return rb - ra;
        return a.distance - b.distance;
      });
    }
    return { counts, list };
  }, [pets, speciesFilter, breedText, colorText, activeTab]);

  const openItem = (pet: PetSighting) => {
    showActionSheet({
      title: pet.name,
      message: 'O que deseja fazer?',
      icon: 'paw',
      options: [
        { label: 'Ver detalhes', icon: 'information-circle-outline', primary: true, onPress: () => { requestMapFocus(pet.id, true, radius); router.navigate('/(tabs)'); } },
        { label: 'Ver no mapa', icon: 'map-outline', onPress: () => { requestMapFocus(pet.id, false, radius); router.navigate('/(tabs)'); } },
      ],
    });
  };

  const renderItem = ({ item }: { item: PetSighting }) => {
    const tm = TYPE_META[item.type ?? 'lost'] ?? TYPE_META.lost;
    const tags = [speciesLabel(item.species), item.breed, item.color, sizeLabel(item.size)].filter(Boolean) as string[];
    return (
      <TouchableOpacity style={[styles.card, { borderLeftWidth: 5, borderLeftColor: tm.color }]} activeOpacity={0.85} onPress={() => openItem(item)}>
        <View style={styles.cardTop}>
          <Image source={{ uri: item.photo_url }} style={styles.cardPhoto} />
          <View style={{ flex: 1 }}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <View style={[styles.typeChip, { backgroundColor: tm.bg }]}>
                <View style={[styles.typeDot, { backgroundColor: tm.color }]} />
                <Text style={[styles.typeChipText, { color: tm.color }]}>{tm.label}</Text>
              </View>
            </View>
            {tags.length > 0 && <Text style={styles.cardTags} numberOfLines={1}>{tags.join(' · ')}</Text>}
            <View style={styles.cardMetaRow}>
              {(item.reward?.amount ?? 0) > 0 && (
                <View style={styles.rewardChip}>
                  <Ionicons name="gift" size={11} color="#FFF" />
                  <Text style={styles.rewardChipText}>{formatBRL(item.reward!.amount)}</Text>
                </View>
              )}
              <Ionicons name="location" size={12} color="#FF4757" />
              <Text style={styles.cardMeta}>{formatDistance(item.distance)}</Text>
              {item.lost_date && (
                <>
                  <Ionicons name="time-outline" size={12} color="#A4B0BE" style={{ marginLeft: 8 }} />
                  <Text style={styles.cardMeta}>{formatDistanceToNow(new Date(item.lost_date), { locale: ptBR })}</Text>
                </>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#A4B0BE" />
        </View>
        {petAddresses[item.id] && (
          <>
            <View style={styles.cardDivider} />
            <View style={styles.cardAddrRow}>
              <Ionicons name="navigate-outline" size={12} color="#A4B0BE" />
              <Text style={styles.cardAddr} numberOfLines={1}>{petAddresses[item.id]}</Text>
            </View>
          </>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>Alertas</Text>
        <Text style={styles.headerSub}>Pets na sua região</Text>
      </LinearGradient>

      {/* Filtros recolhíveis */}
      <CollapsibleFilters accentColor="#FF4757">
        <Text style={styles.filterLabel}>Espécie</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {SPECIES_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[styles.chip, speciesFilter === f.value && styles.chipActive]}
              onPress={() => setSpeciesFilter(f.value)}
            >
              <Text style={[styles.chipText, speciesFilter === f.value && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.filterLabel}>Raça e cor</Text>
        <View style={styles.textFilters}>
          <View style={styles.textInputWrap}>
            <Ionicons name="ribbon-outline" size={16} color="#A4B0BE" />
            <TextInput style={styles.textInput} placeholder="Raça" placeholderTextColor="#A4B0BE" value={breedText} onChangeText={setBreedText} />
          </View>
          <View style={styles.textInputWrap}>
            <Ionicons name="color-palette-outline" size={16} color="#A4B0BE" />
            <TextInput style={styles.textInput} placeholder="Cor" placeholderTextColor="#A4B0BE" value={colorText} onChangeText={setColorText} />
          </View>
        </View>
        {/* Local da busca — CEP ou endereço (sobrepõe o GPS) */}
        <Text style={styles.filterLabel}>Local da busca</Text>
        <View style={styles.textFilters}>
          <View style={styles.textInputWrap}>
            <Ionicons name="search" size={16} color="#A4B0BE" />
            <TextInput
              style={styles.textInput}
              placeholder="CEP ou endereço"
              placeholderTextColor="#A4B0BE"
              value={addressQuery}
              onChangeText={setAddressQuery}
              onSubmitEditing={handleSearchAddress}
              returnKeyType="search"
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={handleSearchAddress}
              disabled={searchingAddress || !addressQuery.trim()}
              style={{ paddingHorizontal: 4 }}
            >
              {searchingAddress
                ? <ActivityIndicator size="small" color="#FF4757" />
                : <Ionicons name="arrow-forward" size={18} color={addressQuery.trim() ? '#FF4757' : '#CED6E0'} />}
            </TouchableOpacity>
          </View>
        </View>
        {searchCenter && (
          <View style={styles.searchActive}>
            <Ionicons name="location" size={13} color="#FF4757" />
            <Text style={styles.searchActiveText} numberOfLines={1}>
              Buscando em {searchCenter.label ?? 'local pesquisado'}
            </Text>
            <TouchableOpacity onPress={() => { setSearchCenter(null); setAddressQuery(''); }} style={styles.searchClearBtn}>
              <Ionicons name="close" size={14} color="#FF4757" />
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.filterLabel}>Raio de busca do seu local atual</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {RADIUS_OPTIONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, radius === r && styles.chipActive]}
              onPress={() => setRadius(r)}
            >
              <Text style={[styles.chipText, radius === r && styles.chipTextActive]}>{r >= 1000 ? `${r / 1000}km` : `${r}m`}</Text>
            </TouchableOpacity>
          ))}
          {/* Brasil todo — busca em todo o país */}
          <TouchableOpacity
            style={[styles.chip, radius >= 5000000 && styles.chipActive]}
            onPress={() => setRadius(5000000)}
          >
            <Text style={[styles.chipText, radius >= 5000000 && styles.chipTextActive]}>Brasil todo</Text>
          </TouchableOpacity>
        </ScrollView>
      </CollapsibleFilters>

      {/* Abas por tipo, com contador */}
      <View style={styles.tabsRow}>
        {TYPE_TABS.map((t) => {
          const tm = TYPE_META[t.value];
          const active = activeTab === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              style={[styles.tab, active && { borderBottomColor: tm.color }]}
              activeOpacity={0.8}
              onPress={() => setActiveTab(t.value)}
            >
              <Text style={[styles.tabText, active && { color: tm.color }]} numberOfLines={1}>
                {t.label}
              </Text>
              <View style={[styles.tabCount, active && { backgroundColor: tm.color }]}>
                <Text style={[styles.tabCountText, active && { color: '#FFF' }]}>{counts[t.value]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {locationDenied ? (
        <View style={styles.empty}>
          <Ionicons name="location-outline" size={48} color="#CED6E0" />
          <Text style={styles.emptyText}>Ative a localização para ver os alertas perto de você.</Text>
        </View>
      ) : (!location || (loading && pets.length === 0)) ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#FF4757" />
          <Text style={styles.emptyText}>
            {!location ? 'Obtendo sua localização...' : 'Buscando alertas na sua região...'}
          </Text>
        </View>
      ) : (
        <>
          {/* Indicador de recarga (troca de filtro/raio/aba com lista já visível) */}
          {loading && (
            <View style={styles.loadingBar}>
              <ActivityIndicator size="small" color="#FF4757" />
              <Text style={styles.loadingBarText}>Buscando alertas...</Text>
            </View>
          )}
          <FlatList
            data={list}
            keyExtractor={(p) => p.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            refreshing={loading}
            onRefresh={load}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Ionicons name="paw-outline" size={48} color="#CED6E0" />
                  <Text style={styles.emptyText}>Nenhum alerta com esses filtros</Text>
                </View>
              )
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingHorizontal: 20, paddingBottom: 18,
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
  },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF', letterSpacing: -0.5 },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 2, fontWeight: '500' },

  tabsRow: {
    flexDirection: 'row', backgroundColor: '#FFF', marginTop: 8,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#ECECEC',
  },
  tab: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
    paddingVertical: 14, borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 14, fontWeight: '800', color: '#747D8C' },
  tabCount: { minWidth: 22, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center' },
  tabCountText: { fontSize: 12, fontWeight: '800', color: '#747D8C' },

  filters: { paddingTop: 10, paddingBottom: 8, gap: 6, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#ECECEC' },
  filterLabel: { fontSize: 11, fontWeight: '800', color: '#A4B0BE', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16, marginTop: 4 },
  chipRow: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#DFE4EA', backgroundColor: '#FFF' },
  chipActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#747D8C' },
  chipTextActive: { color: '#FFF' },
  textFilters: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  textInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F1F2F6', borderRadius: 12, paddingHorizontal: 12, height: 40,
  },
  textInput: { flex: 1, fontSize: 14, color: '#2F3542' },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 16, padding: 12, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardDivider: { height: 1, backgroundColor: '#EAEDF0', marginTop: 10 },
  cardPhoto: { width: 60, height: 60, borderRadius: 12, backgroundColor: '#F1F2F6' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, fontSize: 16, fontWeight: '800', color: '#2F3542' },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typeDot: { width: 7, height: 7, borderRadius: 3.5 },
  typeChipText: { fontSize: 11, fontWeight: '800' },
  cardTags: { fontSize: 13, color: '#747D8C', marginTop: 3, fontWeight: '600' },
  cardAddrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 2 },
  cardAddr: { flex: 1, fontSize: 12.5, color: '#747D8C', fontWeight: '600' },
  searchActive: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF0F1', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 16, marginTop: 4,
  },
  searchActiveText: { flex: 1, fontSize: 12.5, color: '#FF4757', fontWeight: '700' },
  searchClearBtn: { padding: 2 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  cardMeta: { fontSize: 12, color: '#747D8C', fontWeight: '600' },
  rewardChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#2ED573',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, marginRight: 4,
  },
  rewardChipText: { fontSize: 11, fontWeight: '800', color: '#FFF' },

  empty: { alignItems: 'center', justifyContent: 'center', padding: 50, gap: 10 },
  emptyText: { fontSize: 14, color: '#A4B0BE', fontWeight: '600', textAlign: 'center' },
  loadingBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 8, backgroundColor: '#FFF0F1',
  },
  loadingBarText: { fontSize: 13, fontWeight: '700', color: '#FF4757' },
});
