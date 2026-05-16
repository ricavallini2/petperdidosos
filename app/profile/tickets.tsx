import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../../contexts/AuthContext';
import { listUserTickets, SupportTicket, SupportTicketStatus } from '../../services/api';

const STATUS_META: Record<SupportTicketStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Aguardando',   color: '#FFA502', bg: '#FFF6E5' },
  in_progress: { label: 'Em andamento', color: '#3498DB', bg: '#EAF4FC' },
  resolved:    { label: 'Resolvido',    color: '#2ED573', bg: '#E8FBF1' },
  closed:      { label: 'Encerrado',    color: '#747D8C', bg: '#F1F2F6' },
};

const ticketCode = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;

export default function TicketsScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(false);
      const data = await listUserTickets(user.id);
      setTickets(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const renderItem = ({ item }: { item: SupportTicket }) => {
    const meta = STATUS_META[item.status] ?? STATUS_META.pending;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/profile/ticket/${item.id}` as Href)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.code}>{ticketCode(item.id)}</Text>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <View style={[styles.badgeDot, { backgroundColor: meta.color }]} />
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <Text style={styles.subject} numberOfLines={2}>{item.subject}</Text>
        {!!item.description?.trim() && (
          <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
        )}

        <View style={styles.cardFooter}>
          <Ionicons name="calendar-outline" size={13} color="#A4B0BE" />
          <Text style={styles.date}>
            Aberto em {format(new Date(item.created_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#DFE4EA" style={{ marginLeft: 'auto' }} />
        </View>
      </TouchableOpacity>
    );
  };

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
        <Text style={styles.headerTitle}>Meus chamados</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF4757" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={52} color="#DFE4EA" />
          <Text style={styles.emptyTitle}>Não foi possível carregar</Text>
          <Text style={styles.emptyText}>Verifique sua conexão e tente novamente.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="receipt-outline" size={40} color="#FF4757" />
          </View>
          <Text style={styles.emptyTitle}>Nenhum chamado ainda</Text>
          <Text style={styles.emptyText}>
            Quando você abrir um chamado na Central de Ajuda, ele aparece aqui para você acompanhar.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.push('/support')}>
            <Text style={styles.retryText}>Ir para a Central de Ajuda</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF4757" />
          }
        />
      )}
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

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF0F1',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginTop: 12 },
  emptyText: {
    fontSize: 14, color: '#747D8C', fontWeight: '500',
    textAlign: 'center', lineHeight: 20, marginTop: 6,
  },
  retryBtn: {
    marginTop: 18, backgroundColor: '#FF4757',
    paddingHorizontal: 22, height: 46, borderRadius: 14, justifyContent: 'center',
  },
  retryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontSize: 12, fontWeight: '800', color: '#A4B0BE', letterSpacing: 0.5 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  subject: { fontSize: 15.5, fontWeight: '800', color: '#2F3542', marginTop: 8, lineHeight: 21 },
  desc: { fontSize: 13, color: '#747D8C', fontWeight: '500', marginTop: 4, lineHeight: 18 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F2F6',
  },
  date: { fontSize: 12, color: '#A4B0BE', fontWeight: '600' },
});
