import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Modal, Keyboard, Animated, Dimensions, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { requestMapFocus } from '../../utils/mapFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { getMessages, sendMessage, getPetDetails, listUserChats, closeChat, confirmRescueByChat, getPublicProfile, reportUser, rateUser, confirmSighting, cancelChat, confirmDonation, getDonationQueue, getDonationConfig } from '../../services/api';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../services/supabase';
import { formatDistanceToNow, format, isSameDay, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast, showConfirm } from '../../components/Feedback';
import { Avatar } from '../../components/Avatar';

export default function ChatScreen() {
  const { id: petId, tutorId: tutorIdParam, finderId: finderIdParam } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  // Polling: evita buscas concorrentes (uma de cada vez) e conta ciclos para
  // atualizar o status do chat com menos frequência.
  const fetchingRef = useRef(false);
  const pollCountRef = useRef(0);

  const [pet, setPet] = useState<any>(null);
  const [chat, setChat] = useState<any>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [otherProfile, setOtherProfile] = useState<any>(null);
  const [myProfile, setMyProfile] = useState<any>(null);
  const [profileToShow, setProfileToShow] = useState<any>(null);

  // Denúncia
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [reportTargetName, setReportTargetName] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  // Avaliação
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingScore, setRatingScore] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [isRating, setIsRating] = useState(false);
  // Doação voluntária (Pix/link externos, do admin). Mostrada na conclusão positiva.
  const [donation, setDonation] = useState<{ pixKey: string | null; url: string | null }>({ pixKey: null, url: null });
  useEffect(() => { getDonationConfig().then(setDonation).catch(() => {}); }, []);

  // Confirmação de avistamento (chat vinculado a um alerta visto/resgatado)
  const [confirming, setConfirming] = useState(false);
  const [confirmedNow, setConfirmedNow] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [relatedPhoto, setRelatedPhoto] = useState<string | null>(null);
  const [relatedType, setRelatedType] = useState<string | null>(null); // tipo do alerta de origem (sighted/rescued)
  const [queue, setQueue] = useState<{ position: number; total: number } | null>(null); // fila de adoção

  const scrollViewRef = useRef<ScrollView>(null);

  // Avoidance do teclado controlado manualmente: o KeyboardAvoidingView com
  // behavior="padding" deixava resíduo ao fechar (campo "perdido" pra cima).
  // Animamos o paddingBottom do container a partir dos eventos do teclado, o que
  // garante o reset exato para 0 quando ele desce.
  const kbPad = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      // No Android edge-to-edge o endCoordinates.height é inconfiável; a altura
      // real do teclado = altura da tela − topo (screenY) do teclado.
      const screenH = Dimensions.get('screen').height;
      const kbTop = e?.endCoordinates?.screenY ?? screenH;
      const kbHeight = Math.max(e?.endCoordinates?.height ?? 0, screenH - kbTop);
      // Desconta a safe-area inferior (já embutida no padding da barra de input).
      const target = Math.max(0, kbHeight - insets.bottom);
      Animated.timing(kbPad, {
        toValue: target,
        duration: Platform.OS === 'ios' ? (e?.duration ?? 250) : 150,
        useNativeDriver: false,
      }).start(() => requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true })));
    };
    const onHide = (e: any) => {
      Animated.timing(kbPad, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e?.duration ?? 200) : 150,
        useNativeDriver: false,
      }).start(() => requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: false })));
    };

    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => { subShow.remove(); subHide.remove(); };
  }, [insets.bottom, kbPad]);

  const isTutor = !!pet && !!user && pet.user_id === user.id;
  const isDonation = pet?.type === 'donation';
  const tutorId = (tutorIdParam as string) || pet?.user_id;
  // "outro participante" = quem não é o user. Vem do URL quando possível.
  const otherId = (() => {
    if (!user) return undefined;
    if (tutorIdParam && tutorIdParam === user.id && finderIdParam) return finderIdParam as string;
    if (tutorIdParam && tutorIdParam !== user.id) return tutorIdParam as string;
    if (finderIdParam && finderIdParam !== user.id) return finderIdParam as string;
    return undefined;
  })();
  const isInvalidChat = !!user && (otherId === user.id || (!otherId && !!tutorIdParam && tutorIdParam === user.id && !finderIdParam));

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const data = await getPetDetails(petId as string);
        setPet(data);
      } catch (e) {
        console.warn(e);
      }
    })();
  }, [user, petId]);

  useEffect(() => {
    if (!otherId) return;
    getPublicProfile(otherId).then(setOtherProfile).catch(() => {});
  }, [otherId]);

  useEffect(() => {
    if (!user) return;
    getPublicProfile(user.id).then(setMyProfile).catch(() => {});
  }, [user]);

  // Foto do alerta relacionado: tutor vê o pet VISTO (source_pet_id); quem viu
  // vê o pet PERDIDO (chat.pet_id).
  useEffect(() => {
    if (!chat?.source_pet_id || !user) { setRelatedPhoto(null); setRelatedType(null); return; }
    const amTutor = chat.tutor_id === user.id;
    const relatedId = amTutor ? chat.source_pet_id : chat.pet_id;
    let cancelled = false;
    // Carrega a foto do alerta relacionado e, para o tutor, o TIPO do alerta de
    // origem (source_pet_id) — usado para diferenciar resgate de avistamento.
    getPetDetails(relatedId)
      .then((d: any) => { if (!cancelled) setRelatedPhoto(d?.main_photo_url ?? null); })
      .catch(() => {});
    getPetDetails(chat.source_pet_id)
      .then((d: any) => { if (!cancelled) setRelatedType(d?.type ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [chat?.source_pet_id, chat?.pet_id, chat?.tutor_id, user?.id]);

  useEffect(() => {
    if (!user || !otherId || isInvalidChat) return;
    let cancelled = false;
    const tick = async () => {
      if (fetchingRef.current) return; // trava: não dispara se a anterior não voltou
      fetchingRef.current = true;
      pollCountRef.current += 1;
      try {
        // O status do chat (encerrado/fila) muda raramente: só no 1º ciclo e a cada 4.
        await fetchChat({ isCancelled: () => cancelled, refreshStatus: pollCountRef.current % 4 === 1 });
      } finally {
        fetchingRef.current = false;
      }
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, petId, otherId, isInvalidChat]);

  const fetchChat = async (opts?: { isCancelled?: () => boolean; refreshStatus?: boolean }) => {
    if (!user || !otherId) return;
    const isCancelled = opts?.isCancelled ?? (() => false);
    const refreshStatus = opts?.refreshStatus ?? true; // chamadas diretas (após enviar) sempre atualizam
    try {
      const data = await getMessages(petId as string, user.id, otherId);
      if (isCancelled()) return;
      // Reconcilia: mantém mensagens otimistas (pending) que o servidor ainda não
      // devolveu, para a mensagem recém-enviada NÃO "piscar" (sumir e voltar).
      setMessages((prev) => {
        const stillPending = prev.filter(
          (m: any) => m.pending && !data.some((s: any) => s.sender_id === m.sender_id && s.content === m.content),
        );
        return stillPending.length ? [...data, ...stillPending] : data;
      });
      // Descobre o chat ATUAL pelo par (pet + o outro participante). Filtrar só
      // por pet_id pegava o chat errado quando o usuário tem mais de uma conversa
      // sobre o mesmo pet (ex.: doador com vários interessados).
      if (refreshStatus) {
        try {
          const chats = await listUserChats(user.id);
          if (isCancelled()) return;
          const current = chats.find((c: any) =>
            c.pet_id === petId &&
            ((c.tutor_id === user.id && c.finder_id === otherId) ||
             (c.finder_id === user.id && c.tutor_id === otherId))
          );
          setChat(current ?? null);
          // Fila de adoção (só para doação): posição/total deste chat.
          if (current?.id && current.pets?.type === 'donation' && current.status === 'open') {
            getDonationQueue(current.id)
              .then((q) => { if (!isCancelled()) setQueue(q.isDonation ? { position: q.position, total: q.total } : null); })
              .catch(() => {});
          } else {
            setQueue(null);
          }
        } catch {}
      }
      if (!isCancelled()) setIsLoading(false);
    } catch (error) {
      console.error(error);
    }
  };

  const chatClosed = chat?.status === 'closed';

  // Cancelar chat (encerrar a conversa) — disponível para ambos.
  const handleCancelChat = () => {
    if (!chat || cancelling) return;
    showConfirm({
      title: 'Cancelar chat',
      message: 'Deseja encerrar esta conversa?',
      confirmText: 'Cancelar chat',
      cancelText: 'Voltar',
      destructive: true,
      onConfirm: async () => {
        try {
          setCancelling(true);
          await cancelChat(chat.id);
          await fetchChat();
          toast.success('Chat encerrado.');
        } catch (e: any) {
          toast.error(e?.message ?? 'Erro ao cancelar.');
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  const handleConfirmSighting = async () => {
    if (!chat?.id || confirming) return;
    setConfirming(true);
    try {
      const r = await confirmSighting(chat.id);
      setConfirmedNow(true);
      await fetchChat(); // o caso pode ter sido encerrado (resgate)
      if (r.rescued) {
        toast.success(
          r.pending
            ? 'Sua confirmação foi registrada. Aguardando quem resgatou confirmar para encerrar.'
            : 'Reencontro confirmado pelos dois! O caso foi encerrado.',
          r.pending ? 'Quase lá! 🐾' : 'Resgate concluído',
        );
      } else {
        toast.success('Confirmado! O avistamento entrou na linha do tempo do caso.', 'É o seu pet!');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Não foi possível confirmar.');
    } finally {
      setConfirming(false);
    }
  };

  // DOAÇÃO: o doador (tutor) confirma a adoção, relacionando este adotante.
  const handleConfirmDonation = async () => {
    if (!chat?.id || confirming) return;
    setConfirming(true);
    try {
      await confirmDonation(chat.id);
      setConfirmedNow(true);
      await fetchChat();
      toast.success('Doação confirmada! O pet foi adotado por este usuário.', 'Doação concluída');
    } catch (e: any) {
      toast.error(e?.message ?? 'Não foi possível confirmar a doação.');
    } finally {
      setConfirming(false);
    }
  };

  // Layout da introdução: o usuário LOGADO sempre à direita; o outro à esquerda.
  // O papel (Tutor/Buscador) acompanha a pessoa — fonte da verdade é o chat.
  const iAmTutor = chat ? chat.tutor_id === user?.id : isTutor;
  const ROLE = {
    tutor: { label: 'Tutor', color: '#FF4757', bg: '#FFF0F1' },
    buscador: { label: 'Buscador', color: '#A855F7', bg: '#F3EDFF' },
  };
  const meRole = iAmTutor ? ROLE.tutor : ROLE.buscador;
  const otherRole = iAmTutor ? ROLE.buscador : ROLE.tutor;
  // Já confirmado? (mensagem de sistema do "avistamento adicionado ao caso" ou confirmação nesta sessão)
  const alreadyConfirmed = confirmedNow || messages.some((m: any) => m.system);

  // Card do alerta relacionado — renderizado dentro da conversa, após a 1ª mensagem.
  const relatedAlertCard = chat?.source_pet_id ? (
    <View style={styles.sourceCard}>
      <View style={styles.sourceRow}>
        {relatedPhoto
          ? <Image source={{ uri: relatedPhoto }} style={styles.sourceThumb} />
          : <View style={styles.sourceThumbFallback}><Ionicons name="paw" size={18} color="#3B5BDB" /></View>}
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceTitle}>{relatedType === 'rescued' ? 'Pet resgatado' : 'Alerta relacionado'}</Text>
          <Text style={styles.sourceSub}>
            {isTutor
              ? (relatedType === 'rescued'
                  ? 'Confirme que é o seu pet para concluir o resgate.'
                  : 'Veja o pet que foi visto e confirme se é o seu.')
              : 'Veja o alerta de pet perdido do tutor para conferir.'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.sourceViewBtn}
          onPress={() => {
            const target = String(isTutor ? chat?.source_pet_id : chat?.pet_id);
            requestMapFocus(target, true);
            router.navigate('/(tabs)');
          }}
        >
          <Text style={styles.sourceViewText}>Ver alerta</Text>
        </TouchableOpacity>
      </View>
      {isTutor && !chatClosed && !alreadyConfirmed && (
        <TouchableOpacity style={styles.confirmSightingBtn} onPress={handleConfirmSighting} disabled={confirming}>
          {confirming
            ? <ActivityIndicator color="#FFF" size="small" />
            : <><Ionicons name="checkmark-circle" size={18} color="#FFF" /><Text style={styles.confirmSightingText}>{relatedType === 'rescued' ? 'É o meu pet — confirmar resgate' : 'É o meu pet — confirmar'}</Text></>}
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  // Card de doação — chat direto no alerta de doação (sem source_pet_id).
  // O doador (tutor) confirma a adoção, relacionando este adotante ao pet.
  const donationCard = (pet?.type === 'donation' && !chat?.source_pet_id) ? (
    <View style={styles.sourceCard}>
      <View style={styles.sourceRow}>
        <View style={[styles.sourceThumbFallback, { backgroundColor: '#EFF6FF' }]}><Ionicons name="gift" size={18} color="#3B82F6" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceTitle}>Doação de pet</Text>
          <Text style={styles.sourceSub}>
            {iAmTutor
              ? 'Converse com o interessado. Ao definir o adotante, toque em “Confirmar doação” no topo para concluir.'
              : 'Converse com o doador sobre as regras de adoção e seu interesse.'}
          </Text>
        </View>
      </View>

      {/* Fila de adoção */}
      {!chatClosed && queue && queue.total > 0 && (
        iAmTutor ? (
          // Doador: vê o tamanho da fila e a ordem deste interessado.
          <View style={styles.queueBanner}>
            <Ionicons name="people-outline" size={16} color="#3B82F6" />
            <Text style={styles.queueText}>
              {queue.total === 1
                ? 'Apenas este interessado na fila.'
                : `${queue.total} interessados na fila. Este é o ${queue.position}º a chamar.`}
            </Text>
          </View>
        ) : queue.position === 1 ? (
          // Adotante na vez.
          <View style={[styles.queueBanner, styles.queueBannerTurn]}>
            <Ionicons name="hand-left" size={16} color="#1E7E47" />
            <Text style={[styles.queueText, { color: '#1E7E47' }]}>
              É a sua vez! Converse com o doador sobre a adoção.
            </Text>
          </View>
        ) : (
          // Adotante aguardando na fila.
          <View style={styles.queueBanner}>
            <Ionicons name="time-outline" size={16} color="#3B82F6" />
            <Text style={styles.queueText}>
              Fila de adoção • você é o {queue.position}º de {queue.total}. Avisaremos quando for a sua vez.
            </Text>
          </View>
        )
      )}
    </View>
  ) : null;

  const handleSend = async () => {
    if (!inputText.trim() || !user || !otherId) return;
    if (chatClosed) return;
    const text = inputText;
    setInputText('');
    setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, pending: true, sender_id: user.id, content: text, created_at: new Date().toISOString() }]);
    try {
      setIsSending(true);
      await sendMessage(petId as string, user.id, otherId, text);
      await fetchChat();
    } catch (error: any) {
      toast.error(error?.message ?? 'Tente novamente.', 'Erro ao enviar');
    } finally {
      setIsSending(false);
    }
  };

  const handlePickImage = async () => {
    if (chatClosed) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return toast.warning('Permissão negada para acessar a galeria.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (result.canceled || !result.assets?.length) return;

    try {
      setIsSending(true);
      const photoUri = result.assets[0].uri;
      const ext = photoUri.substring(photoUri.lastIndexOf('.') + 1) || 'jpg';
      const fileName = `chat_${Date.now()}.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(photoUri, { encoding: 'base64' });
      const { error: uploadError } = await supabase.storage
        .from('pets')
        .upload(fileName, decode(base64), { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('pets').getPublicUrl(fileName);
      await sendMessage(petId as string, user!.id, otherId!, undefined, data.publicUrl);
      await fetchChat();
    } catch (error: any) {
      toast.error(error?.message ?? 'Tente novamente.', 'Erro ao enviar foto');
    } finally {
      setIsSending(false);
    }
  };

  const handleCloseWithoutFound = async () => {
    if (!chat || !user) return;
    showConfirm({
      title: 'Encerrar conversa',
      message: 'O pet NÃO foi encontrado por este buscador?',
      confirmText: 'Encerrar',
      cancelText: 'Cancelar',
      destructive: true,
      onConfirm: async () => {
        try {
          setIsClosing(true);
          await closeChat(chat.id, user.id, false);
          await fetchChat();
        } catch (e: any) {
          toast.error(e?.message ?? 'Tente novamente.', 'Erro ao encerrar');
        } finally {
          setIsClosing(false);
        }
      },
    });
  };

  const handleConfirmFound = async () => {
    if (!chat || !user) return;
    try {
      setIsClosing(true);
      const result = await confirmRescueByChat(chat.id, user.id);
      setShowCloseModal(false);
      await fetchChat();
      if (result?.pending) {
        toast.success('Sua confirmação foi registrada. Aguardando a outra pessoa confirmar para encerrar o caso.', 'Quase lá! 🐾');
        return;
      }
      // Ambos confirmaram → caso encerrado: abre a avaliação mútua.
      setRatingScore(0);
      setRatingComment('');
      setShowRatingModal(true);
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao confirmar.');
    } finally {
      setIsClosing(false);
    }
  };

  const handleSubmitRating = async (skip = false) => {
    setShowRatingModal(false);
    if (!skip && user && otherId && ratingScore > 0) {
      try {
        setIsRating(true);
        await rateUser({
          petId:   petId as string,
          raterId: user.id,
          ratedId: otherId,
          score:   ratingScore,
          comment: ratingComment.trim() || undefined,
        });
      } catch (e: any) {
        // silencia erro de avaliação para não bloquear o fluxo
        console.warn('Erro ao avaliar:', e?.message);
      } finally {
        setIsRating(false);
      }
    }
    // Conclusão positiva: agradece (o card de doação aparece no chat encerrado).
    toast.success('Obrigado por usar o PetPerdidoSOS! 💚', 'Reencontro confirmado! 🎉');
  };

  const handleOpenReport = (targetProfile: any) => {
    setProfileToShow(null);          // fecha o card de perfil
    setReportTargetId(targetProfile?.id ?? null);
    setReportTargetName(targetProfile?.full_name ?? 'este usuário');
    setReportReason('');
    setShowReportModal(true);
  };

  const handleSubmitReport = async () => {
    if (!user || !reportTargetId || !reportReason.trim()) return;
    try {
      setIsReporting(true);
      await reportUser({
        reporterId: user.id,
        reportedId: reportTargetId,
        chatId: chat?.id,
        petId:  petId as string,
        reason: reportReason.trim(),
      });
      setShowReportModal(false);
      setReportReason('');
      toast.success('Recebemos sua denúncia. Nossa equipe irá analisá-la em breve.', 'Denúncia enviada');
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao enviar denúncia.');
    } finally {
      setIsReporting(false);
    }
  };

  if (isInvalidChat) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Ionicons name="alert-circle" size={56} color="#FFA502" />
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#2F3542', marginTop: 12 }}>Chat indisponível</Text>
        <Text style={{ fontSize: 14, color: '#747D8C', marginTop: 6, textAlign: 'center' }}>
          Você não pode conversar consigo mesmo. Acesse a aba <Text style={{ fontWeight: '800' }}>Chats</Text> para ver suas conversas com buscadores.
        </Text>
        <TouchableOpacity
          style={{ marginTop: 24, backgroundColor: '#FF4757', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 }}
          onPress={() => router.replace('/(tabs)/chats')}
        >
          <Text style={{ color: '#FFF', fontWeight: '800' }}>Ver meus chats</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: '#747D8C', fontWeight: '600' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { paddingBottom: kbPad }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#2F3542" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {pet && <Image source={{ uri: pet.main_photo_url }} style={styles.headerAvatar} />}
          <View>
            <Text style={styles.headerTitle}>{pet?.name ?? 'Chat'}</Text>
            <Text style={styles.headerSubtitle}>
              {chatClosed ? 'Encerrado' : isTutor ? 'Conversa com buscador' : 'Conversa com tutor'}
            </Text>
          </View>
        </View>
        {!chatClosed && chat ? (
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleCancelChat} disabled={cancelling} style={styles.headerAction}>
              <View style={styles.cancelHeaderBtn}><Ionicons name="close" size={20} color="#FF4757" /></View>
              <Text style={[styles.headerActionLabel, { color: '#FF4757' }]} numberOfLines={2}>Encerrar Chat</Text>
            </TouchableOpacity>
            {isDonation ? (
              // Doação: só o doador (tutor) confirma a adoção, relacionando o adotante.
              isTutor && !alreadyConfirmed && (
                <TouchableOpacity activeOpacity={0.85} onPress={handleConfirmDonation} disabled={confirming} style={styles.headerAction}>
                  <LinearGradient
                    colors={['#60A5FA', '#3B82F6']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.confirmHeaderBtn}
                  >
                    {confirming
                      ? <ActivityIndicator size="small" color="#FFF" />
                      : <Ionicons name="heart-circle" size={20} color="#FFF" />}
                  </LinearGradient>
                  <Text style={[styles.headerActionLabel, { color: '#3B82F6' }]} numberOfLines={1}>Confirmar doação</Text>
                </TouchableOpacity>
              )
            ) : (
              // Reencontro: AMBOS confirmam (dupla confirmação) — encerra quando os dois marcarem.
              <TouchableOpacity activeOpacity={0.85} onPress={() => setShowCloseModal(true)} style={styles.headerAction}>
                <LinearGradient
                  colors={['#2ED573', '#26B765']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.confirmHeaderBtn}
                >
                  <Ionicons name="checkmark-done" size={20} color="#FFF" />
                </LinearGradient>
                <Text style={[styles.headerActionLabel, { color: '#26B765' }]} numberOfLines={1}>Reencontrei</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {chatClosed && (
        <View style={styles.closedBanner}>
          <Ionicons name="lock-closed" size={16} color="#747D8C" />
          <Text style={styles.closedBannerText}>
            {chat?.found
              ? (isDonation ? 'Doação confirmada neste chat.' : 'Resgate confirmado neste chat.')
              : 'Chat encerrado pelo tutor.'}
          </Text>
        </View>
      )}

      {chatClosed && chat?.found && !isDonation && (donation.pixKey || donation.url) && (
        <View style={styles.donationCard}>
          <Ionicons name="heart" size={20} color="#FF4757" />
          <View style={{ flex: 1 }}>
            <Text style={styles.donationTitle}>Apoie o PetPerdidoSOS 💚</Text>
            <Text style={styles.donationSub}>Que bom que deu certo! Uma doação voluntária ajuda a manter o app no ar — totalmente opcional.</Text>
            {!!donation.pixKey && (
              <Text style={styles.donationPix} selectable>Pix: {donation.pixKey}</Text>
            )}
            {!!donation.url && (
              <TouchableOpacity style={styles.donationBtn} activeOpacity={0.85} onPress={() => Linking.openURL(donation.url!)}>
                <Ionicons name="open-outline" size={15} color="#FFF" />
                <Text style={styles.donationBtnText}>Fazer uma doação</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <ScrollView
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {!isLoading && pet && (
          <View style={styles.introCard}>
            {/* Outro participante — à esquerda */}
            <View style={styles.introSide}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={!otherProfile}
                onPress={() => otherProfile && setProfileToShow(otherProfile)}
              >
                <Avatar uri={otherProfile?.photo_url} size={52} style={styles.introAvatar} />
              </TouchableOpacity>
              <Text style={styles.introName} numberOfLines={1}>
                {otherProfile?.full_name ?? otherRole.label}
              </Text>
              <View style={[styles.introRoleChip, { backgroundColor: otherRole.bg }]}>
                <Text style={[styles.introRoleText, { color: otherRole.color }]}>{otherRole.label}</Text>
              </View>
            </View>

            <View style={styles.introCenter}>
              <Ionicons name="paw" size={20} color="#FF4757" />
            </View>

            {/* Eu (logado) — à direita */}
            <View style={styles.introSide}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={!myProfile}
                onPress={() => myProfile && setProfileToShow(myProfile)}
              >
                <Avatar uri={myProfile?.photo_url} size={52} style={styles.introAvatar} />
              </TouchableOpacity>
              <Text style={styles.introName} numberOfLines={1}>
                {myProfile?.full_name ?? meRole.label}
              </Text>
              <View style={[styles.introRoleChip, { backgroundColor: meRole.bg }]}>
                <Text style={[styles.introRoleText, { color: meRole.color }]}>{meRole.label}</Text>
              </View>
            </View>
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator size="large" color="#FF4757" style={{ marginTop: 50 }} />
        ) : messages.length === 0 ? (
          <Text style={styles.emptyText}>Envie uma mensagem ou foto do pet para começar!</Text>
        ) : (
          messages.map((msg, i) => {
            const mine = msg.sender_id === user?.id;
            const when = msg.created_at ? new Date(msg.created_at) : null;
            const prevWhen = i > 0 && messages[i - 1]?.created_at ? new Date(messages[i - 1].created_at) : null;
            // Separador de data (estilo WhatsApp): mostra quando muda o dia.
            const showDaySep = !!when && (!prevWhen || !isSameDay(when, prevWhen));
            const dayLabel = when
              ? (isToday(when) ? 'Hoje' : isYesterday(when) ? 'Ontem' : format(when, "d 'de' MMMM 'de' yyyy", { locale: ptBR }))
              : '';
            const timeLabel = when ? format(when, 'HH:mm') : '';

            const bubble = msg.system ? (
              <View style={styles.systemMsg}>
                <Ionicons name="checkmark-done-circle" size={16} color="#20BF6B" />
                <Text style={styles.systemMsgText}>{msg.content}</Text>
              </View>
            ) : (
              <View style={[styles.messageBubble, mine ? styles.myMessage : styles.theirMessage]}>
                {msg.photo_url && <Image source={{ uri: msg.photo_url }} style={styles.messagePhoto} />}
                {msg.content && (
                  <Text style={[styles.messageText, mine ? styles.myMessageText : styles.theirMessageText]}>
                    {msg.content}
                  </Text>
                )}
                {!!timeLabel && (
                  <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}>{timeLabel}</Text>
                )}
              </View>
            );
            return (
              <React.Fragment key={msg.id}>
                {showDaySep && (
                  <View style={styles.daySep}>
                    <Text style={styles.daySepText}>{dayLabel}</Text>
                  </View>
                )}
                {bubble}
                {/* Card do alerta relacionado logo após a 1ª mensagem ("acho que vi seu pet") */}
                {i === 0 && relatedAlertCard}
                {/* Card de doação (chat direto no alerta de doação) */}
                {i === 0 && donationCard}
              </React.Fragment>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom + 10, 15) }]}>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage} disabled={isSending || chatClosed}>
          <Ionicons name="camera-outline" size={24} color={chatClosed ? '#A4B0BE' : '#FF4757'} />
        </TouchableOpacity>
        <TextInput
          style={[styles.input, chatClosed && { backgroundColor: '#DFE4EA' }]}
          placeholder={chatClosed ? 'Chat encerrado' : 'Digite sua mensagem...'}
          placeholderTextColor="#A4B0BE"
          value={inputText}
          onChangeText={setInputText}
          editable={!chatClosed}
        />
        <TouchableOpacity
          style={[styles.sendBtn, chatClosed && { backgroundColor: '#A4B0BE' }]}
          onPress={handleSend}
          disabled={isSending || !inputText.trim() || chatClosed}
        >
          <Ionicons name="send" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Modal de encerramento (somente tutor) */}
      <Modal visible={showCloseModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Confirmar reencontro</Text>
            <Text style={styles.modalDesc}>
              O pet foi reencontrado? O caso só é encerrado quando as duas pessoas confirmarem. Depois, vocês podem avaliar um ao outro.
            </Text>

            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.modalConfirmWrap}
              onPress={handleConfirmFound}
              disabled={isClosing}
            >
              <LinearGradient
                colors={isClosing ? ['#A4B0BE', '#A4B0BE'] : ['#2ED573', '#26B765']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.modalConfirmBtn}
              >
                <View style={styles.modalConfirmIcon}>
                  <Ionicons name="checkmark-circle" size={24} color={isClosing ? '#A4B0BE' : '#2ED573'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalConfirmText}>
                    {isClosing ? 'Processando…' : 'Confirmar reencontro'}
                  </Text>
                  {!isClosing && (
                    <Text style={styles.modalConfirmSub}>Encerra quando os dois confirmarem</Text>
                  )}
                </View>
                {!isClosing && <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.9)" />}
              </LinearGradient>
            </TouchableOpacity>

            {isTutor && (
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={async () => { setShowCloseModal(false); await handleCloseWithoutFound(); }}
                disabled={isClosing}
              >
                <Text style={styles.modalSecondaryText}>Encerrar sem resgate</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => setShowCloseModal(false)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Card de perfil de um participante (somente dados públicos) */}
      <Modal visible={!!profileToShow} transparent animationType="fade" onRequestClose={() => setProfileToShow(null)}>
        <TouchableOpacity style={styles.profileOverlay} activeOpacity={1} onPress={() => setProfileToShow(null)}>
          <View style={styles.profileCard} onStartShouldSetResponder={() => true}>
            <LinearGradient
              colors={['#FF6B81', '#FF4757']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileBanner}
            />
            <TouchableOpacity style={styles.profileClose} onPress={() => setProfileToShow(null)}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>

            {profileToShow && (
              <View style={styles.profileBody}>
                <Avatar uri={profileToShow.photo_url} size={96} style={styles.profileAvatar} />

                <Text style={styles.profileName}>{profileToShow.full_name ?? 'Usuário'}</Text>

                {profileToShow.is_premium && (
                  <View style={styles.profilePremium}>
                    <Ionicons name="star" size={11} color="#FFF" />
                    <Text style={styles.profilePremiumText}>Premium</Text>
                  </View>
                )}

                <View style={styles.profileStatsRow}>
                  <View style={styles.profileStatCard}>
                    <Ionicons name="paw" size={20} color="#FFA502" />
                    <Text style={styles.profileStatValue}>{profileToShow.rescues_count ?? 0}</Text>
                    <Text style={styles.profileStatLabel}>Resgates</Text>
                  </View>
                  <View style={styles.profileStatCard}>
                    <Ionicons name="star" size={20} color="#3498DB" />
                    <Text style={styles.profileStatValue}>
                      {Number(profileToShow.rating) > 0 ? Number(profileToShow.rating).toFixed(1) : '—'}
                    </Text>
                    <Text style={styles.profileStatLabel}>Avaliação</Text>
                  </View>
                </View>

                {profileToShow.created_at && (
                  <View style={styles.profileMemberRow}>
                    <Ionicons name="time-outline" size={14} color="#A4B0BE" />
                    <Text style={styles.profileMemberText}>
                      Membro {formatDistanceToNow(new Date(profileToShow.created_at), { locale: ptBR, addSuffix: true })}
                    </Text>
                  </View>
                )}

                <View style={styles.profileBioBox}>
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#FF4757" />
                  <Text style={profileToShow.bio ? styles.profileBio : styles.profileBioEmpty}>
                    {profileToShow.bio || 'Sem descrição.'}
                  </Text>
                </View>

                {/* Botão de denúncia — só para o outro participante */}
                {profileToShow.id !== user?.id && (
                  <TouchableOpacity
                    style={styles.reportBtn}
                    onPress={() => handleOpenReport(profileToShow)}
                  >
                    <Ionicons name="flag-outline" size={15} color="#FF4757" />
                    <Text style={styles.reportBtnText}>Denunciar usuário</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal de denúncia */}
      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={() => setShowReportModal(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.reportHeader}>
              <View style={styles.reportIconWrap}>
                <Ionicons name="flag" size={22} color="#FF4757" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Denunciar usuário</Text>
                <Text style={styles.reportSubtitle} numberOfLines={1}>{reportTargetName}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <Ionicons name="close" size={22} color="#A4B0BE" />
              </TouchableOpacity>
            </View>

            <Text style={styles.reportLabel}>Descreva o motivo da denúncia</Text>
            <TextInput
              style={styles.reportInput}
              placeholder="Ex: usuário pediu pagamento fora do app, comportamento suspeito, assédio..."
              placeholderTextColor="#A4B0BE"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={reportReason}
              onChangeText={setReportReason}
              maxLength={500}
            />
            <Text style={styles.reportCharCount}>{reportReason.length}/500</Text>

            <Text style={styles.reportDisclaimer}>
              Sua denúncia ficará em análise. Não identificaremos você ao usuário denunciado.
            </Text>

            <TouchableOpacity
              style={[styles.reportSubmitBtn, (!reportReason.trim() || isReporting) && { opacity: 0.5 }]}
              onPress={handleSubmitReport}
              disabled={!reportReason.trim() || isReporting}
            >
              <Ionicons name="flag" size={18} color="#FFF" />
              <Text style={styles.reportSubmitText}>
                {isReporting ? 'Enviando…' : 'Enviar denúncia'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowReportModal(false)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Modal de avaliação do buscador */}
      <Modal visible={showRatingModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Cabeçalho */}
            <View style={{ alignItems: 'center', marginBottom: 4 }}>
              <Avatar uri={otherProfile?.photo_url} size={72} style={styles.ratingAvatar} />
              <Text style={styles.ratingTitle}>Como foi sua experiência?</Text>
              <Text style={styles.ratingSubtitle}>{otherProfile?.full_name ?? 'a outra pessoa'}</Text>
            </View>

            {/* Estrelas */}
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRatingScore(star)} activeOpacity={0.7}>
                  <Ionicons
                    name={star <= ratingScore ? 'star' : 'star-outline'}
                    size={40}
                    color={star <= ratingScore ? '#FFA502' : '#DFE4EA'}
                  />
                </TouchableOpacity>
              ))}
            </View>

            {ratingScore > 0 && (
              <Text style={styles.ratingScoreLabel}>
                {['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente!'][ratingScore]}
              </Text>
            )}

            {/* Comentário opcional */}
            <TextInput
              style={styles.ratingInput}
              placeholder="Deixe um comentário (opcional)..."
              placeholderTextColor="#A4B0BE"
              value={ratingComment}
              onChangeText={setRatingComment}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={300}
            />

            {/* Botões */}
            <TouchableOpacity
              style={[styles.ratingSubmitBtn, ratingScore === 0 && { opacity: 0.4 }]}
              onPress={() => handleSubmitRating(false)}
              disabled={ratingScore === 0}
            >
              <Ionicons name="star" size={18} color="#FFF" />
              <Text style={styles.ratingSubmitText}>Enviar avaliação</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => handleSubmitRating(true)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Pular</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 50, paddingHorizontal: 20, paddingBottom: 15,
    backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#2F3542' },
  headerSubtitle: { fontSize: 12, color: '#747D8C', fontWeight: '500' },
  confirmHeaderBtn: {
    width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5,
  },
  headerActions: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerAction: { alignItems: 'center', width: 56 },
  headerActionLabel: { fontSize: 9, fontWeight: '800', marginTop: 3, textAlign: 'center' },
  closedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#F1F2F6', gap: 6 },
  closedBannerText: { fontSize: 13, color: '#747D8C', fontWeight: '600' },
  donationCard: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    marginHorizontal: 16, marginTop: 10, padding: 14, borderRadius: 16,
    backgroundColor: '#FFF0F1', borderWidth: 1, borderColor: '#FFD6DB',
  },
  donationTitle: { fontSize: 14.5, fontWeight: '900', color: '#2F3542', marginBottom: 3 },
  donationSub: { fontSize: 12.5, color: '#747D8C', lineHeight: 17 },
  donationPix: { fontSize: 13, fontWeight: '800', color: '#2F3542', marginTop: 8 },
  donationBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 10, backgroundColor: '#FF4757', paddingHorizontal: 14, height: 38, borderRadius: 12,
  },
  donationBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13.5 },

  sourceBanner: { backgroundColor: '#EAF0FF', paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#D6E0FF' },
  sourceCard: {
    backgroundColor: '#EAF0FF', borderWidth: 1, borderColor: '#D6E0FF',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    marginHorizontal: 16, marginTop: 4, marginBottom: 12,
  },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceThumb: { width: 46, height: 46, borderRadius: 10, backgroundColor: '#D6E0FF' },
  sourceThumbFallback: { width: 46, height: 46, borderRadius: 10, backgroundColor: '#D6E0FF', justifyContent: 'center', alignItems: 'center' },
  sourceTitle: { fontSize: 14, fontWeight: '800', color: '#2F3542' },
  sourceSub: { fontSize: 12, color: '#5A6478', marginTop: 1 },
  queueBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#EFF6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10,
  },
  queueBannerTurn: { backgroundColor: '#EAFBF1' },
  queueText: { flex: 1, fontSize: 12.5, color: '#3B82F6', fontWeight: '700', lineHeight: 17 },
  sourceViewBtn: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#3B5BDB', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  sourceViewText: { color: '#3B5BDB', fontWeight: '800', fontSize: 13 },
  confirmSightingBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#20BF6B', height: 44, borderRadius: 12 },
  confirmSightingText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  confirmedTag: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmedText: { color: '#20BF6B', fontWeight: '800', fontSize: 13 },

  cancelChatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  cancelChatText: { color: '#747D8C', fontWeight: '700', fontSize: 13 },
  cancelHeaderBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFE5E9', justifyContent: 'center', alignItems: 'center' },
  messagesContainer: { flex: 1, paddingHorizontal: 15, paddingTop: 20 },
  messagesContent: { paddingBottom: 16 },
  emptyText: { textAlign: 'center', color: '#A4B0BE', marginTop: 50, fontSize: 16 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 10 },
  systemMsg: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
    backgroundColor: '#E8F8F5', borderWidth: 1, borderColor: '#B6ECDD',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, marginVertical: 10, maxWidth: '90%',
  },
  systemMsgText: { flex: 1, fontSize: 13, color: '#1B7A5A', fontWeight: '700', textAlign: 'center' },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#FF4757', borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#FFF', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  messageText: { fontSize: 15, lineHeight: 20 },
  myMessageText: { color: '#FFF' },
  theirMessageText: { color: '#2F3542' },
  messagePhoto: { width: 200, height: 200, borderRadius: 12, marginBottom: 5 },
  // Horário dentro do balão
  bubbleTime: { fontSize: 10.5, fontWeight: '600', marginTop: 3, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.8)' },
  bubbleTimeTheirs: { color: '#A4B0BE' },
  // Separador de data (estilo WhatsApp)
  daySep: { alignSelf: 'center', backgroundColor: '#E3E8EF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, marginVertical: 12 },
  daySepText: { fontSize: 11.5, fontWeight: '800', color: '#5A6472', letterSpacing: 0.3 },
  inputArea: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F1F2F6' },
  attachBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  input: { flex: 1, backgroundColor: '#F1F2F6', borderRadius: 20, paddingHorizontal: 15, height: 40, color: '#2F3542' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FF4757', justifyContent: 'center', alignItems: 'center', marginLeft: 10 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#2F3542', marginBottom: 8 },
  modalDesc: { fontSize: 14, color: '#747D8C', lineHeight: 20, marginBottom: 16 },
  modalInput: { backgroundColor: '#F1F2F6', borderRadius: 14, paddingHorizontal: 14, height: 50, fontSize: 15, color: '#2F3542', marginBottom: 14 },
  modalConfirmWrap: {
    borderRadius: 16, marginBottom: 10,
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  modalConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64,
  },
  modalConfirmIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
  },
  modalConfirmText: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  modalConfirmSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 1 },
  modalSecondaryBtn: { backgroundColor: '#FFF0F1', height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  modalSecondaryText: { color: '#FF4757', fontWeight: '700', fontSize: 14 },
  modalCancel: { alignItems: 'center', paddingTop: 8 },
  modalCancelText: { color: '#747D8C', fontWeight: '600' },

  personAvatarEmpty: { backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center' },

  profileOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  profileCard: {
    width: '100%', backgroundColor: '#FFF', borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.25, shadowRadius: 24, elevation: 12,
  },
  profileBanner: { height: 88, width: '100%' },
  profileClose: {
    position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.28)', justifyContent: 'center', alignItems: 'center', zIndex: 2,
  },
  profileBody: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24 },
  profileAvatar: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 4, borderColor: '#FFF',
    marginTop: -48, backgroundColor: '#F1F2F6',
  },
  profileName: { fontSize: 21, fontWeight: '900', color: '#2F3542', marginTop: 12, textAlign: 'center', letterSpacing: -0.3 },
  profilePremium: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFA502',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 8,
  },
  profilePremiumText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  profileStatsRow: { flexDirection: 'row', gap: 12, marginTop: 18, alignSelf: 'stretch' },
  profileStatCard: {
    flex: 1, backgroundColor: '#F8F9FB', borderRadius: 16, paddingVertical: 14, alignItems: 'center', gap: 3,
  },
  profileStatValue: { fontSize: 18, fontWeight: '900', color: '#2F3542' },
  profileStatLabel: { fontSize: 11, color: '#A4B0BE', fontWeight: '700', textTransform: 'uppercase' },
  profileMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14 },
  profileMemberText: { fontSize: 12.5, color: '#A4B0BE', fontWeight: '600' },
  profileBioBox: {
    flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 14,
    backgroundColor: '#FFF6F7', borderRadius: 14, padding: 14,
  },
  profileBio: { flex: 1, fontSize: 14, color: '#57606F', lineHeight: 20 },
  profileBioEmpty: { flex: 1, fontSize: 13, color: '#A4B0BE', fontStyle: 'italic' },

  introCard: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  introSide: { flex: 1, alignItems: 'center', gap: 6 },
  introAvatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#FFE5E9' },
  introName: { fontSize: 13, fontWeight: '800', color: '#2F3542', textAlign: 'center' },
  introRoleChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  introRoleText: { fontSize: 11, fontWeight: '800' },
  introCenter: { paddingHorizontal: 8, paddingTop: 16, alignItems: 'center', justifyContent: 'center' },

  // Botão de denúncia no card de perfil
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16, alignSelf: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1, borderColor: '#FFE0E3',
    backgroundColor: '#FFF6F7',
  },
  reportBtnText: { fontSize: 13, fontWeight: '700', color: '#FF4757' },

  // Modal de denúncia
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  reportIconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#FFF0F1', justifyContent: 'center', alignItems: 'center',
  },
  reportSubtitle: { fontSize: 13, color: '#747D8C', marginTop: 1 },
  reportLabel: { fontSize: 13, fontWeight: '700', color: '#2F3542', marginBottom: 8 },
  reportInput: {
    backgroundColor: '#F8F9FB', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#2F3542', minHeight: 110,
    borderWidth: 1, borderColor: '#E8ECEF',
  },
  reportCharCount: { fontSize: 11, color: '#A4B0BE', textAlign: 'right', marginTop: 4, marginBottom: 10 },
  reportDisclaimer: {
    fontSize: 12, color: '#A4B0BE', lineHeight: 17,
    backgroundColor: '#F8F9FB', borderRadius: 10, padding: 12, marginBottom: 16,
  },
  reportSubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FF4757', height: 52, borderRadius: 14, marginBottom: 8,
  },
  reportSubmitText: { color: '#FFF', fontWeight: '800', fontSize: 15 },

  // Modal de avaliação
  ratingAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 12, backgroundColor: '#F1F2F6' },
  ratingTitle: { fontSize: 20, fontWeight: '900', color: '#2F3542', textAlign: 'center' },
  ratingSubtitle: { fontSize: 14, color: '#747D8C', marginTop: 2, marginBottom: 18 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 },
  ratingScoreLabel: { textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#FFA502', marginBottom: 14 },
  ratingInput: {
    backgroundColor: '#F8F9FB', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#2F3542', minHeight: 80, borderWidth: 1, borderColor: '#E8ECEF',
    marginBottom: 16,
  },
  ratingSubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFA502', height: 52, borderRadius: 14, marginBottom: 8,
  },
  ratingSubmitText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
});
