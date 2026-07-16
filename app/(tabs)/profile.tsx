import React, { useCallback, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Image, TouchableOpacity, Dimensions, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { getUserProfile, confirmRescue, cancelPet, transformToDonation, concludeDonation } from '../../services/api';
import { toast, showConfirm } from '../../components/Feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PetCard } from '../../components/PetCard';

export default function ProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Rescue Confirmation State
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [finderEmail, setFinderEmail] = useState('');
  const [showRescueModal, setShowRescueModal] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  // Caso concluído na confirmação → abre o registro do final feliz depois que o
  // modal fecha (nunca navegar durante o dismiss — congela no iOS).
  const [pendingSuccessNav, setPendingSuccessNav] = useState<string | null>(null);

  // Transformar resgate em doação
  const [donatePet, setDonatePet] = useState<{ id: string; name: string } | null>(null);
  const [donationRules, setDonationRules] = useState('');
  const [consentResp, setConsentResp] = useState(false);
  const [consentSearched, setConsentSearched] = useState(false);
  const [isDonating, setIsDonating] = useState(false);

  const openDonateModal = (pet: any) => {
    setDonatePet({ id: pet.id, name: pet.name });
    setDonationRules('');
    setConsentResp(false);
    setConsentSearched(false);
  };

  const handleSubmitDonation = async () => {
    if (!donatePet) return;
    if (!donationRules.trim()) return toast.warning('Descreva as regras para adoção.');
    if (!consentResp) return toast.warning('Confirme que entende as responsabilidades de doar um pet.');
    if (!consentSearched) return toast.warning('Confirme que já procurou o dono antes de doar.');
    setIsDonating(true);
    try {
      await transformToDonation(donatePet.id, donationRules.trim(), consentResp, consentSearched);
      toast.success('O pet agora aparece no mapa para adoção.', 'Doação publicada!');
      setDonatePet(null);
      loadProfile();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao publicar doação.');
    } finally {
      setIsDonating(false);
    }
  };

  const handleConcludeDonation = (pet: any) => {
    showConfirm({
      title: 'Concluir doação?',
      message: `Marque ${pet.name} como doado em outro local. O alerta sairá do mapa e será encerrado.`,
      confirmText: 'Marcar como doado',
      cancelText: 'Voltar',
      icon: 'checkmark-done',
      onConfirm: async () => {
        try {
          await concludeDonation(pet.id);
          toast.success('Doação concluída.');
          loadProfile();
        } catch (e: any) {
          toast.error(e?.message ?? 'Erro ao concluir doação.');
        }
      },
    });
  };

  useFocusEffect(useCallback(() => {
    loadProfile();
  }, [user]));

  const loadProfile = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await getUserProfile(user.id);
      setProfileData(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleConfirmRescueSubmit = async () => {
    if (!selectedPetId || !user) return;
    if (!finderEmail.trim()) {
      toast.warning('Digite o e-mail do usuário que achou o pet.');
      return;
    }
    
    setIsConfirming(true);
    try {
      const result = await confirmRescue(selectedPetId, user.id, finderEmail);
      setShowRescueModal(false);
      setFinderEmail('');
      if (result?.closed) {
        // Caso concluído → tela de final feliz (Android navega direto; iOS espera o onDismiss)
        setPendingSuccessNav(selectedPetId);
        if (Platform.OS !== 'ios') {
          const petId = selectedPetId;
          setPendingSuccessNav(null);
          setTimeout(() => router.push(`/pet/success/${petId}`), 80);
        }
      } else {
        toast.success('Sua confirmação foi registrada. Aguardando quem resgatou confirmar para encerrar.', 'Quase lá! 🐾');
      }
      loadProfile(); // Reload data
    } catch (error: any) {
      toast.error(error.message || 'Erro ao confirmar resgate.');
    } finally {
      setIsConfirming(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
        <Text style={{ marginTop: 10, color: '#747D8C' }}>Carregando perfil...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Premium Header Profile Section */}
      <View style={[styles.headerContainer, { paddingTop: insets.top + 8 }]}>
        <LinearGradient
          colors={['#FF6B81', '#FF4757']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerBackground}
        />
        
        <View style={styles.headerContent}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>Perfil</Text>
            <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/profile/settings')}>
              <Ionicons name="settings-outline" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.profileInfo}>
            <View style={styles.avatarContainer}>
              {profileData?.photo_url ? (
                <Image source={{ uri: profileData.photo_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={52} color="#A4B0BE" />
                </View>
              )}
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={18} color="#2ED573" />
              </View>
            </View>
            <Text style={styles.userName}>{profileData?.full_name || profileData?.name || user?.email || 'Usuário'}</Text>
            <Text style={styles.userBio}>
              {profileData?.rating ? `⭐ ${Number(profileData.rating).toFixed(1)} • ` : ''}
              {profileData?.bio?.trim() || 'Amante de animais'}
            </Text>

            <View style={styles.statsContainer}>
              <TouchableOpacity
                style={styles.statBox}
                activeOpacity={0.7}
                onPress={() => router.push('/profile/rescues')}
              >
                <Text style={styles.statNumber}>{profileData?.rescues_count ?? 0}</Text>
                <View style={styles.statLabelRow}>
                  <Text style={styles.statLabel}>Resgates</Text>
                  <Ionicons name="chevron-forward" size={11} color="#A4B0BE" />
                </View>
              </TouchableOpacity>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>
                  {(profileData?.pets ?? []).filter((p: any) => p.status === 'ativo').length}
                </Text>
                <Text style={styles.statLabel}>Ativos</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        
        {/* Lista de pets — separa ativos de finalizados */}
        <Text style={styles.sectionTitle}>Alertas ativos</Text>
        {(profileData?.pets ?? []).filter((p: any) => p.status === 'ativo').length === 0 ? (
          <Text style={{ color: '#A4B0BE', textAlign: 'center', marginVertical: 20 }}>Nenhum alerta ativo.</Text>
        ) : (
          (profileData?.pets ?? [])
            .filter((p: any) => p.status === 'ativo')
            .map((pet: any) => (
              <PetCard
                key={pet.id}
                pet={pet}
                onEdit={() => router.push(`/pet/edit/${pet.id}`)}
                onConfirm={(pet.type ?? 'lost') === 'lost' ? () => { setSelectedPetId(pet.id); setShowRescueModal(true); } : undefined}
                onFindOwner={(pet.type === 'sighted' || pet.type === 'rescued') ? () => router.push({
                  pathname: '/match-owners',
                  params: { sourcePetId: pet.id, photo: pet.main_photo_url, lat: String(pet.latitude ?? ''), lng: String(pet.longitude ?? '') },
                }) : undefined}
                onDonate={pet.type === 'rescued' ? () => openDonateModal(pet) : undefined}
                onConcludeDonation={pet.type === 'donation' ? () => handleConcludeDonation(pet) : undefined}
                onCancel={() => {
                  showConfirm({
                    title: 'Cancelar alerta?',
                    message: `O alerta de ${pet.name} será cancelado. Atenção: não é possível cancelar se há chats abertos.`,
                    confirmText: 'Cancelar alerta',
                    cancelText: 'Voltar',
                    destructive: true,
                    icon: 'close-circle',
                    onConfirm: async () => {
                      try {
                        await cancelPet(pet.id, user!.id);
                        toast.success('Alerta cancelado.');
                        loadProfile();
                      } catch (e: any) {
                        toast.error(e?.message ?? 'Erro ao cancelar.');
                      }
                    },
                  });
                }}
              />
            ))
        )}

        <Text style={styles.sectionTitle}>Minha Conta</Text>
        <View style={styles.menuContainer}>
          {/* Alertas já encerrados — os ativos continuam na seção acima. */}
          <MenuOption icon="time-outline" title="Histórico de alertas" iconColor="#FF4757" onPress={() => router.push('/profile/historico')} />
          <MenuOption icon="heart-circle-outline" title="Pets para adoção" iconColor="#3B82F6" onPress={() => router.push('/doacao')} />
          <MenuOption icon="trophy-outline" title="Casos de Sucesso" iconColor="#FFA502" onPress={() => router.push('/success-cases')} />
          <MenuOption icon="person-outline" title="Editar Perfil" iconColor="#FF4757" onPress={() => router.push('/profile/edit')} />
          <MenuOption icon="notifications-outline" title="Notificações" iconColor="#FF4757" onPress={() => router.push('/profile/notifications')} hasBadge />
          <SupportMenuOption onPress={() => router.push('/profile/apoiar')} />
          <MenuOption icon="settings-outline" title="Configurações" iconColor="#FF4757" onPress={() => router.push('/profile/settings')} />
          <MenuOption icon="shield-checkmark-outline" title="Privacidade e Segurança" iconColor="#FF4757" onPress={() => router.push('/profile/privacy')} />
          <MenuOption icon="headset-outline" title="Central de Ajuda" iconColor="#FF4757" onPress={() => router.push('/support')} />
          <MenuOption icon="receipt-outline" title="Meus Chamados" iconColor="#FF4757" onPress={() => router.push('/profile/tickets')} />
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#FF4757" />
          <Text style={styles.logoutText}>Sair da Conta</Text>
        </TouchableOpacity>
        
        <View style={{height: 120}} />
      </View>

      {/* Rescue Confirmation Modal */}
      <Modal
        visible={showRescueModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRescueModal(false)}
        onDismiss={() => {
          // iOS: navega só depois do modal desmontar (senão congela a UI)
          if (pendingSuccessNav) {
            const petId = pendingSuccessNav;
            setPendingSuccessNav(null);
            setTimeout(() => router.push(`/pet/success/${petId}`), 0);
          }
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirmar Resgate</Text>
              <TouchableOpacity onPress={() => setShowRescueModal(false)}>
                <Ionicons name="close" size={24} color="#2F3542" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalDesc}>
              Seu pet foi encontrado por alguém usando o app? Digite o e-mail dessa pessoa para registrar o reencontro. A recompensa é combinada diretamente entre vocês.
            </Text>
            
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput 
                style={styles.input} 
                placeholder="E-mail do herói..." 
                autoCapitalize="none"
                keyboardType="email-address"
                value={finderEmail}
                onChangeText={setFinderEmail}
              />
            </View>

            <TouchableOpacity
              style={styles.modalSubmitBtn}
              onPress={handleConfirmRescueSubmit}
              disabled={isConfirming}
            >
              <Text style={styles.modalSubmitText}>{isConfirming ? 'Processando...' : 'Transferir Recompensa'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Transformar resgate em doação */}
      <Modal visible={!!donatePet} transparent animationType="fade" onRequestClose={() => setDonatePet(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Doar {donatePet?.name}</Text>
              <TouchableOpacity onPress={() => setDonatePet(null)}>
                <Ionicons name="close" size={24} color="#2F3542" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>Descreva as regras para adoção e confirme os pontos abaixo.</Text>

            <TextInput
              style={[styles.input, { minHeight: 90, textAlignVertical: 'top', paddingTop: 12, borderWidth: 1, borderColor: '#DFE4EA', borderRadius: 14, paddingHorizontal: 14 }]}
              placeholder="Ex: castração obrigatória, lar com tela, termo de adoção..."
              placeholderTextColor="#A4B0BE"
              value={donationRules}
              onChangeText={setDonationRules}
              multiline
            />

            <TouchableOpacity style={[styles.donConsent, consentResp && styles.donConsentOn]} activeOpacity={0.85} onPress={() => setConsentResp((v) => !v)}>
              <View style={[styles.donBox, consentResp && styles.donBoxOn]}>{consentResp && <Ionicons name="checkmark" size={15} color="#FFF" />}</View>
              <Text style={styles.donConsentText}>Entendo as responsabilidades de doar um pet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.donConsent, consentSearched && styles.donConsentOn]} activeOpacity={0.85} onPress={() => setConsentSearched((v) => !v)}>
              <View style={[styles.donBox, consentSearched && styles.donBoxOn]}>{consentSearched && <Ionicons name="checkmark" size={15} color="#FFF" />}</View>
              <Text style={styles.donConsentText}>Já procurei o dono antes de doar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalSubmitBtn, { backgroundColor: '#3B82F6' }]}
              onPress={handleSubmitDonation}
              disabled={isDonating}
            >
              <Text style={styles.modalSubmitText}>{isDonating ? 'Publicando...' : 'Publicar doação'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </ScrollView>
  );
}

const MenuOption = ({ icon, title, iconColor, onPress, hasBadge = false }: { icon: any, title: string, iconColor: string, onPress?: () => void, hasBadge?: boolean }) => (
  <TouchableOpacity style={styles.menuOption} activeOpacity={0.7} onPress={onPress}>
    <View style={[styles.menuIconContainer, { backgroundColor: iconColor + '15' }]}>
      <Ionicons name={icon} size={22} color={iconColor} />
    </View>
    <Text style={styles.menuOptionTitle}>{title}</Text>
    {hasBadge && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF4757', marginRight: 6 }} />}
    <Ionicons name="chevron-forward" size={20} color="#DFE4EA" />
  </TouchableOpacity>
);

// Substitui o antigo item Premium: doação voluntária pra manter o app no ar.
const SupportMenuOption = ({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity style={styles.menuOption} activeOpacity={0.7} onPress={onPress}>
    <LinearGradient
      colors={['#2ED573', '#26B765']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.menuIconContainer}
    >
      <Ionicons name="heart" size={20} color="#FFF" />
    </LinearGradient>
    <Text style={styles.menuOptionTitle}>Apoie o app</Text>
    <View style={styles.supportPill}>
      <Text style={styles.supportPillText}>Doação 💚</Text>
    </View>
    <Ionicons name="chevron-forward" size={20} color="#DFE4EA" />
  </TouchableOpacity>
);

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F2F6',
  },
  headerContainer: {
    paddingTop: 50,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
    paddingBottom: 30,
  },
  headerBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  headerContent: {
    paddingHorizontal: 24,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#FFF',
  },
  avatarPlaceholder: {
    backgroundColor: '#DFE4EA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 2,
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 6,
  },
  userBio: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 5,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '900',
    color: '#2F3542',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#747D8C',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#F1F2F6',
  },
  mainContent: {
    padding: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2F3542',
    marginBottom: 16,
    marginTop: 8,
  },
  activeAlertCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  alertImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
  },
  alertInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  alertHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertPetName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2F3542',
  },
  statusBadge: {
    backgroundColor: '#FFF0F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    color: '#FF4757',
    fontSize: 12,
    fontWeight: '800',
  },
  alertDescription: {
    fontSize: 13,
    color: '#747D8C',
    lineHeight: 18,
    marginBottom: 8,
  },
  alertFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertLocationText: {
    fontSize: 12,
    color: '#A4B0BE',
    marginLeft: 4,
    fontWeight: '500',
  },
  menuContainer: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F2F6',
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  menuOptionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#2F3542',
  },
  menuBadge: {
    backgroundColor: '#FF4757',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  menuBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF0F1',
    paddingVertical: 16,
    borderRadius: 20,
  },
  logoutText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '700',
    color: '#FF4757',
  },
  supportPill: {
    backgroundColor: '#E8F8F0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
  },
  supportPillText: {
    color: '#26B765',
    fontSize: 12,
    fontWeight: '800',
  },
  confirmRescueBtn: {
    flexDirection: 'row',
    backgroundColor: '#FF4757',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  confirmRescueText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2F3542',
  },
  modalDesc: {
    fontSize: 14,
    color: '#747D8C',
    lineHeight: 20,
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F2F6',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 24,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#2F3542',
  },
  modalSubmitBtn: {
    backgroundColor: '#2ED573',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  donConsent: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
    padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#DFE4EA', backgroundColor: '#FFF',
  },
  donConsentOn: { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  donBox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#CBD5E1',
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF',
  },
  donBoxOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  donConsentText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: '#2F3542' },
});
