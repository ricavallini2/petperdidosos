import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, FlatList, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { listSuccessCases, SuccessCase } from '../services/api';
import { Avatar } from '../components/Avatar';

// ============================================================================
// CASOS DE SUCESSO — vitrine dos finais felizes autorizados pelos tutores.
// ============================================================================

const TYPE_TAG: Record<string, { label: string; color: string }> = {
  lost: { label: 'REENCONTRADO', color: '#2ED573' },
  sighted: { label: 'REENCONTRADO', color: '#2ED573' },
  rescued: { label: 'REENCONTRADO', color: '#2ED573' },
  donation: { label: 'ADOTADO', color: '#3B82F6' },
};

export default function SuccessCasesScreen() {
  const router = useRouter();
  const [cases, setCases] = useState<SuccessCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCases(await listSuccessCases());
    } catch (e) {
      console.warn('Erro ao carregar casos de sucesso', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#2F3542" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Casos de Sucesso</Text>
          {cases.length > 0 && (
            <Text style={styles.headerSub}>
              {cases.length} {cases.length === 1 ? 'final feliz' : 'finais felizes'} 🎉
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#2ED573" style={{ marginTop: 60 }} />
      ) : cases.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="trophy-outline" size={44} color="#A4B0BE" />
          </View>
          <Text style={styles.emptyTitle}>Nenhum caso publicado ainda</Text>
          <Text style={styles.emptyText}>
            Quando um tutor concluir um caso e autorizar a publicação, o final feliz aparece aqui. 🐾
          </Text>
        </View>
      ) : (
        <FlatList
          data={cases}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#2ED573" />
          }
          renderItem={({ item }) => {
            const tag = TYPE_TAG[item.pets?.type ?? 'lost'] ?? TYPE_TAG.lost;
            const photo = item.photo_url || item.pets?.main_photo_url;
            const days = item.days_lost;
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.88}
                onPress={() => router.push(`/success-case/${item.pet_id}`)}
              >
                <View>
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.photo} />
                  ) : (
                    <View style={[styles.photo, styles.photoEmpty]}>
                      <Ionicons name="paw" size={40} color="#DFE4EA" />
                    </View>
                  )}
                  <View style={[styles.tag, { backgroundColor: tag.color }]}>
                    <Ionicons name="checkmark-circle" size={12} color="#FFF" />
                    <Text style={styles.tagText}>{tag.label}</Text>
                  </View>
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.rowTop}>
                    <Text style={styles.petName} numberOfLines={1}>{item.pets?.name ?? 'Pet'}</Text>
                    <Text style={styles.date}>
                      {format(new Date(item.concluded_at ?? item.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                    </Text>
                  </View>
                  <Text style={styles.daysChip}>
                    {days != null && days > 0
                      ? `De volta pra casa após ${days} dia${days > 1 ? 's' : ''} 🏠`
                      : 'De volta pra casa 🏠'}
                  </Text>
                  {!!item.message && (
                    <Text style={styles.message} numberOfLines={2}>“{item.message}”</Text>
                  )}
                  <View style={styles.peopleRow}>
                    <Avatar uri={item.tutor?.photo_url ?? undefined} size={24} />
                    <Text style={styles.peopleText} numberOfLines={1}>
                      {item.tutor?.full_name ?? 'Tutor'}
                      {item.finder_name ? `  ·  Herói: ${item.finder_name}` : ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={17} color="#DFE4EA" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 50, paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#2F3542' },
  headerSub: { fontSize: 12, color: '#2ED573', fontWeight: '700', marginTop: 1 },

  card: {
    backgroundColor: '#FFF', borderRadius: 22, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  photo: { width: '100%', height: 190, backgroundColor: '#F1F2F6' },
  photoEmpty: { justifyContent: 'center', alignItems: 'center' },
  tag: {
    position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  tagText: { color: '#FFF', fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },

  cardBody: { padding: 14 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  petName: { fontSize: 18, fontWeight: '900', color: '#2F3542', flex: 1, marginRight: 8 },
  date: { fontSize: 11.5, color: '#A4B0BE', fontWeight: '600' },
  daysChip: { fontSize: 12.5, color: '#26B765', fontWeight: '800', marginTop: 3 },
  message: { fontSize: 13.5, color: '#747D8C', fontStyle: 'italic', marginTop: 8, lineHeight: 19 },
  peopleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  peopleText: { flex: 1, fontSize: 12.5, color: '#747D8C', fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 18,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#2F3542', marginBottom: 6 },
  emptyText: { fontSize: 14, color: '#A4B0BE', textAlign: 'center', lineHeight: 20 },
});
