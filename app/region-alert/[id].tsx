import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getRegionAlert, likeRegionAlert, reportRegionAlert, markRegionAlertSeen, RegionAlertView } from '../../services/api';
import { toast, showConfirm, showActionSheet } from '../../components/Feedback';
import { Avatar } from '../../components/Avatar';
import { requestMapFocus } from '../../utils/mapFocus';
import { ZoomableImage } from '../../components/ZoomableImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SPECIES_LABEL: Record<string, string> = { cachorro: 'Cachorro', gato: 'Gato', passaro: 'Pássaro', outro: 'Outro' };
const REPORT_REASONS = [
  'O pet não está perdido / informação falsa',
  'Conteúdo ofensivo ou impróprio',
  'Spam ou golpe',
  'Outro motivo',
];

export default function RegionAlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [alert, setAlert] = useState<RegionAlertView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [liking, setLiking] = useState(false);
  const [heroZooming, setHeroZooming] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const data = await getRegionAlert(String(id));
      setAlert(data);
      setNotFound(false); // limpa erro anterior; não derrubar tela válida num refetch com falha
      markRegionAlertSeen(String(id)); // não reabrir o banner
    } catch {
      // Só marca não-encontrado se ainda não temos o alerta (erro transitório no
      // re-foco não descarta uma tela já carregada).
      setAlert((prev) => { if (!prev) setNotFound(true); return prev; });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goMap = (openDetails: boolean) => {
    if (!alert?.pet) return;
    requestMapFocus(alert.pet.id, openDetails);
    router.navigate('/(tabs)');
  };

  const toggleLike = async () => {
    if (!alert || liking) return;
    setLiking(true);
    try {
      const r = await likeRegionAlert(alert.id);
      setAlert((a) => (a ? { ...a, my_liked: r.liked, likes_count: r.likes_count } : a));
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.');
    } finally {
      setLiking(false);
    }
  };

  const onReport = () => {
    if (!alert) return;
    showActionSheet({
      title: 'Denunciar alerta',
      message: 'Por que você está denunciando?',
      icon: 'flag-outline',
      options: REPORT_REASONS.map((reason) => ({
        label: reason,
        icon: 'flag-outline',
        onPress: () =>
          showConfirm({
            title: 'Confirmar denúncia?',
            message: 'Denúncias em excesso desativam o alerta e o enviam para análise.',
            icon: 'flag',
            confirmText: 'Denunciar',
            cancelText: 'Cancelar',
            onConfirm: async () => {
              try {
                const r = await reportRegionAlert(alert.id, reason);
                toast.success(r.deactivated ? 'Alerta enviado para análise.' : 'Denúncia registrada. Obrigado.');
                if (r.deactivated) setAlert((a) => (a ? { ...a, status: 'deactivated' } : a));
              } catch (e: any) {
                toast.error(e?.message ?? 'Tente novamente.');
              }
            },
          }),
      })),
    });
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#FF4757" /></View>;
  }
  if (notFound || !alert) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#A4B0BE" />
        <Text style={styles.notFoundText}>Alerta não encontrado ou expirado.</Text>
        <TouchableOpacity style={styles.notFoundBtn} onPress={() => router.back()}>
          <Text style={styles.notFoundBtnText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pet = alert.pet;
  const info = [pet?.species ? SPECIES_LABEL[pet.species] : null, pet?.breed].filter(Boolean).join(' · ');
  const lost = pet?.lost_date ? format(new Date(pet.lost_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : null;

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={!heroZooming} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero */}
        <View style={styles.hero}>
          {pet?.main_photo_url ? (
            <ZoomableImage source={{ uri: pet.main_photo_url }} style={styles.heroImg} resizeMode="cover" onZoomStart={() => setHeroZooming(true)} onZoomEnd={() => setHeroZooming(false)} />
          ) : (
            <LinearGradient colors={['#FF6B81', '#FF4757']} style={styles.heroImg} />
          )}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <TouchableOpacity style={[styles.back, { top: insets.top + 8 }]} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <View style={[styles.heroBadge, { top: insets.top + 14 }]} pointerEvents="none">
            <Ionicons name="megaphone" size={13} color="#FFF" />
            <Text style={styles.heroBadgeText}>Pet perdido na sua região</Text>
          </View>
          <View style={styles.heroText} pointerEvents="none">
            <Text style={styles.heroName}>{pet?.name}</Text>
            {!!info && <Text style={styles.heroInfo}>{info}</Text>}
          </View>
        </View>

        <View style={styles.body}>
          {alert.status !== 'active' && (
            <View style={styles.inactive}>
              <Ionicons name="information-circle" size={16} color="#FFA502" />
              <Text style={styles.inactiveText}>Este alerta não está mais ativo.</Text>
            </View>
          )}

          {/* Infos */}
          <View style={styles.card}>
            {!!lost && (
              <View style={styles.row}>
                <Ionicons name="calendar-outline" size={18} color="#FF4757" />
                <Text style={styles.rowText}>Perdido em <Text style={styles.rowStrong}>{lost}</Text></Text>
              </View>
            )}
            {alert.reward_amount != null && alert.reward_amount > 0 && (
              <View style={styles.row}>
                <Ionicons name="gift" size={18} color="#2ED573" />
                <Text style={styles.rowText}>Recompensa <Text style={[styles.rowStrong, { color: '#2ED573' }]}>R$ {alert.reward_amount.toFixed(2)}</Text></Text>
              </View>
            )}
            <View style={styles.row}>
              <Avatar uri={alert.tutor?.photo_url} size={28} />
              <Text style={styles.rowText}>Tutor: <Text style={styles.rowStrong}>{alert.tutor?.full_name ?? 'Anônimo'}</Text></Text>
            </View>
          </View>

          {/* Comentário do tutor */}
          {!!alert.comment && (
            <View style={styles.commentCard}>
              <Text style={styles.commentLabel}>Recado do tutor</Text>
              <Text style={styles.commentText}>{alert.comment}</Text>
            </View>
          )}

          {/* Ações principais */}
          <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.9} onPress={() => goMap(true)}>
            <Ionicons name="paw" size={20} color="#FFF" />
            <Text style={styles.primaryBtnText}>Abrir detalhes do pet</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.9} onPress={() => goMap(false)}>
            <Ionicons name="map-outline" size={20} color="#FF4757" />
            <Text style={styles.secondaryBtnText}>Ver no mapa</Text>
          </TouchableOpacity>

          {/* Curtir / Denunciar */}
          <View style={styles.reactRow}>
            <TouchableOpacity style={styles.reactBtn} onPress={toggleLike} disabled={liking}>
              <Ionicons name={alert.my_liked ? 'heart' : 'heart-outline'} size={20} color={alert.my_liked ? '#FF4757' : '#747D8C'} />
              <Text style={[styles.reactText, alert.my_liked && { color: '#FF4757' }]}>
                {alert.likes_count > 0 ? alert.likes_count : ''} Curtir
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reactBtn} onPress={onReport}>
              <Ionicons name="flag-outline" size={19} color="#747D8C" />
              <Text style={styles.reactText}>Denunciar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F2F6', gap: 12 },
  notFoundText: { color: '#747D8C', fontSize: 15, fontWeight: '600' },
  notFoundBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#FF4757', borderRadius: 14 },
  notFoundBtnText: { color: '#FFF', fontWeight: '800' },

  hero: { height: 300, backgroundColor: '#FFE0E4' },
  heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  back: {
    position: 'absolute', top: 50, left: 18, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center',
  },
  heroBadge: {
    position: 'absolute', top: 56, right: 18, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FF4757', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  heroBadgeText: { color: '#FFF', fontSize: 11.5, fontWeight: '800' },
  heroText: { position: 'absolute', left: 22, right: 22, bottom: 18 },
  heroName: { fontSize: 30, fontWeight: '900', color: '#FFF', letterSpacing: -0.5 },
  heroInfo: { fontSize: 15, color: 'rgba(255,255,255,0.92)', fontWeight: '600', marginTop: 4 },

  body: { padding: 20 },
  inactive: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF6E5',
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  inactiveText: { fontSize: 13, color: '#FFA502', fontWeight: '700' },
  card: {
    backgroundColor: '#FFF', borderRadius: 18, padding: 16, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, fontSize: 14.5, color: '#747D8C', fontWeight: '600' },
  rowStrong: { color: '#2F3542', fontWeight: '800' },
  commentCard: { backgroundColor: '#FFF0F1', borderRadius: 16, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#FFD6DB' },
  commentLabel: { fontSize: 11.5, fontWeight: '900', color: '#FF4757', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  commentText: { fontSize: 14.5, color: '#2F3542', lineHeight: 20, fontWeight: '500' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20,
    height: 56, borderRadius: 18, backgroundColor: '#FF4757',
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12,
    height: 52, borderRadius: 18, backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#FFD6DB',
  },
  secondaryBtnText: { color: '#FF4757', fontSize: 15, fontWeight: '800' },

  reactRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  reactBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 46, borderRadius: 14, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#ECECEC',
  },
  reactText: { fontSize: 14, fontWeight: '800', color: '#747D8C' },
});
