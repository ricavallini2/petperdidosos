import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, Image, ActivityIndicator,
  Modal, ScrollView, Dimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PHOTO_W = Dimensions.get('window').width - 40; // largura da tela menos padding 20+20
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../components/Feedback';
import { supabase } from '../services/supabase';
import { matchPetByPhoto, PetMatch, useAiSearchApi } from '../services/api';

type SortMode = 'similarity' | 'distance';

const sizeLabel = (s?: string) =>
  s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : null;

const sexLabel = (s?: string) => s === 'macho' ? 'Macho' : s === 'femea' ? 'Fêmea' : null;

const ageLabel = (a?: string) => a === 'filhote' ? 'Filhote' : a === 'adulto' ? 'Adulto' : a === 'idoso' ? 'Idoso' : null;

const distanceLabel = (m: number | null) => {
  if (m == null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
};

const similarityColor = (pct: number) =>
  pct >= 80 ? '#2ED573' : pct >= 60 ? '#FFA502' : '#FF4757';

export default function FindPetScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<PetMatch[] | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('similarity');
  const [selected, setSelected] = useState<PetMatch | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [aiSearchesLeft, setAiSearchesLeft] = useState<number | null>(null);
  // Guarda a foto enviada e o local da busca para reaproveitar no cadastro
  // de pet visto/resgatado quando nada é encontrado.
  const [searchPhotoUrl, setSearchPhotoUrl] = useState<string | null>(null);
  const [searchCoords, setSearchCoords] = useState<{ lat: number; lng: number } | null>(null);

  const takePhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      toast.warning('Permissão necessária para usar a câmera/galeria.');
      return;
    }
    // Sem allowsEditing/crop — o CLIP analisa a imagem inteira, e o crop no
    // Android gera arquivo temporário que some (foto fica em branco).
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const uri = result.assets[0].uri;
    console.log('[find-pet] foto selecionada:', uri);
    setResults(null);
    setPhotoUri(uri);
  };

  const analyze = async () => {
    if (!photoUri || !user) return;

    const check = await useAiSearchApi(user.id);
    if (!check.allowed) {
      setShowPaywall(true);
      return;
    }
    if (check.aiSearchesLeft != null) setAiSearchesLeft(check.aiSearchesLeft);

    setAnalyzing(true);
    setResults(null);
    try {
      // 1. Upload da foto
      const ext = photoUri.substring(photoUri.lastIndexOf('.') + 1) || 'jpg';
      const fileName = `found_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(photoUri, { encoding: 'base64' });
      const { error: upErr } = await supabase.storage
        .from('pets')
        .upload(fileName, decode(base64), { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
      if (upErr) throw upErr;
      const publicUrl = supabase.storage.from('pets').getPublicUrl(fileName).data.publicUrl;
      setSearchPhotoUrl(publicUrl);

      // 2. Localização atual (opcional)
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
      } catch {}
      setSearchCoords(lat != null && lng != null ? { lat, lng } : null);

      // 3. Match por IA
      const matches = await matchPetByPhoto(publicUrl, lat, lng);
      setResults(matches);
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro na análise');
    } finally {
      setAnalyzing(false);
    }
  };

  // Sem match: leva ao cadastro de pet visto/resgatado já com a foto da busca.
  const registerAs = (mode: 'sighted' | 'rescued') => {
    router.push({
      pathname: '/(tabs)/report',
      params: {
        initMode: mode,
        ...(searchPhotoUrl ? { initPhoto: searchPhotoUrl } : {}),
        ...(searchCoords ? { initLat: String(searchCoords.lat), initLng: String(searchCoords.lng) } : {}),
      },
    });
  };

  const sortedResults = React.useMemo(() => {
    if (!results) return [];
    const copy = [...results];
    if (sortMode === 'similarity') {
      copy.sort((a, b) => b.similarity - a.similarity);
    } else {
      copy.sort((a, b) => {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
    }
    return copy;
  }, [results, sortMode]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Encontrei um Pet</Text>
        {aiSearchesLeft != null ? (
          <TouchableOpacity style={styles.searchCounter} onPress={() => router.push('/profile/premium')}>
            <Ionicons name="sparkles" size={13} color="#FFA502" />
            <Text style={styles.searchCounterText}>{aiSearchesLeft} restante{aiSearchesLeft !== 1 ? 's' : ''}</Text>
          </TouchableOpacity>
        ) : (
          <ExpoImage
            source={require('../logotipo/icon.png')}
            style={styles.headerLogo}
            contentFit="contain"
          />
        )}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.topArea}>
          {/* Foto / picker */}
          {photoUri ? (
            <View style={styles.photoWrap}>
              <ExpoImage
                source={{ uri: photoUri }}
                style={styles.photo}
                contentFit="cover"
                onLoadStart={() => console.log('[find-pet] onLoadStart')}
                onLoad={() => console.log('[find-pet] onLoad OK')}
                onError={(e) => console.log('[find-pet] onError:', JSON.stringify(e))}
              />
              <TouchableOpacity style={styles.retakeBtn} onPress={() => takePhoto(true)}>
                <Ionicons name="camera-reverse" size={18} color="#FFF" />
                <Text style={styles.retakeText}>Trocar foto</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.pickerArea}>
              <View style={styles.pickerIcon}>
                <Ionicons name="paw" size={36} color="#FF4757" />
              </View>
              <Text style={styles.pickerTitle}>Fotografe o pet encontrado</Text>
              <Text style={styles.pickerSub}>
                A IA vai comparar com todos os alertas ativos e listar os mais parecidos.
              </Text>
              <View style={styles.pickerButtons}>
                <TouchableOpacity style={styles.pickerBtnPrimary} onPress={() => takePhoto(true)}>
                  <Ionicons name="camera" size={20} color="#FFF" />
                  <Text style={styles.pickerBtnPrimaryText}>Câmera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pickerBtnSecondary} onPress={() => takePhoto(false)}>
                  <Ionicons name="images" size={20} color="#FF4757" />
                  <Text style={styles.pickerBtnSecondaryText}>Galeria</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Botão analisar */}
          {photoUri && !results && (
            <TouchableOpacity style={styles.analyzeWrap} onPress={analyze} disabled={analyzing} activeOpacity={0.9}>
              <LinearGradient
                colors={analyzing ? ['#A4B0BE', '#A4B0BE'] : ['#FF6B81', '#FF4757']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.analyzeBtn}
              >
                {analyzing ? (
                  <>
                    <ActivityIndicator color="#FFF" />
                    <Text style={styles.analyzeText}>Analisando com IA...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="sparkles" size={20} color="#FFF" />
                    <Text style={styles.analyzeText}>Analisar e buscar parecidos</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Cabeçalho dos resultados + ordenação */}
          {results && (
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {results.length === 0
                  ? 'Nenhum pet parecido encontrado'
                  : `${results.length} ${results.length === 1 ? 'pet parecido' : 'pets parecidos'}`}
              </Text>
              {results.length > 0 && (
                <View style={styles.sortToggle}>
                  <TouchableOpacity
                    style={[styles.sortOption, sortMode === 'similarity' && styles.sortOptionActive]}
                    onPress={() => setSortMode('similarity')}
                  >
                    <Text style={[styles.sortText, sortMode === 'similarity' && styles.sortTextActive]}>
                      Semelhança
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sortOption, sortMode === 'distance' && styles.sortOptionActive]}
                    onPress={() => setSortMode('distance')}
                  >
                    <Text style={[styles.sortText, sortMode === 'distance' && styles.sortTextActive]}>
                      Distância
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Lista de resultados */}
        {sortedResults.map((item) => (
          <TouchableOpacity key={item.id} style={styles.resultCard} activeOpacity={0.85} onPress={() => setSelected(item)}>
            <Image source={{ uri: item.photo_url }} style={styles.resultImg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{item.name}</Text>
              <Text style={styles.resultSub} numberOfLines={1}>
                {[item.breed, item.color, sizeLabel(item.size), sexLabel(item.sex), ageLabel(item.age_group)].filter(Boolean).join(' · ') || 'Sem detalhes'}
              </Text>
              <View style={styles.resultMeta}>
                {distanceLabel(item.distance) && (
                  <View style={styles.metaChip}>
                    <Ionicons name="location" size={12} color="#747D8C" />
                    <Text style={styles.metaChipText}>{distanceLabel(item.distance)}</Text>
                  </View>
                )}
                {item.lost_date && (
                  <Text style={styles.metaTime}>
                    {formatDistanceToNow(new Date(item.lost_date), { locale: ptBR, addSuffix: true })}
                  </Text>
                )}
              </View>
            </View>
            <View style={[styles.simBadge, { backgroundColor: similarityColor(item.similarity) }]}>
              <Text style={styles.simBadgeValue}>{item.similarity}%</Text>
              <Text style={styles.simBadgeLabel}>match</Text>
            </View>
          </TouchableOpacity>
        ))}

        {results && results.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="search" size={44} color="#DFE4EA" />
            <Text style={styles.emptyText}>
              Nenhum alerta ativo combinou com essa foto. Tente outro ângulo ou foto mais nítida.
            </Text>

            <View style={styles.emptyDivider} />
            <Text style={styles.emptyCtaTitle}>Quer ajudar este pet?</Text>
            <Text style={styles.emptyCtaSub}>
              Cadastre um alerta com esta mesma foto para que o tutor possa encontrá-lo.
            </Text>
            <TouchableOpacity
              style={[styles.emptyCtaBtn, { backgroundColor: '#F79F1F' }]}
              activeOpacity={0.9}
              onPress={() => registerAs('sighted')}
            >
              <Ionicons name="eye" size={20} color="#FFF" />
              <Text style={styles.emptyCtaBtnText}>Cadastrar pet visto</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.emptyCtaBtn, { backgroundColor: '#20BF6B' }]}
              activeOpacity={0.9}
              onPress={() => registerAs('rescued')}
            >
              <Ionicons name="heart" size={20} color="#FFF" />
              <Text style={styles.emptyCtaBtnText}>Cadastrar pet resgatado</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Paywall — limite de buscas atingido */}
      <Modal visible={showPaywall} animationType="fade" transparent onRequestClose={() => setShowPaywall(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.paywallSheet}>
            <View style={styles.paywallIconWrap}>
              <Ionicons name="sparkles" size={36} color="#FFA502" />
            </View>
            <Text style={styles.paywallTitle}>Limite mensal atingido</Text>
            <Text style={styles.paywallSub}>
              Você usou todas as 5 buscas por IA gratuitas deste mês.
              Assine o Premium e tenha buscas ilimitadas!
            </Text>
            <View style={styles.paywallFeatures}>
              {['Buscas por IA ilimitadas', 'Alertas prioritários de recompensas', 'Destaque no mapa'].map((f) => (
                <View key={f} style={styles.paywallFeatureRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#2ED573" />
                  <Text style={styles.paywallFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={styles.paywallBtn}
              onPress={() => { setShowPaywall(false); router.push('/profile/premium'); }}
            >
              <Ionicons name="star" size={18} color="#FFF" />
              <Text style={styles.paywallBtnText}>Ver Premium — R$ 9,90/mês</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPaywall(false)} style={{ alignItems: 'center', paddingTop: 12 }}>
              <Text style={{ color: '#747D8C', fontWeight: '600', fontSize: 14 }}>Agora não</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal de detalhes do match */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.modalHandle} />
            {selected && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Image source={{ uri: selected.photo_url }} style={styles.modalImg} />
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalName}>{selected.name}</Text>
                  <View style={[styles.simBadge, { backgroundColor: similarityColor(selected.similarity) }]}>
                    <Text style={styles.simBadgeValue}>{selected.similarity}%</Text>
                    <Text style={styles.simBadgeLabel}>match</Text>
                  </View>
                </View>
                <View style={styles.modalTags}>
                  {[selected.breed, selected.color, sizeLabel(selected.size), sexLabel(selected.sex), ageLabel(selected.age_group)].filter(Boolean).map((t, i) => (
                    <View key={i} style={styles.modalTag}>
                      <Text style={styles.modalTagText}>{t}</Text>
                    </View>
                  ))}
                </View>
                {distanceLabel(selected.distance) && (
                  <Text style={styles.modalMeta}>
                    <Ionicons name="location" size={14} color="#FF4757" /> {distanceLabel(selected.distance)} de você
                  </Text>
                )}
                {selected.description ? (
                  <>
                    <Text style={styles.modalSectionTitle}>Descrição</Text>
                    <Text style={styles.modalBody}>{selected.description}</Text>
                  </>
                ) : null}
                {selected.extra_info ? (
                  <>
                    <Text style={styles.modalSectionTitle}>Mais informações</Text>
                    <Text style={styles.modalBody}>{selected.extra_info}</Text>
                  </>
                ) : null}

                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => {
                    const petId = selected.id;
                    const tutorId = selected.user?.id;
                    setSelected(null);
                    router.push(`/chat/${petId}?tutorId=${tutorId}`);
                  }}
                >
                  <Ionicons name="chatbubbles" size={20} color="#FFF" />
                  <Text style={styles.contactBtnText}>É esse pet! Falar com o tutor</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalClose} onPress={() => setSelected(null)}>
                  <Text style={styles.modalCloseText}>Fechar</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 54, paddingHorizontal: 16, paddingBottom: 18,
    flexDirection: 'row', alignItems: 'center',
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },
  headerLogo: { width: 36, height: 36 },

  topArea: { padding: 20 },
  pickerArea: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 28, alignItems: 'center',
    borderWidth: 2, borderColor: '#DFE4EA', borderStyle: 'dashed',
  },
  pickerIcon: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#FFF0F1',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginBottom: 6 },
  pickerSub: { fontSize: 13, color: '#747D8C', textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  pickerButtons: { flexDirection: 'row', gap: 10 },
  pickerBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FF4757',
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14,
  },
  pickerBtnPrimaryText: { color: '#FFF', fontWeight: '800' },
  pickerBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF0F1',
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14,
  },
  pickerBtnSecondaryText: { color: '#FF4757', fontWeight: '800' },

  photoWrap: { width: PHOTO_W, height: 280, position: 'relative' },
  photo: { width: PHOTO_W, height: 280, borderRadius: 16, backgroundColor: '#DFE4EA' },
  retakeBtn: {
    position: 'absolute', bottom: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
  },
  retakeText: { color: '#FFF', fontWeight: '700', fontSize: 13 },

  analyzeWrap: {
    marginTop: 16,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
  },
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, borderRadius: 16,
  },
  analyzeText: { color: '#FFF', fontWeight: '800', fontSize: 16 },

  resultsHeader: { marginTop: 18 },
  resultsCount: { fontSize: 15, fontWeight: '800', color: '#2F3542', marginBottom: 12 },
  sortToggle: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 12, padding: 4 },
  sortOption: { flex: 1, height: 36, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  sortOptionActive: { backgroundColor: '#FF4757' },
  sortText: { fontWeight: '700', color: '#747D8C', fontSize: 13 },
  sortTextActive: { color: '#FFF' },

  resultCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 12, marginHorizontal: 20, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  resultImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#DFE4EA' },
  resultName: { fontSize: 16, fontWeight: '800', color: '#2F3542' },
  resultSub: { fontSize: 13, color: '#747D8C', marginTop: 2 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaChipText: { fontSize: 12, color: '#747D8C', fontWeight: '600' },
  metaTime: { fontSize: 11, color: '#A4B0BE' },
  simBadge: {
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', minWidth: 56,
  },
  simBadgeValue: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  simBadgeLabel: { color: '#FFF', fontWeight: '700', fontSize: 9, opacity: 0.9 },

  emptyBox: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32, gap: 12 },
  emptyText: { fontSize: 14, color: '#747D8C', textAlign: 'center', lineHeight: 20 },
  emptyDivider: { height: 1, alignSelf: 'stretch', backgroundColor: '#EAEDF0', marginVertical: 8 },
  emptyCtaTitle: { fontSize: 16, fontWeight: '900', color: '#2F3542', textAlign: 'center' },
  emptyCtaSub: { fontSize: 13, color: '#747D8C', textAlign: 'center', lineHeight: 19, marginBottom: 4 },
  emptyCtaBtn: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 54, borderRadius: 16,
  },
  emptyCtaBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, maxHeight: '88%',
  },
  modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#DFE4EA', alignSelf: 'center', marginBottom: 16 },
  modalImg: { width: PHOTO_W, height: 220, borderRadius: 16, marginBottom: 14, backgroundColor: '#DFE4EA' },
  modalTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalName: { fontSize: 24, fontWeight: '900', color: '#2F3542', flex: 1 },
  modalTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  modalTag: { backgroundColor: '#F1F2F6', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  modalTagText: { fontSize: 12, color: '#2F3542', fontWeight: '600' },
  modalMeta: { fontSize: 14, color: '#57606F', fontWeight: '600', marginTop: 12 },
  modalSectionTitle: { fontSize: 12, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  modalBody: { fontSize: 15, color: '#2F3542', lineHeight: 22 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FF4757', height: 56, borderRadius: 16, marginTop: 22,
  },
  contactBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  modalClose: { alignItems: 'center', paddingVertical: 14 },
  modalCloseText: { color: '#747D8C', fontWeight: '600' },

  searchCounter: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF6E5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  searchCounterText: { fontSize: 12, fontWeight: '700', color: '#FFA502' },

  paywallSheet: {
    backgroundColor: '#FFF', borderRadius: 28, padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
  },
  paywallIconWrap: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF6E5',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  paywallTitle: { fontSize: 22, fontWeight: '900', color: '#2F3542', textAlign: 'center', marginBottom: 8 },
  paywallSub: { fontSize: 14, color: '#747D8C', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  paywallFeatures: { alignSelf: 'stretch', gap: 10, marginBottom: 24 },
  paywallFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paywallFeatureText: { fontSize: 14, fontWeight: '600', color: '#2F3542' },
  paywallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFA502', height: 54, borderRadius: 16,
    justifyContent: 'center', alignSelf: 'stretch',
    shadowColor: '#FFA502', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  paywallBtnText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
});
