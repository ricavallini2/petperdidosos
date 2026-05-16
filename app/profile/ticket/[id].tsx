import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Animated, Keyboard, KeyboardEvent, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../../../contexts/AuthContext';
import {
  getTicketDetail, sendSupportMessage,
  SupportTicket, SupportMessage, SupportTicketStatus,
} from '../../../services/api';
import { toast } from '../../../components/Feedback';

const STATUS_META: Record<SupportTicketStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Aguardando',   color: '#FFA502', bg: '#FFF6E5' },
  in_progress: { label: 'Em andamento', color: '#3498DB', bg: '#EAF4FC' },
  resolved:    { label: 'Resolvido',    color: '#2ED573', bg: '#E8FBF1' },
  closed:      { label: 'Encerrado',    color: '#747D8C', bg: '#F1F2F6' },
};

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const kbOffset = useRef(new Animated.Value(0)).current;

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  // Evita que o polling sobrescreva a mensagem otimista durante um envio.
  const sendingRef = useRef(false);

  // Sobe a barra de input com o teclado (mesmo padrão da Central de Ajuda).
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => {
      const h = e.endCoordinates?.height ?? 0;
      const offset = Platform.OS === 'ios' ? Math.max(h - insets.bottom, 0) : h;
      Animated.timing(kbOffset, { toValue: offset, duration: e.duration || 220, useNativeDriver: false }).start();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    };
    const onHide = (e: KeyboardEvent) => {
      Animated.timing(kbOffset, { toValue: 0, duration: e.duration || 220, useNativeDriver: false }).start();
    };
    const s = Keyboard.addListener(showEvt, onShow);
    const h = Keyboard.addListener(hideEvt, onHide);
    return () => { s.remove(); h.remove(); };
  }, [kbOffset, insets.bottom]);

  // silent = atualização em segundo plano (polling): não mostra spinner nem
  // troca a tela por erro em caso de falha de rede pontual.
  const fetchDetail = useCallback(async (silent: boolean) => {
    if (!user || !id) return;
    if (silent && sendingRef.current) return; // não recarrega no meio de um envio
    try {
      const data = await getTicketDetail(String(id), user.id);
      setTicket(data.ticket);
      setMessages(data.messages);
      setError(false);
    } catch {
      if (!silent) setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, id]);

  // Atualiza automaticamente enquanto a tela está aberta (estilo chat) —
  // novas respostas da equipe aparecem sozinhas, sem sair e voltar.
  useFocusEffect(
    useCallback(() => {
      fetchDetail(false);
      const interval = setInterval(() => fetchDetail(true), 4000);
      return () => clearInterval(interval);
    }, [fetchDetail])
  );

  const handleSend = async () => {
    if (!inputText.trim() || sending || !ticket?.conversation_id || !user) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);
    sendingRef.current = true;
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, conversation_id: ticket.conversation_id!, role: 'user', content: text, created_at: new Date().toISOString() },
    ]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      await sendSupportMessage(user.id, ticket.conversation_id, text);
      sendingRef.current = false;
      await fetchDetail(true);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputText(text);
      toast.error('Não foi possível enviar a mensagem. Tente novamente.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const meta = ticket ? (STATUS_META[ticket.status] ?? STATUS_META.pending) : STATUS_META.pending;
  const canReply = !!ticket?.conversation_id && (ticket?.status === 'pending' || ticket?.status === 'in_progress');

  const renderMessage = ({ item }: { item: SupportMessage }) => {
    const isUser = item.role === 'user';
    const isSupport = item.role === 'support';
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={[styles.botAvatar, isSupport && styles.supportAvatar]}>
            <Ionicons name={isSupport ? 'headset' : 'paw'} size={15} color="#FFF" />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
          {isSupport && <Text style={styles.supportLabel}>Equipe de Suporte</Text>}
          {item.role === 'assistant' && <Text style={styles.assistantLabel}>Assistente virtual</Text>}
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{item.content}</Text>
        </View>
      </View>
    );
  };

  const Header = (
    <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={24} color="#2F3542" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>
        {id ? `Chamado #${String(id).slice(0, 8).toUpperCase()}` : 'Chamado'}
      </Text>
      <View style={{ width: 38 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {Header}
        <View style={styles.center}><ActivityIndicator size="large" color="#FF4757" /></View>
      </View>
    );
  }

  if (error || !ticket) {
    return (
      <View style={styles.container}>
        {Header}
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={52} color="#DFE4EA" />
          <Text style={styles.errorTitle}>Não foi possível abrir o chamado</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchDetail(false); }}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const summary = (
    <View style={styles.summary}>
      <View style={styles.summaryTop}>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <View style={[styles.badgeDot, { backgroundColor: meta.color }]} />
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.summaryDate}>
          {format(new Date(ticket.created_at), "dd/MM/yyyy", { locale: ptBR })}
        </Text>
      </View>
      <Text style={styles.subject}>{ticket.subject}</Text>
      {!!ticket.description?.trim() && (
        <Text style={styles.summaryDesc}>{ticket.description}</Text>
      )}
      <Text style={styles.threadLabel}>Conversa</Text>
    </View>
  );

  return (
    <Animated.View style={[styles.container, { paddingBottom: kbOffset }]}>
      {Header}

      <FlatList
        ref={listRef}
        data={messages}
        style={{ flex: 1 }}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        ListHeaderComponent={summary}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={styles.noMessages}>
            Ainda não há mensagens nesta conversa. Nossa equipe responde por aqui.
          </Text>
        }
      />

      {canReply ? (
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom + 10, 15) }]}>
          <TextInput
            style={styles.input}
            placeholder="Escreva uma resposta..."
            placeholderTextColor="#A4B0BE"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnOff]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#FFF" />
              : <Ionicons name="send" size={18} color="#FFF" />}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.closedBar, { paddingBottom: Math.max(insets.bottom + 10, 15) }]}>
          <Ionicons name="lock-closed" size={15} color="#747D8C" />
          <Text style={styles.closedText}>Este chamado foi encerrado.</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  headerBar: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#2F3542' },

  errorTitle: { fontSize: 16, fontWeight: '800', color: '#2F3542', marginTop: 12, textAlign: 'center' },
  retryBtn: {
    marginTop: 18, backgroundColor: '#FF4757',
    paddingHorizontal: 22, height: 46, borderRadius: 14, justifyContent: 'center',
  },
  retryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  list: { padding: 16, paddingBottom: 8 },

  // Cartão-resumo do chamado
  summary: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  summaryDate: { fontSize: 12, color: '#A4B0BE', fontWeight: '700' },
  subject: { fontSize: 17, fontWeight: '900', color: '#2F3542', marginTop: 10, lineHeight: 23 },
  summaryDesc: { fontSize: 14, color: '#57606F', fontWeight: '500', marginTop: 6, lineHeight: 20 },
  threadLabel: {
    fontSize: 12, fontWeight: '800', color: '#A4B0BE', textTransform: 'uppercase',
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F1F2F6',
  },

  noMessages: {
    fontSize: 13, color: '#A4B0BE', fontWeight: '500',
    textAlign: 'center', paddingHorizontal: 20, lineHeight: 19,
  },

  // Mensagens
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  msgRowUser: { flexDirection: 'row-reverse' },
  botAvatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#FF4757',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  supportAvatar: { backgroundColor: '#3498DB' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleBot: {
    backgroundColor: '#FFF',
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  bubbleUser: { backgroundColor: '#FF4757', borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: '#2F3542', lineHeight: 20, fontWeight: '500' },
  bubbleTextUser: { color: '#FFF' },
  supportLabel: { fontSize: 11, fontWeight: '800', color: '#3498DB', marginBottom: 3 },
  assistantLabel: { fontSize: 11, fontWeight: '800', color: '#FF4757', marginBottom: 3 },

  // Barra de input
  inputBar: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 6,
  },
  input: {
    flex: 1,
    backgroundColor: '#F1F2F6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: '#2F3542',
    maxHeight: 120,
    fontWeight: '500',
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#FF4757',
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnOff: { backgroundColor: '#DFE4EA' },

  closedBar: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 6,
  },
  closedText: { fontSize: 13, color: '#747D8C', fontWeight: '700' },
});
