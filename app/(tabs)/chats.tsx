import React, { useCallback, useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { listUserChats } from '../../services/api';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Avatar } from '../../components/Avatar';

type Tab = 'open' | 'closed';

// Estado do chat → cor de acento + selo. A cor segue o TIPO do pet
// (perdido = vermelho, visto = laranja, resgatado = verde, doação = azul).
const TYPE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  lost:     { label: 'Perdido',   color: '#FF4757', bg: '#FFF0F1' },
  sighted:  { label: 'Visto',     color: '#F79F1F', bg: '#FFF6E5' },
  rescued:  { label: 'Resgatado', color: '#20BF6B', bg: '#E8F8F5' },
  donation: { label: 'Doação',    color: '#3B82F6', bg: '#EFF6FF' },
};

const chatState = (c: any): { label: string; color: string; bg: string } => {
  const t = (c.pets?.type ?? 'lost') as keyof typeof TYPE_STYLE;
  if (c.status === 'closed') {
    if (!c.found) return { label: 'Encerrado', color: '#747D8C', bg: '#F1F2F6' };
    // Concluído com sucesso: doação = "Doado" (azul); demais = "Resgatado" (verde).
    return t === 'donation'
      ? { label: 'Doado', color: '#3B82F6', bg: '#EFF6FF' }
      : { label: 'Resgatado', color: '#20BF6B', bg: '#E8F8F5' };
  }
  // Aberto: cor/rótulo conforme o tipo do alerta.
  return TYPE_STYLE[t] ?? TYPE_STYLE.lost;
};

export default function ChatsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>('open');

  // Permite abrir já numa aba específica (ex: vindo de uma notificação)
  useEffect(() => {
    if (params.tab === 'closed' || params.tab === 'open') {
      setTab(params.tab);
    }
  }, [params.tab]);
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await listUserChats(user.id);
      setChats(data ?? []);
    } catch (e) {
      console.error('Erro ao listar chats', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = chats.filter((c) => c.status === tab);
  const openCount = chats.filter((c) => c.status === 'open').length;
  const closedCount = chats.filter((c) => c.status === 'closed').length;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Text style={styles.headerTitle}>Conversas</Text>
        <Text style={styles.headerSub}>Suas conversas com tutores e buscadores</Text>
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'open' && styles.tabActive]} onPress={() => setTab('open')}>
            <Text style={[styles.tabText, tab === 'open' && styles.tabTextActive]}>Ativas</Text>
            {openCount > 0 && (
              <View style={[styles.tabCount, tab === 'open' && styles.tabCountActive]}>
                <Text style={[styles.tabCountText, tab === 'open' && { color: '#FF4757' }]}>{openCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'closed' && styles.tabActive]} onPress={() => setTab('closed')}>
            <Text style={[styles.tabText, tab === 'closed' && styles.tabTextActive]}>Encerradas</Text>
            {closedCount > 0 && (
              <View style={[styles.tabCount, tab === 'closed' && styles.tabCountActive]}>
                <Text style={[styles.tabCountText, tab === 'closed' && { color: '#FF4757' }]}>{closedCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator size="large" color="#FF4757" style={{ marginTop: 50 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubble-ellipses-outline" size={56} color="#DFE4EA" />
          <Text style={styles.emptyTitle}>
            {tab === 'open' ? 'Nenhuma conversa ativa' : 'Sem conversas encerradas'}
          </Text>
          <Text style={styles.emptySub}>
            {tab === 'open'
              ? 'Toque em um pet no mapa para começar.'
              : 'Quando o tutor encerrar uma conversa, ela aparece aqui.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => {
            const isTutor = item.tutor_id === user?.id;
            const other = isTutor ? item.finder : item.tutor;
            const st = chatState(item);
            const roleLabel = isTutor ? 'Buscador' : 'Tutor';
            return (
              <TouchableOpacity
                style={[styles.chatRow, { borderLeftColor: st.color }]}
                activeOpacity={0.85}
                onPress={() => router.push(`/chat/${item.pet_id}?tutorId=${item.tutor_id}&finderId=${item.finder_id}`)}
              >
                {/* Foto do pet + selo do papel */}
                <View>
                  <Image source={{ uri: item.pets?.main_photo_url }} style={styles.petAvatar} />
                  <View style={[styles.roleTag, { backgroundColor: isTutor ? '#A855F7' : '#FF4757' }]}>
                    <Ionicons name={isTutor ? 'search' : 'person'} size={10} color="#FFF" />
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.petName} numberOfLines={1}>{item.pets?.name ?? 'Pet'}</Text>
                    <Text style={styles.timeText}>
                      {formatDistanceToNow(new Date(item.closed_at ?? item.created_at), { locale: ptBR, addSuffix: true })}
                    </Text>
                  </View>

                  {/* Interlocutor com mini-avatar */}
                  <View style={styles.roleRow}>
                    <Avatar uri={other?.photo_url} size={18} />
                    <Text style={styles.subText} numberOfLines={1}>
                      <Text style={styles.roleLabel}>{roleLabel}: </Text>{other?.full_name ?? '—'}
                    </Text>
                  </View>

                  <View style={styles.rowBottom}>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <View style={[styles.badgeDot, { backgroundColor: st.color }]} />
                      <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
                    </View>
                    {item.source_pet_id && (
                      <View style={styles.aiChip}>
                        <Ionicons name="sparkles" size={11} color="#7C4DFF" />
                        <Text style={styles.aiChipText}>Reconhecimento</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }} />
                    <Ionicons name="chevron-forward" size={18} color="#C7CDD4" />
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
    paddingTop: 70, paddingHorizontal: 24, paddingBottom: 20,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#FFF' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600', marginTop: 2, marginBottom: 16 },
  tabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 14, padding: 4 },
  tab: { flex: 1, height: 40, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  tabActive: { backgroundColor: '#FFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabText: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  tabTextActive: { color: '#FF4757' },
  tabCount: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  tabCountActive: { backgroundColor: '#FFE5E9' },
  tabCountText: { fontSize: 11, fontWeight: '900', color: '#FFF' },

  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginTop: 14 },
  emptySub: { fontSize: 14, color: '#747D8C', textAlign: 'center' },

  chatRow: {
    backgroundColor: '#FFF', borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13,
    borderLeftWidth: 5, borderLeftColor: '#FF4757',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  petAvatar: { width: 58, height: 58, borderRadius: 16, backgroundColor: '#DFE4EA' },
  roleTag: {
    position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FF4757', borderWidth: 2, borderColor: '#FFF', justifyContent: 'center', alignItems: 'center',
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  petName: { fontSize: 16.5, fontWeight: '900', color: '#2F3542', flex: 1, letterSpacing: -0.2 },
  timeText: { fontSize: 11, color: '#A4B0BE', fontWeight: '600' },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  subText: { flex: 1, fontSize: 13, color: '#747D8C', fontWeight: '600' },
  roleLabel: { color: '#A4B0BE', fontWeight: '700' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  aiChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#F3EDFF' },
  aiChipText: { fontSize: 10.5, fontWeight: '800', color: '#7C4DFF' },
});
