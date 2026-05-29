import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, FlatList, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { matchPetByPhoto, contactOwner, PetMatch } from '../services/api';
import { toast } from '../components/Feedback';
import { formatDistance } from '../utils/formatDistance';

const formatBRL = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

export default function MatchOwnersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sourcePetId, photo, lat, lng } = useLocalSearchParams<{
    sourcePetId?: string; photo?: string; lat?: string; lng?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<PetMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contacting, setContacting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!photo) { setError('Foto não informada.'); setLoading(false); return; }
      try {
        const res = await matchPetByPhoto(
          photo,
          lat ? Number(lat) : undefined,
          lng ? Number(lng) : undefined,
        );
        setMatches(res);
      } catch (e: any) {
        setError(e?.message ?? 'Falha ao analisar a foto.');
      } finally {
        setLoading(false);
      }
    })();
  }, [photo, lat, lng]);

  const handleContact = async (m: PetMatch) => {
    if (!sourcePetId || contacting) return;
    setContacting(m.id);
    try {
      const r = await contactOwner(m.id, sourcePetId);
      router.replace(`/chat/${r.petId}?tutorId=${r.tutorId}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Não foi possível abrir o chat.');
    } finally {
      setContacting(null);
    }
  };

  const renderItem = ({ item }: { item: PetMatch }) => (
    <View style={styles.card}>
      <Image source={{ uri: item.photo_url }} style={styles.photo} />
      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={styles.simChip}>
            <Text style={styles.simText}>{item.similarity}%</Text>
          </View>
        </View>
        {!!(item.breed || item.color) && (
          <Text style={styles.sub} numberOfLines={1}>{[item.breed, item.color].filter(Boolean).join(' · ')}</Text>
        )}
        <View style={styles.metaRow}>
          {item.distance != null && (
            <><Ionicons name="location" size={12} color="#FF4757" /><Text style={styles.meta}>{formatDistance(item.distance)}</Text></>
          )}
          {item.lost_date && (
            <><Ionicons name="time-outline" size={12} color="#A4B0BE" style={{ marginLeft: 8 }} />
              <Text style={styles.meta}>Perdido há {formatDistanceToNow(new Date(item.lost_date), { locale: ptBR })}</Text></>
          )}
        </View>
        <TouchableOpacity style={styles.contactBtn} onPress={() => handleContact(item)} disabled={!!contacting}>
          {contacting === item.id
            ? <ActivityIndicator size="small" color="#FFF" />
            : <><Ionicons name="chatbubbles" size={16} color="#FFF" /><Text style={styles.contactText}>Falar com o dono</Text></>}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#5B7CFA', '#3B5BDB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Possíveis donos</Text>
          <Text style={styles.headerSub}>Pets perdidos parecidos na sua região</Text>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3B5BDB" />
          <Text style={styles.centerText}>Analisando com reconhecimento facial…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color="#CED6E0" />
          <Text style={styles.centerText}>{error}</Text>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="search-outline" size={48} color="#CED6E0" />
          <Text style={styles.centerText}>Nenhum pet perdido parecido foi encontrado na sua região.</Text>
          <Text style={styles.centerHint}>Seu alerta já está publicado no mapa.</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingBottom: 18,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '900', color: '#FFF', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2, fontWeight: '500' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  centerText: { fontSize: 15, color: '#747D8C', fontWeight: '600', textAlign: 'center' },
  centerHint: { fontSize: 13, color: '#A4B0BE', textAlign: 'center' },

  card: {
    flexDirection: 'row', gap: 12, backgroundColor: '#FFF', borderRadius: 18, padding: 12, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  photo: { width: 84, height: 84, borderRadius: 14, backgroundColor: '#F1F2F6' },
  info: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '800', color: '#2F3542' },
  simChip: { backgroundColor: '#EAF0FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  simText: { fontSize: 12, fontWeight: '900', color: '#3B5BDB' },
  sub: { fontSize: 13, color: '#747D8C', marginTop: 2, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: '#747D8C', fontWeight: '600' },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3B5BDB', height: 40, borderRadius: 12, marginTop: 10,
  },
  contactText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
});
