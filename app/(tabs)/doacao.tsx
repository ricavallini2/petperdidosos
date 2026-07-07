import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, FlatList, TouchableOpacity, TextInput,
  Image, ActivityIndicator, ScrollView, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { fetchDonations, DonationPet, PetSpecies } from '../../services/api';
import { toast } from '../../components/Feedback';
import { CollapsibleFilters } from '../../components/CollapsibleFilters';
import { colorMatches } from '../../utils/colorMatch';
import { formatDistance } from '../../utils/formatDistance';

const DONATION_COLOR = '#3B82F6';

const SPECIES_FILTERS: { value: PetSpecies | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'cachorro', label: 'Cachorro' },
  { value: 'gato', label: 'Gato' },
  { value: 'passaro', label: 'Pássaro' },
  { value: 'outro', label: 'Outro' },
];
const AGE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'filhote', label: 'Filhote' },
  { value: 'adulto', label: 'Adulto' },
  { value: 'idoso', label: 'Idoso' },
];

const speciesLabel = (s?: string | null) =>
  s === 'cachorro' ? 'Cachorro' : s === 'gato' ? 'Gato' : s === 'passaro' ? 'Pássaro' : s === 'outro' ? 'Outro' : null;
const sizeLabel = (s?: string | null) =>
  s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : null;
const ageLabel = (a?: string | null) =>
  a === 'filhote' ? 'Filhote' : a === 'adulto' ? 'Adulto' : a === 'idoso' ? 'Idoso' : null;
const sexLabel = (s?: string | null) => (s === 'macho' ? 'Macho' : s === 'femea' ? 'Fêmea' : null);

export default function DoacaoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pets, setPets] = useState<DonationPet[]>([]);
  const [loading, setLoading] = useState(false);

  // Filtros
  const [speciesFilter, setSpeciesFilter] = useState<PetSpecies | 'all'>('all');
  const [ageFilter, setAgeFilter] = useState<string>('all');
  const [breedText, setBreedText] = useState('');
  const [colorText, setColorText] = useState('');

  // Ponto de referência para distância/ordenação: GPS ou endereço pesquisado.
  const [refPoint, setRefPoint] = useState<{ latitude: number; longitude: number; label?: string } | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [searchingAddress, setSearchingAddress] = useState(false);

  // Endereço aproximado de cada pet (reverse-geocode, cache por id)
  const [petAddresses, setPetAddresses] = useState<Record<string, string>>({});
  const addrCacheRef = useRef<Record<string, string>>({});

  // GPS inicial (apenas como referência de distância; não filtra a lista)
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync();
        if (last) setRefPoint((prev) => prev ?? { latitude: last.coords.latitude, longitude: last.coords.longitude });
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setRefPoint((prev) => (prev?.label ? prev : { latitude: loc.coords.latitude, longitude: loc.coords.longitude }));
      } catch {}
    })();
  }, []);

  // Lista todas as doações ativas (sem recorte por raio — adoção abrange área
  // ampla). A proximidade entra só na ordenação/cálculo de distância.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDonations(
        refPoint ? { lat: refPoint.latitude, lng: refPoint.longitude, radius: 5000000 } : undefined,
      );
      setPets(data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, [refPoint]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Busca por CEP/endereço → define o ponto de referência (reordena por proximidade).
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
        setRefPoint({ latitude: results[0].latitude, longitude: results[0].longitude, label });
      } else {
        toast.error('Não localizamos esse endereço. Tente ser mais específico.', 'Endereço não encontrado');
      }
    } catch {
      toast.error('Falha ao buscar o endereço. Verifique sua conexão.', 'Erro na busca');
    } finally {
      setSearchingAddress(false);
    }
  };

  // Reverse-geocode (endereço dos cards), cacheado por id.
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

  // Aplica filtros locais e ordena por proximidade do ponto de referência.
  const list = useMemo(() => {
    const b = breedText.trim().toLowerCase();
    const filtered = pets.filter((p) => {
      if (speciesFilter !== 'all' && (p.species ?? null) !== speciesFilter) return false;
      if (ageFilter !== 'all' && (p.age_group ?? null) !== ageFilter) return false;
      if (b && !(p.breed ?? '').toLowerCase().includes(b)) return false;
      if (!colorMatches(p.color, colorText)) return false;
      return true;
    });
    if (refPoint) {
      filtered.sort((a, b2) => (a.distance ?? Infinity) - (b2.distance ?? Infinity));
    }
    return filtered;
  }, [pets, speciesFilter, ageFilter, breedText, colorText, refPoint]);

  const renderItem = ({ item }: { item: DonationPet }) => {
    const tags = [speciesLabel(item.species), item.breed, item.color, sizeLabel(item.size), ageLabel(item.age_group), sexLabel(item.sex)]
      .filter(Boolean) as string[];
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => router.push(`/donation/${item.id}` as Href)}
      >
        <View style={styles.cardTop}>
          <Image source={{ uri: item.photo_url }} style={styles.cardPhoto} />
          <View style={{ flex: 1 }}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <View style={styles.typeChip}>
                <Ionicons name="heart" size={11} color={DONATION_COLOR} />
                <Text style={styles.typeChipText}>Adoção</Text>
              </View>
            </View>
            {tags.length > 0 && <Text style={styles.cardTags} numberOfLines={2}>{tags.join(' · ')}</Text>}
            <View style={styles.cardMetaRow}>
              {item.distance != null && (
                <>
                  <Ionicons name="location" size={12} color={DONATION_COLOR} />
                  <Text style={styles.cardMeta}>{formatDistance(item.distance)}</Text>
                </>
              )}
              {item.created_at && (
                <>
                  <Ionicons name="time-outline" size={12} color="#A4B0BE" style={{ marginLeft: item.distance != null ? 8 : 0 }} />
                  <Text style={styles.cardMeta}>{formatDistanceToNow(new Date(item.created_at), { locale: ptBR })}</Text>
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
      <LinearGradient colors={['#60A5FA', DONATION_COLOR]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Adoção</Text>
            <Text style={styles.headerSub}>Pets esperando um novo lar</Text>
          </View>
          <TouchableOpacity
            style={styles.donateBtn}
            activeOpacity={0.9}
            onPress={() => router.push({ pathname: '/(tabs)/report', params: { initMode: 'donation' } })}
          >
            <Ionicons name="add" size={18} color={DONATION_COLOR} />
            <Text style={styles.donateBtnText}>Doar</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Filtros recolhíveis */}
      <CollapsibleFilters accentColor={DONATION_COLOR}>
        <Text style={styles.filterLabel}>Espécie</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {SPECIES_FILTERS.map((f) => (
            <TouchableOpacity key={f.value} style={[styles.chip, speciesFilter === f.value && styles.chipActive]} onPress={() => setSpeciesFilter(f.value)}>
              <Text style={[styles.chipText, speciesFilter === f.value && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>Idade</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {AGE_FILTERS.map((f) => (
            <TouchableOpacity key={f.value} style={[styles.chip, ageFilter === f.value && styles.chipActive]} onPress={() => setAgeFilter(f.value)}>
              <Text style={[styles.chipText, ageFilter === f.value && styles.chipTextActive]}>{f.label}</Text>
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
            <TouchableOpacity onPress={handleSearchAddress} disabled={searchingAddress || !addressQuery.trim()} style={{ paddingHorizontal: 4 }}>
              {searchingAddress
                ? <ActivityIndicator size="small" color={DONATION_COLOR} />
                : <Ionicons name="arrow-forward" size={18} color={addressQuery.trim() ? DONATION_COLOR : '#CED6E0'} />}
            </TouchableOpacity>
          </View>
        </View>
        {refPoint?.label && (
          <View style={styles.searchActive}>
            <Ionicons name="location" size={13} color={DONATION_COLOR} />
            <Text style={styles.searchActiveText} numberOfLines={1}>Ordenado por proximidade de {refPoint.label}</Text>
            <TouchableOpacity onPress={() => { setRefPoint(null); setAddressQuery(''); }} style={{ padding: 2 }}>
              <Ionicons name="close" size={14} color={DONATION_COLOR} />
            </TouchableOpacity>
          </View>
        )}
      </CollapsibleFilters>

      {loading && pets.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={DONATION_COLOR} />
          <Text style={styles.emptyText}>Buscando pets para adoção...</Text>
        </View>
      ) : (
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
                <Ionicons name="heart-dislike-outline" size={48} color="#CED6E0" />
                <Text style={styles.emptyText}>Nenhum pet para adoção com esses filtros</Text>
              </View>
            )
          }
        />
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
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF', letterSpacing: -0.5 },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginTop: 2, fontWeight: '500' },
  donateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF', paddingHorizontal: 14, height: 40, borderRadius: 20,
  },
  donateBtnText: { color: DONATION_COLOR, fontWeight: '800', fontSize: 14 },

  filters: { paddingTop: 10, paddingBottom: 8, gap: 6, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#ECECEC' },
  filterLabel: { fontSize: 11, fontWeight: '800', color: '#A4B0BE', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16, marginTop: 4 },
  chipRow: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#DFE4EA', backgroundColor: '#FFF' },
  chipActive: { backgroundColor: DONATION_COLOR, borderColor: DONATION_COLOR },
  chipText: { fontSize: 13, fontWeight: '700', color: '#747D8C' },
  chipTextActive: { color: '#FFF' },
  textFilters: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  textInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F1F2F6', borderRadius: 12, paddingHorizontal: 12, height: 40,
  },
  textInput: { flex: 1, fontSize: 14, color: '#2F3542' },
  searchActive: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#EFF6FF', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 16, marginTop: 4,
  },
  searchActiveText: { flex: 1, fontSize: 12.5, color: DONATION_COLOR, fontWeight: '700' },

  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 12, marginBottom: 10,
    borderLeftWidth: 5, borderLeftColor: DONATION_COLOR,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardDivider: { height: 1, backgroundColor: '#EAEDF0', marginTop: 10 },
  cardPhoto: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#F1F2F6' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, fontSize: 16, fontWeight: '800', color: '#2F3542' },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#EFF6FF' },
  typeChipText: { fontSize: 11, fontWeight: '800', color: DONATION_COLOR },
  cardTags: { fontSize: 13, color: '#747D8C', marginTop: 3, fontWeight: '600' },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  cardMeta: { fontSize: 12, color: '#747D8C', fontWeight: '600' },
  cardAddrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 2 },
  cardAddr: { flex: 1, fontSize: 12.5, color: '#747D8C', fontWeight: '600' },

  empty: { alignItems: 'center', justifyContent: 'center', padding: 50, gap: 10 },
  emptyText: { fontSize: 14, color: '#A4B0BE', fontWeight: '600', textAlign: 'center' },
});
