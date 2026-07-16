import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { getUserProfile } from '../../services/api';
import { PetCard } from '../../components/PetCard';

// ============================================================================
// HISTÓRICO DE ALERTAS — alertas já finalizados (encontrado/doado/cancelado).
// Os alertas ATIVOS continuam no Perfil; aqui fica só o que já encerrou.
// ============================================================================

export default function HistoricoAlertasScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pets, setPets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await getUserProfile(user.id);
      setPets((data?.pets ?? []).filter((p: any) => p.status !== 'ativo'));
    } catch (e) {
      console.warn('Erro ao carregar histórico de alertas', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color="#2F3542" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Histórico de alertas</Text>
          {pets.length > 0 && (
            <Text style={styles.headerSub}>
              {pets.length} {pets.length === 1 ? 'alerta finalizado' : 'alertas finalizados'}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#FF4757" style={{ marginTop: 60 }} />
      ) : pets.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="time-outline" size={44} color="#A4B0BE" />
          </View>
          <Text style={styles.emptyTitle}>Nenhum alerta finalizado</Text>
          <Text style={styles.emptyText}>
            Quando um alerta seu for encerrado — reencontro, doação ou cancelamento — ele fica
            guardado aqui. 🐾
          </Text>
        </View>
      ) : (
        <FlatList
          data={pets}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor="#FF4757"
              colors={['#FF4757']}
            />
          }
          renderItem={({ item }) => (
            <PetCard pet={item} onPress={() => router.push(`/pet/case/${item.id}`)} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#2F3542' },
  headerSub: { fontSize: 12, color: '#A4B0BE', fontWeight: '700', marginTop: 1 },

  listContent: { padding: 20 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 18,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#2F3542', marginBottom: 6 },
  emptyText: { fontSize: 14, color: '#A4B0BE', textAlign: 'center', lineHeight: 20 },
});
