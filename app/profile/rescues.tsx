import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../../contexts/AuthContext';
import { getUserRescues, RescueItem } from '../../services/api';

const sizeLabel = (s?: string | null) =>
  s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : null;

export default function RescuesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [rescues, setRescues] = useState<RescueItem[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getUserRescues(user.id);
      setRescues(data.rescues);
      setTotalEarned(data.totalEarned);
    } catch (e) {
      console.warn('Erro ao carregar resgates', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meus Resgates</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <FlatList
        data={rescues}
        keyExtractor={(r) => r.chat_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListHeaderComponent={
          <View style={{ padding: 20 }}>
            <LinearGradient
              colors={['#2ED573', '#1ABC9C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.totalCard}
            >
              <View style={styles.trophyCircle}>
                <Ionicons name="trophy" size={28} color="#FFF" />
              </View>
              <Text style={styles.totalLabel}>Total ganho em resgates</Text>
              <Text style={styles.totalValue}>R$ {totalEarned.toFixed(2)}</Text>
              <View style={styles.totalFooter}>
                <Ionicons name="paw" size={15} color="#FFF" />
                <Text style={styles.totalFooterText}>
                  {rescues.length} {rescues.length === 1 ? 'pet resgatado' : 'pets resgatados'}
                </Text>
              </View>
            </LinearGradient>

            <Text style={styles.sectionTitle}>Histórico de resgates</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="paw-outline" size={48} color="#DFE4EA" />
            <Text style={styles.emptyText}>Você ainda não resgatou nenhum pet.</Text>
            <Text style={styles.emptySub}>Quando ajudar a encontrar um pet, ele aparece aqui.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const subtitle = [item.pet?.breed, item.pet?.color, sizeLabel(item.pet?.size)]
            .filter(Boolean)
            .join(' · ');
          return (
            <TouchableOpacity
              style={styles.rescueCard}
              activeOpacity={0.85}
              onPress={() => router.push(`/pet/case/${item.pet.id}` as any)}
            >
              {item.pet?.main_photo_url ? (
                <ExpoImage source={{ uri: item.pet.main_photo_url }} style={styles.rescueImg} contentFit="cover" />
              ) : (
                <View style={[styles.rescueImg, styles.rescueImgEmpty]}>
                  <Ionicons name="paw" size={28} color="#A4B0BE" />
                </View>
              )}

              <View style={{ flex: 1 }}>
                <Text style={styles.rescueName} numberOfLines={1}>{item.pet?.name}</Text>
                {subtitle ? (
                  <Text style={styles.rescueSubtitle} numberOfLines={1}>{subtitle}</Text>
                ) : null}
                <View style={styles.rescueMetaRow}>
                  <Ionicons name="calendar-outline" size={13} color="#A4B0BE" />
                  <Text style={styles.rescueMeta}>
                    {item.rescued_at
                      ? format(new Date(item.rescued_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
                      : '—'}
                  </Text>
                </View>
                {item.tutor?.full_name ? (
                  <View style={styles.rescueMetaRow}>
                    <Ionicons name="person-outline" size={13} color="#A4B0BE" />
                    <Text style={styles.rescueMeta} numberOfLines={1}>Tutor: {item.tutor.full_name}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.rescueRight}>
                {item.reward_amount > 0 ? (
                  <View style={styles.rewardPill}>
                    <Ionicons name="gift" size={12} color="#2ED573" />
                    <Text style={styles.rewardPillText}>R$ {item.reward_amount.toFixed(2)}</Text>
                  </View>
                ) : (
                  <View style={[styles.rewardPill, styles.rewardPillEmpty]}>
                    <Text style={styles.rewardPillEmptyText}>Sem recompensa</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color="#DFE4EA" />
              </View>
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
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

  totalCard: {
    borderRadius: 24, padding: 24, alignItems: 'center',
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 8,
  },
  trophyCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  totalLabel: { color: '#E8FFF5', fontSize: 14, fontWeight: '600' },
  totalValue: { color: '#FFF', fontSize: 40, fontWeight: '900', marginTop: 4, letterSpacing: -1 },
  totalFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  totalFooterText: { color: '#FFF', fontSize: 13, fontWeight: '700' },

  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: '#747D8C',
    textTransform: 'uppercase', marginTop: 24, marginBottom: 4,
  },

  rescueCard: {
    backgroundColor: '#FFF', marginHorizontal: 20, padding: 12, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  rescueImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#DFE4EA' },
  rescueImgEmpty: { justifyContent: 'center', alignItems: 'center' },
  rescueName: { fontSize: 16, fontWeight: '900', color: '#2F3542', letterSpacing: -0.3 },
  rescueSubtitle: { fontSize: 12, color: '#747D8C', fontWeight: '600', marginTop: 2 },
  rescueMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  rescueMeta: { fontSize: 11, color: '#A4B0BE', fontWeight: '600', flexShrink: 1 },

  rescueRight: { alignItems: 'flex-end', gap: 8 },
  rewardPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#E8F8F0', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9,
  },
  rewardPillText: { color: '#2ED573', fontSize: 12, fontWeight: '800' },
  rewardPillEmpty: { backgroundColor: '#F1F2F6' },
  rewardPillEmptyText: { color: '#A4B0BE', fontSize: 11, fontWeight: '700' },

  emptyBox: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { color: '#747D8C', fontSize: 15, fontWeight: '700', marginTop: 6 },
  emptySub: { color: '#A4B0BE', fontSize: 13, textAlign: 'center' },
});
