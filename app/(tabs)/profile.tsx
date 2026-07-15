import React, { useCallback, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Image, TouchableOpacity, Dimensions, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { getUserProfile, confirmRescue, cancelPet, transformToDonation, concludeDonation } from '../../services/api';
import { usePremium } from '../../hooks/use-premium';
import { toast, showConfirm } from '../../components/Feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharePetButton } from '../../components/SharePetButton';
import { RegionAlertButton } from '../../components/RegionAlertButton';

export default function ProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const premium = usePremium();
  
  // Rescue Confirmation State
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [finderEmail, setFinderEmail] = useState('');
  const [showRescueModal, setShowRescueModal] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

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
      await confirmRescue(selectedPetId, user.id, finderEmail);
      toast.success('Sua confirmação foi registrada. Combine a recompensa diretamente com quem ajudou.', 'Resgate confirmado!');
      setShowRescueModal(false);
      setFinderEmail('');
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
                styles={styles}
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

        {(profileData?.pets ?? []).some((p: any) => p.status !== 'ativo') && (
          <>
            <Text style={styles.sectionTitle}>Histórico</Text>
            {(profileData?.pets ?? [])
              .filter((p: any) => p.status !== 'ativo')
              .map((pet: any) => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  styles={styles}
                  onPress={() => router.push(`/pet/case/${pet.id}`)}
                />
              ))}
          </>
        )}

        <Text style={styles.sectionTitle}>Minha Conta</Text>
        <View style={styles.menuContainer}>
          <MenuOption icon="heart-circle-outline" title="Pets para adoção" iconColor="#3B82F6" onPress={() => router.push('/doacao')} />
          <MenuOption icon="person-outline" title="Editar Perfil" iconColor="#FF4757" onPress={() => router.push('/profile/edit')} />
          <MenuOption icon="notifications-outline" title="Notificações" iconColor="#FF4757" onPress={() => router.push('/profile/notifications')} hasBadge />
          <PremiumMenuOption isPremium={premium.isPremium} onPress={() => router.push('/profile/premium')} />
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
      <Modal visible={showRescueModal} transparent animationType="fade" onRequestClose={() => setShowRescueModal(false)}>
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

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  ativo:       { label: 'Ativo',       color: '#FF4757', bg: '#FFF0F1' },
  pausado:     { label: 'Pausado',     color: '#FFA502', bg: '#FFF6E5' },
  encontrado:  { label: 'Encontrado',  color: '#2ED573', bg: '#E8F8F5' },
  cancelado:   { label: 'Cancelado',   color: '#747D8C', bg: '#F1F2F6' },
  doado:       { label: 'Doado',       color: '#3B82F6', bg: '#EFF6FF' },
};

// Faixa de tipo no topo do card (perdido / visto / resgatado / doação).
const TYPE_BADGE: Record<string, { label: string; verb: string; color: string; bg: string; icon: any }> = {
  lost:     { label: 'PET PERDIDO',   verb: 'Perdido',   color: '#FF4757', bg: '#FFF0F1', icon: 'megaphone' },
  sighted:  { label: 'PET VISTO',     verb: 'Visto',     color: '#F79F1F', bg: '#FFF6E5', icon: 'eye' },
  rescued:  { label: 'PET RESGATADO', verb: 'Resgatado', color: '#20BF6B', bg: '#E8F8F5', icon: 'alert-circle' },
  donation: { label: 'PET DOANDO',    verb: 'Em doação', color: '#3B82F6', bg: '#EFF6FF', icon: 'gift' },
};

// Tempo decorrido compacto: "hoje", "há 1 dia", "há 5 dias", "há 2 meses".
function elapsedShort(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) {
    const h = Math.floor(ms / 3600000);
    if (h <= 0) return 'há pouco';
    return `há ${h} h`;
  }
  if (days === 1) return 'há 1 dia';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}

function PetCard({ pet, styles, onConfirm, onFindOwner, onCancel, onEdit, onPress, onDonate, onConcludeDonation }: { pet: any; styles: any; onConfirm?: () => void; onFindOwner?: () => void; onCancel?: () => void; onEdit?: () => void; onPress?: () => void; onDonate?: () => void; onConcludeDonation?: () => void }) {
  const status = STATUS_MAP[pet.status] ?? STATUS_MAP.ativo;
  const tmeta = TYPE_BADGE[pet.type ?? 'lost'] ?? TYPE_BADGE.lost;
  const photo = pet.main_photo_url ?? pet.photo_url;
  const sizeText = pet.size === 'pequeno' ? 'Pequeno' : pet.size === 'medio' ? 'Médio' : pet.size === 'grande' ? 'Grande' : null;
  const sexText = pet.sex === 'macho' ? 'Macho' : pet.sex === 'femea' ? 'Fêmea' : null;
  const ageText = pet.age_group === 'filhote' ? 'Filhote' : pet.age_group === 'adulto' ? 'Adulto' : pet.age_group === 'idoso' ? 'Idoso' : null;
  const subtitle = [pet.breed, pet.color, sizeText, sexText, ageText].filter(Boolean).join(' · ');
  const isActive = pet.status === 'ativo';
  const elapsed = elapsedShort(pet.lost_date);
  const timeLabel = elapsed ? `${tmeta.verb} ${elapsed}` : null;
  const petType = pet.type ?? 'lost';

  const CardWrap: any = onPress ? TouchableOpacity : View;

  return (
    <CardWrap style={[styles.petCardV2, { borderLeftWidth: 4, borderLeftColor: tmeta.color }]} {...(onPress ? { onPress, activeOpacity: 0.85 } : {})}>
      {/* Data de cadastro no topo */}
      {!!pet.created_at && (
        <View style={styles.cardDateRow}>
          <Ionicons name="calendar-outline" size={12} color="#A4B0BE" />
          <Text style={styles.cardDateText}>
            Cadastrado em {new Date(pet.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}

      {/* Faixa do topo: tipo (esquerda) + status (direita) */}
      <View style={styles.cardRibbon}>
        <View style={[styles.typePill, { backgroundColor: tmeta.bg }]}>
          <Ionicons name={tmeta.icon} size={12} color={tmeta.color} />
          <Text style={[styles.typePillText, { color: tmeta.color }]}>{tmeta.label}</Text>
        </View>
        <View style={[styles.statusDotBadge, { backgroundColor: status.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusDotText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.petCardTop}>
        <Image source={{ uri: photo }} style={styles.petCardImg} />

        <View style={styles.petCardInfo}>
          <Text style={styles.petCardName} numberOfLines={1}>{pet.name}</Text>

          {subtitle ? (
            <Text style={styles.petCardSubtitle} numberOfLines={2}>{subtitle}</Text>
          ) : null}

          <View style={styles.metaList}>
            {timeLabel && (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={14} color="#747D8C" />
                <Text style={styles.metaText}>{timeLabel}</Text>
              </View>
            )}
            {pet.reward?.amount > 0 && (
              <View style={styles.metaItem}>
                <Ionicons name="gift" size={14} color="#FFA502" />
                <Text style={[styles.metaText, { color: '#FFA502', fontWeight: '800' }]}>
                  R$ {Number(pet.reward.amount).toFixed(2).replace('.', ',')}
                </Text>
              </View>
            )}
            {/* Info específica do tipo */}
            {petType === 'sighted' && (
              <View style={styles.metaItem}>
                <Ionicons name={pet.allow_contact === false ? 'chatbubble-ellipses-outline' : 'chatbubbles-outline'} size={14} color={pet.allow_contact === false ? '#A4B0BE' : '#3498DB'} />
                <Text style={[styles.metaText, pet.allow_contact === false ? { color: '#A4B0BE' } : { color: '#3498DB' }]}>
                  {pet.allow_contact === false ? 'Contato desativado' : 'Contato permitido'}
                </Text>
              </View>
            )}
            {petType === 'rescued' && (
              <View style={styles.metaItem}>
                <Ionicons name={pet.is_with_finder ? 'home' : 'home-outline'} size={14} color="#20BF6B" />
                <Text style={[styles.metaText, { color: '#20BF6B' }]}>
                  {pet.is_with_finder ? 'Está com você' : 'Não está com você'}
                </Text>
              </View>
            )}
            {petType === 'donation' && (
              <View style={styles.metaItem}>
                <Ionicons name="gift" size={14} color="#3B82F6" />
                <Text style={[styles.metaText, { color: '#3B82F6' }]}>Disponível para adoção</Text>
              </View>
            )}
            {pet.open_chats_count > 0 && (
              <View style={styles.metaItem}>
                <Ionicons name="chatbubbles" size={14} color="#3498DB" />
                <Text style={[styles.metaText, { color: '#3498DB', fontWeight: '700' }]}>
                  {pet.open_chats_count} {pet.open_chats_count === 1 ? 'conversa ativa' : 'conversas ativas'}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {isActive && (
        <>
          <View style={styles.cardDivider} />
          <View style={styles.cardActions}>
            {onConfirm && (
              <TouchableOpacity style={styles.actionPrimary} onPress={onConfirm}>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.actionPrimaryText}>Confirmar resgate</Text>
              </TouchableOpacity>
            )}
            {onFindOwner && (
              <TouchableOpacity style={styles.actionPrimary} onPress={onFindOwner}>
                <Ionicons name="search" size={18} color="#FFF" />
                <Text style={styles.actionPrimaryText}>Procurar tutor</Text>
              </TouchableOpacity>
            )}
            {onDonate && (
              <TouchableOpacity style={[styles.actionPrimary, { backgroundColor: '#3B82F6', shadowColor: '#3B82F6' }]} onPress={onDonate}>
                <Ionicons name="gift" size={18} color="#FFF" />
                <Text style={styles.actionPrimaryText}>Doar este pet</Text>
              </TouchableOpacity>
            )}
            {onConcludeDonation && (
              <TouchableOpacity style={[styles.actionPrimary, { backgroundColor: '#3B82F6', shadowColor: '#3B82F6' }]} onPress={onConcludeDonation}>
                <Ionicons name="checkmark-done" size={18} color="#FFF" />
                <Text style={styles.actionPrimaryText}>Doado em outro local</Text>
              </TouchableOpacity>
            )}
            {/* Pet perdido: alertar buscadores da região (ícone megafone) */}
            {petType === 'lost' && <RegionAlertButton petId={pet.id} compact style={styles.actionIconBtn} />}
            {/* Compartilhar a publicação — todos os tipos (perdido/visto/resgatado/doação) */}
            <SharePetButton pet={pet} label="" style={styles.actionIconBtn} />
            {onEdit && (
              <TouchableOpacity style={styles.actionIconBtn} onPress={onEdit}>
                <Ionicons name="create-outline" size={20} color="#FF4757" />
              </TouchableOpacity>
            )}
            {onCancel && (
              <TouchableOpacity style={[styles.actionIconBtn, styles.actionIconBtnDanger]} onPress={onCancel}>
                <Ionicons name="trash-outline" size={18} color="#FF4757" />
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {/* Pet finalizado — dica de toque pra abrir a ficha */}
      {!isActive && onPress && (
        <>
          <View style={styles.cardDivider} />
          <View style={styles.caseHint}>
            <Ionicons name="document-text-outline" size={15} color="#FF4757" />
            <Text style={styles.caseHintText}>Ver ficha completa do caso</Text>
            <Ionicons name="chevron-forward" size={16} color="#FF4757" />
          </View>
        </>
      )}
    </CardWrap>
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

const PremiumMenuOption = ({ isPremium, onPress }: { isPremium: boolean; onPress: () => void }) => (
  <TouchableOpacity style={styles.menuOption} activeOpacity={0.7} onPress={onPress}>
    <LinearGradient
      colors={['#FFD700', '#FFA502']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.menuIconContainer}
    >
      <Ionicons name="star" size={20} color="#FFF" />
    </LinearGradient>
    <Text style={styles.menuOptionTitle}>
      {isPremium ? 'Meu Premium ⭐' : 'Assinar Premium'}
    </Text>
    {!isPremium && (
      <View style={styles.premiumPill}>
        <Text style={styles.premiumPillText}>R$ 9,90</Text>
      </View>
    )}
    {isPremium && (
      <View style={styles.premiumActiveBadge}>
        <Text style={styles.premiumActiveBadgeText}>Ativo</Text>
      </View>
    )}
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
  premiumPill: {
    backgroundColor: '#FFF6E5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
  },
  premiumPillText: {
    color: '#FFA502',
    fontSize: 12,
    fontWeight: '800',
  },
  premiumActiveBadge: {
    backgroundColor: '#E8F8F0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
  },
  premiumActiveBadgeText: {
    color: '#2ED573',
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

  // PetCard v2 — layout aprimorado
  petCardV2: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardDateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F2F4F6' },
  cardDateText: { fontSize: 11.5, color: '#A4B0BE', fontWeight: '700' },
  cardRibbon: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  typePillText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  petCardTop: { flexDirection: 'row', gap: 14 },
  petCardImg: { width: 84, height: 84, borderRadius: 16, backgroundColor: '#DFE4EA' },
  petCardInfo: { flex: 1, justifyContent: 'flex-start' },
  petCardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  petCardName: { fontSize: 18, fontWeight: '900', color: '#2F3542', letterSpacing: -0.3 },
  statusDotBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotText: { fontSize: 11, fontWeight: '800' },
  petCardSubtitle: { fontSize: 13, color: '#747D8C', fontWeight: '600', marginTop: 4 },
  metaList: { marginTop: 10, gap: 5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: '#57606F', fontWeight: '600' },
  metaPending: { fontSize: 11, color: '#FFA502', fontWeight: '600' },

  cardDivider: { height: 1, backgroundColor: '#F1F2F6', marginVertical: 14 },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  actionPrimary: {
    flex: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#2ED573',
    shadowColor: '#2ED573',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  actionPrimaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  actionIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFF0F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionIconBtnDanger: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#FFE5E9',
  },
  caseHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  caseHintText: {
    color: '#FF4757',
    fontWeight: '800',
    fontSize: 13,
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
