import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, Modal, Animated,
  Keyboard, KeyboardEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import {
  getSupportConversation, sendSupportMessage, createSupportTicket,
  SupportMessage, SupportConversation,
} from '../services/api';
import { toast } from '../components/Feedback';

export default function SupportScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  // Empurra a barra de input para cima de forma animada quando o teclado abre.
  // Solução manual (sem KeyboardAvoidingView) porque no Android edge-to-edge do
  // Expo SDK 54 a KAV mede a altura do teclado de forma inconsistente.
  const kbOffset = useRef(new Animated.Value(0)).current;
  // Saber se o teclado está aberto para ajustar o respiro inferior do card do modal
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Anima a subida da barra de input e rola a lista quando o teclado aparece
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      setKeyboardVisible(true);
      const h = e.endCoordinates?.height ?? 0;
      // Android edge-to-edge: a altura reportada NÃO inclui a barra de
      // navegação, então usamos a altura cheia — o paddingBottom da inputBar
      // (= insets.bottom) compensa exatamente essa faixa. No iOS a altura já
      // inclui o home indicator, por isso descontamos insets.bottom.
      const offset = Platform.OS === 'ios' ? Math.max(h - insets.bottom, 0) : h;
      Animated.timing(kbOffset, {
        toValue: offset,
        duration: e.duration || 220,
        useNativeDriver: false,
      }).start();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    };
    const onHide = (e: KeyboardEvent) => {
      setKeyboardVisible(false);
      Animated.timing(kbOffset, {
        toValue: 0,
        duration: e.duration || 220,
        useNativeDriver: false,
      }).start();
    };

    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, [kbOffset, insets.bottom]);

  // Modal de ticket
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);

  // Indicador de digitação (3 pontos animados)
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const typingAnim = useRef<Animated.CompositeAnimation | null>(null);

  const startTyping = useCallback(() => {
    const make = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay(560 - delay),
        ])
      );
    typingAnim.current = Animated.parallel([make(dot1, 0), make(dot2, 140), make(dot3, 280)]);
    typingAnim.current.start();
  }, [dot1, dot2, dot3]);

  const stopTyping = useCallback(() => {
    typingAnim.current?.stop();
    dot1.setValue(0); dot2.setValue(0); dot3.setValue(0);
  }, [dot1, dot2, dot3]);

  // Carrega conversa ao montar
  useEffect(() => {
    if (!user) return;
    getSupportConversation(user.id)
      .then(({ conversation, messages }) => {
        setConversation(conversation);
        setMessages(messages);
      })
      .catch(() => toast.error('Não foi possível carregar o suporte.'))
      .finally(() => setIsLoading(false));
  }, [user]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  // Envia mensagem
  const handleSend = async () => {
    if (!inputText.trim() || isSending || !conversation || !user) return;
    const text = inputText.trim();
    setInputText('');
    setIsSending(true);

    // Adiciona otimisticamente a mensagem do usuário
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, conversation_id: conversation.id, role: 'user', content: text, created_at: new Date().toISOString() },
    ]);
    startTyping();

    try {
      // Com ticket aberto, o backend não responde (a equipe humana assume) e
      // retorna null — nesse caso só mantemos a mensagem do usuário.
      const reply = await sendSupportMessage(user.id, conversation.id, text);
      stopTyping();
      if (reply) setMessages((prev) => [...prev, reply]);
    } catch {
      stopTyping();
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputText(text);
      toast.error('Não foi possível enviar a mensagem. Tente novamente.');
    } finally {
      setIsSending(false);
    }
  };

  // Cria ticket
  const handleCreateTicket = async () => {
    if (!ticketSubject.trim() || !user) return;
    setIsCreatingTicket(true);
    try {
      await createSupportTicket(user.id, conversation?.id ?? null, ticketSubject, ticketDescription);
      setShowTicketModal(false);
      setTicketSubject('');
      setTicketDescription('');
      // Recarrega para mostrar a mensagem de confirmação da IA
      const { conversation: updatedConv, messages: updatedMsgs } = await getSupportConversation(user.id);
      setConversation(updatedConv);
      setMessages(updatedMsgs);
      toast.success('Nossa equipe vai analisar e retornar em breve.', 'Ticket criado! ✅');
    } catch (e: any) {
      toast.error(e.message ?? 'Não foi possível criar o ticket.');
    } finally {
      setIsCreatingTicket(false);
    }
  };

  // Render de cada mensagem
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
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  const ticketCreated = conversation?.status === 'ticket_created';

  return (
    <Animated.View style={{ flex: 1, backgroundColor: '#F1F2F6', paddingBottom: kbOffset }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#2F3542" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.headerAvatar}>
            <Ionicons name="paw" size={18} color="#FFF" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Suporte</Text>
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>
                {ticketCreated ? 'Atendimento humano' : 'IA online'}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.ticketBtn, ticketCreated && styles.ticketBtnDone]}
          onPress={() => !ticketCreated && setShowTicketModal(true)}
          activeOpacity={ticketCreated ? 1 : 0.7}
        >
          <Ionicons
            name={ticketCreated ? 'checkmark-circle' : 'ticket-outline'}
            size={14}
            color={ticketCreated ? '#2ED573' : '#FF4757'}
          />
          <Text style={[styles.ticketBtnText, ticketCreated && styles.ticketBtnTextDone]}>
            {ticketCreated ? 'Ticket aberto' : 'Abrir ticket'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Lista de mensagens */}
      {isLoading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#FF4757" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          style={styles.listFlex}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.list}
          onContentSizeChange={scrollToBottom}
          ListFooterComponent={
            isSending ? (
              <View style={styles.msgRow}>
                <View style={styles.botAvatar}>
                  <Ionicons name="paw" size={15} color="#FFF" />
                </View>
                <View style={styles.typingBubble}>
                  {([dot1, dot2, dot3] as Animated.Value[]).map((dot, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.typingDot,
                        {
                          opacity: dot,
                          transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* Barra de input */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom + 10, 15) }]}>
        <TextInput
          style={styles.input}
          placeholder="Digite sua dúvida..."
          placeholderTextColor="#A4B0BE"
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={1000}
          editable={!isSending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || isSending) && styles.sendBtnOff]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
        >
          <Ionicons name="send" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Modal de ticket */}
      <Modal
        visible={showTicketModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTicketModal(false)}
      >
        <Animated.View style={[styles.modalOverlay, { paddingBottom: kbOffset }]}>
          <View
            style={[
              styles.modalCard,
              // Com teclado aberto, ele cobre a barra de navegação — basta o
              // respiro padrão (24). Fechado, garante espaço acima do menu.
              { paddingBottom: keyboardVisible ? 24 : Math.max(insets.bottom + 16, 24) },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <Ionicons name="ticket-outline" size={20} color="#FF4757" />
              </View>
              <Text style={styles.modalTitle}>Abrir ticket de suporte</Text>
              <TouchableOpacity onPress={() => setShowTicketModal(false)}>
                <Ionicons name="close" size={22} color="#747D8C" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Nossa equipe vai analisar e responder assim que possível.
            </Text>

            <Text style={styles.fieldLabel}>Assunto *</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="Ex: Não consigo sacar meu saldo"
              placeholderTextColor="#A4B0BE"
              value={ticketSubject}
              onChangeText={setTicketSubject}
              maxLength={120}
            />

            <Text style={styles.fieldLabel}>Descrição (opcional)</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextarea]}
              placeholder="Descreva o problema com mais detalhes..."
              placeholderTextColor="#A4B0BE"
              value={ticketDescription}
              onChangeText={setTicketDescription}
              multiline
              numberOfLines={4}
              maxLength={1000}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.submitBtn, (!ticketSubject.trim() || isCreatingTicket) && { opacity: 0.5 }]}
              disabled={!ticketSubject.trim() || isCreatingTicket}
              onPress={handleCreateTicket}
            >
              {isCreatingTicket
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={styles.submitBtnText}>Enviar ticket</Text>
              }
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Header
  header: {
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F2F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF4757',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2F3542',
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#2ED573',
  },
  onlineText: {
    fontSize: 11,
    color: '#2ED573',
    fontWeight: '700',
  },
  ticketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF0F1',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD0D4',
  },
  ticketBtnDone: {
    backgroundColor: '#E8FBF1',
    borderColor: '#B2EDD0',
  },
  ticketBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FF4757',
  },
  ticketBtnTextDone: {
    color: '#2ED573',
  },

  // Loading
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Messages
  listFlex: {
    flex: 1,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 12,
  },
  msgRowUser: {
    flexDirection: 'row-reverse',
  },
  botAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF4757',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleBot: {
    backgroundColor: '#FFF',
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  bubbleUser: {
    backgroundColor: '#FF4757',
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 14,
    color: '#2F3542',
    lineHeight: 20,
    fontWeight: '500',
  },
  bubbleTextUser: {
    color: '#FFF',
  },
  supportAvatar: {
    backgroundColor: '#3498DB',
  },
  supportLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3498DB',
    marginBottom: 3,
  },

  // Typing indicator
  typingBubble: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#A4B0BE',
  },

  // Input bar
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FF4757',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  sendBtnOff: {
    backgroundColor: '#DFE4EA',
    shadowOpacity: 0,
    elevation: 0,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  modalIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF0F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: '#2F3542',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#747D8C',
    fontWeight: '500',
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#747D8C',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: '#F1F2F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#2F3542',
    fontWeight: '500',
    marginBottom: 16,
  },
  fieldTextarea: {
    height: 100,
    textAlignVertical: 'top',
  },
  submitBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FF4757',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    marginTop: 4,
  },
  submitBtnText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 15,
  },
});
