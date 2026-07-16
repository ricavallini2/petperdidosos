import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { getNotifications, markNotificationsRead } from '../../services/api';
import { format, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Notif {
  id: string;
  title: string;
  body?: string;
  type?: string;
  pet_id?: string;
  chat_id?: string;
  ticket_id?: string;
  read: boolean;
  created_at: string;
  pet_name?: string | null;
  pet_status?: string | null;
  sender_name?: string | null;
  chat_status?: string | null;
  chat_tutor_id?: string | null;
  chat_finder_id?: string | null;
  region_alert_id?: string | null;
}

// Metadados visuais por tipo de notificação
const TYPE_META: Record<string, { icon: any; color: string; bg: string }> = {
  message:            { icon: 'chatbubble-ellipses', color: '#3498DB', bg: '#EAF4FB' },
  sighting_match:     { icon: 'eye',                 color: '#F79F1F', bg: '#FFF6E5' },
  sighting_claim:     { icon: 'paw',                 color: '#FF4757', bg: '#FFF0F1' },
  sighting_confirmed: { icon: 'checkmark-circle',    color: '#2ED573', bg: '#E8F8F5' },
  donation_confirmed: { icon: 'home',                color: '#3B82F6', bg: '#EFF6FF' },
  donation_turn:      { icon: 'hand-left',           color: '#3B82F6', bg: '#EFF6FF' },
  donation_closed:    { icon: 'close-circle',        color: '#747D8C', bg: '#F1F2F6' },
  rescue_pending:     { icon: 'checkmark-done-circle', color: '#F79F1F', bg: '#FFF6E5' },
  rescue_confirmed:   { icon: 'trophy',              color: '#2ED573', bg: '#E8F8F5' },
  success_case:       { icon: 'trophy',              color: '#FFA502', bg: '#FFF6E5' },
  withdraw:           { icon: 'cash-outline',        color: '#FFA502', bg: '#FFF6E5' },
  reward:             { icon: 'gift',                color: '#2ED573', bg: '#E8F8F5' },
  support:            { icon: 'headset',             color: '#3498DB', bg: '#EAF4FB' },
  premium_activated:  { icon: 'star',                color: '#FFA502', bg: '#FFF6E5' },
  premium_cancelled:  { icon: 'star-outline',        color: '#747D8C', bg: '#F1F2F6' },
  pet_paused:         { icon: 'pause-circle',        color: '#FFA502', bg: '#FFF6E5' },
  region_alert:       { icon: 'megaphone',           color: '#FF4757', bg: '#FFF0F1' },
  region_alert_paused:{ icon: 'megaphone-outline',   color: '#FFA502', bg: '#FFF6E5' },
  default:            { icon: 'notifications',       color: '#FF4757', bg: '#FFF0F1' },
};
const metaOf = (type?: string) => TYPE_META[type ?? 'default'] ?? TYPE_META.default;

// Agrupa as notificações por janela de tempo
function groupByDate(items: Notif[]) {
  const groups: { key: string; title: string; data: Notif[] }[] = [
    { key: 'today', title: 'Hoje', data: [] },
    { key: 'yesterday', title: 'Ontem', data: [] },
    { key: 'week', title: 'Esta semana', data: [] },
    { key: 'older', title: 'Anteriores', data: [] },
  ];
  items.forEach((n) => {
    const d = new Date(n.created_at);
    if (isToday(d)) groups[0].data.push(n);
    else if (isYesterday(d)) groups[1].data.push(n);
    else if (differenceInCalendarDays(new Date(), d) <= 7) groups[2].data.push(n);
    else groups[3].data.push(n);
  });
  return groups.filter((g) => g.data.length > 0);
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getNotifications(user.id);
      setNotifications(data ?? []);
      // marca como lidas no servidor (a tela mantém o destaque visual nesta sessão)
      markNotificationsRead(user.id).catch(() => {});
    } catch (e) {
      console.error('Erro ao carregar notificações', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unreadCount = notifications.filter((n) => !n.read).length;
  const groups = groupByDate(notifications);

  // Destino do toque na notificação: rota do conteúdo que a originou + rótulo.
  // Retorna null quando não há um destino aplicável.
  const linkFor = (n: Notif): { route: Href; label: string } | null => {
    // Abre a conversa exata quando o chat está identificado; senão, a lista.
    const chatLink = (label: string): { route: Href; label: string } => {
      const closed = n.chat_status === 'closed';
      if (n.pet_id && n.chat_tutor_id && n.chat_finder_id) {
        return {
          route: `/chat/${n.pet_id}?tutorId=${n.chat_tutor_id}&finderId=${n.chat_finder_id}` as Href,
          label,
        };
      }
      return { route: `/(tabs)/chats?tab=${closed ? 'closed' : 'open'}`, label };
    };

    switch (n.type) {
      case 'message':
        return chatLink(n.chat_status === 'closed' ? 'Ver conversa encerrada' : 'Ver conversa');
      // Novos chats (possível avistamento / reconhecimento) e confirmações:
      // levam direto para a conversa correspondente.
      case 'sighting_match':
      case 'sighting_claim':
      case 'sighting_confirmed':
      case 'donation_confirmed':
      case 'donation_turn':
      case 'donation_closed':
        return chatLink('Abrir conversa');
      case 'rescue_pending':
        // A outra parte confirmou o reencontro — abre a conversa para confirmar.
        return chatLink('Confirmar no chat');
      case 'rescue_confirmed':
        return n.pet_id ? { route: `/pet/case/${n.pet_id}`, label: 'Ver ficha do caso' } : null;
      case 'success_case':
        // Caso encerrado — leva direto ao registro do final feliz.
        return n.pet_id ? { route: `/pet/success/${n.pet_id}` as Href, label: 'Registrar final feliz' } : null;
      case 'withdraw':
        return { route: '/profile/wallet', label: 'Ver carteira' };
      case 'support':
        // Abre o chamado exato quando há referência; senão, a lista.
        return n.ticket_id
          ? { route: `/profile/ticket/${n.ticket_id}` as Href, label: 'Ver chamado' }
          : { route: '/profile/tickets', label: 'Ver meus chamados' };
      case 'premium_activated':
      case 'premium_cancelled':
        return { route: '/profile/premium', label: 'Ver Premium' };
      case 'pet_paused':
        return { route: '/(tabs)/profile', label: 'Ver meus alertas' };
      case 'region_alert':
        return n.region_alert_id ? { route: `/region-alert/${n.region_alert_id}` as Href, label: 'Ver alerta' } : null;
      case 'region_alert_paused':
        return { route: '/(tabs)/profile', label: 'Ver meus alertas' };
      default:
        // Qualquer notificação vinculada a um chat abre a conversa.
        if (n.pet_id && n.chat_tutor_id && n.chat_finder_id) {
          return chatLink('Abrir conversa');
        }
        return null;
    }
  };

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
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Notificações</Text>
          {unreadCount > 0 && (
            <Text style={styles.headerSub}>{unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'}</Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      {loading ? (
        <ActivityIndicator size="large" color="#FF4757" style={{ marginTop: 60 }} />
      ) : notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={48} color="#A4B0BE" />
          </View>
          <Text style={styles.emptyTitle}>Nenhuma notificação</Text>
          <Text style={styles.emptyText}>
            Avisos sobre mensagens, resgates e pagamentos vão aparecer aqui.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FF4757" />
          }
        >
          {groups.map((group) => (
            <View key={group.key} style={{ marginBottom: 8 }}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              {group.data.map((n) => {
                const meta = metaOf(n.type);
                const link = linkFor(n);
                const Row: any = link ? TouchableOpacity : View;
                return (
                  <Row
                    key={n.id}
                    style={[styles.card, !n.read && styles.cardUnread]}
                    {...(link ? { onPress: () => router.push(link.route), activeOpacity: 0.7 } : {})}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={22} color={meta.color} />
                    </View>
                    <View style={styles.textWrap}>
                      <View style={styles.titleRow}>
                        <Text style={[styles.title, !n.read && styles.titleUnread]} numberOfLines={1}>
                          {n.type === 'message' && n.sender_name ? n.sender_name : n.title}
                        </Text>
                        {!n.read && <View style={styles.unreadDot} />}
                      </View>

                      {/* Contexto: sobre qual alerta é a mensagem */}
                      {n.type === 'message' && n.pet_name ? (
                        <View style={styles.contextRow}>
                          <Ionicons name="paw" size={11} color="#A4B0BE" />
                          <Text style={styles.contextText} numberOfLines={1}>
                            Mensagem sobre <Text style={styles.contextStrong}>{n.pet_name}</Text>
                            {n.chat_status === 'closed' ? ' · encerrada' : ''}
                          </Text>
                        </View>
                      ) : null}

                      {n.body ? (
                        <Text
                          style={[styles.body, n.type === 'message' && { fontStyle: 'italic' }]}
                          numberOfLines={2}
                        >
                          {n.type === 'message' ? `"${n.body}"` : n.body}
                        </Text>
                      ) : null}
                      <View style={styles.metaRow}>
                        <Text style={styles.time}>
                          {format(new Date(n.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                        </Text>
                        {link && (
                          <View style={styles.tapHint}>
                            <Text style={[styles.tapHintText, { color: meta.color }]} numberOfLines={1}>{link.label}</Text>
                            <Ionicons name="chevron-forward" size={12} color={meta.color} />
                          </View>
                        )}
                      </View>
                    </View>
                  </Row>
                );
              })}
            </View>
          ))}
          <View style={{ height: 50 }} />
        </ScrollView>
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
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '700', marginTop: 1 },

  content: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },

  groupTitle: {
    fontSize: 12, fontWeight: '800', color: '#747D8C',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 8, marginLeft: 4,
  },

  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  cardUnread: {
    borderLeftWidth: 3, borderLeftColor: '#FF4757',
  },
  iconWrap: {
    width: 46, height: 46, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  textWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: '#2F3542', flex: 1 },
  titleUnread: { fontWeight: '900' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4757', marginLeft: 6 },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  contextText: { fontSize: 12, color: '#A4B0BE', fontWeight: '600', flex: 1 },
  contextStrong: { color: '#FF4757', fontWeight: '800' },
  body: { fontSize: 13, color: '#747D8C', lineHeight: 19, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 },
  time: { fontSize: 11, color: '#A4B0BE', fontWeight: '500', flexShrink: 0, marginRight: 8 },
  tapHint: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1, minWidth: 0 },
  tapHintText: { fontSize: 12, fontWeight: '800', flexShrink: 1 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 18,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#2F3542', marginBottom: 6 },
  emptyText: { fontSize: 14, color: '#A4B0BE', textAlign: 'center', lineHeight: 20 },
});
