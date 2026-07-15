import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView, Image, ActivityIndicator, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getSuccessCase, getPetDetails, getDonationConfig, API_URL, SuccessCase } from '../../services/api';
import { Avatar } from '../../components/Avatar';

// ============================================================================
// CASO DE SUCESSO — detalhe do final feliz (id = petId).
// Mostra a história publicada + acesso à ficha completa do caso.
// ============================================================================

export default function SuccessCaseDetailScreen() {
  const { id: petId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [sc, setSc] = useState<SuccessCase | null>(null);
  const [pet, setPet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [donationUrl, setDonationUrl] = useState(`${API_URL}/doar`);

  useEffect(() => {
    if (!petId) return;
    (async () => {
      try {
        const [s, p] = await Promise.all([
          getSuccessCase(petId as string),
          getPetDetails(petId as string).catch(() => null),
        ]);
        setSc(s);
        setPet(p);
      } catch (e) {
        console.warn('Erro ao carregar caso de sucesso', e);
      } finally {
        setLoading(false);
      }
    })();
    getDonationConfig().then((d) => { if (d.url) setDonationUrl(d.url); }).catch(() => {});
  }, [petId]);

  const handleShare = () => {
    const name = pet?.name ?? 'Um pet';
    Share.share({
      message:
        `🎉 ${name} teve um final feliz com a ajuda do PetPerdidoSOS!\n\n` +
        (sc?.message ? `“${sc.message}”\n\n` : '') +
        `Veja mais casos de sucesso e ajude a manter o app no ar: ${donationUrl}`,
    }).catch(() => {});
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#2ED573" />
      </View>
    );
  }

  if (!sc) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#2F3542" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Caso de Sucesso</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={44} color="#A4B0BE" />
          <Text style={styles.emptyTitle}>História não encontrada</Text>
          <Text style={styles.emptyText}>Este final feliz não está mais disponível.</Text>
        </View>
      </View>
    );
  }

  const photo = sc.photo_url || pet?.main_photo_url;
  const isDonation = pet?.type === 'donation';
  const concluded = sc.concluded_at ?? sc.created_at;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#2F3542" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Final feliz 🎉</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={21} color="#2F3542" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.heroCard}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.heroPhoto} />
          ) : (
            <View style={[styles.heroPhoto, styles.heroPhotoEmpty]}>
              <Ionicons name="paw" size={48} color="#DFE4EA" />
            </View>
          )}
          <View style={[styles.heroTag, { backgroundColor: isDonation ? '#3B82F6' : '#2ED573' }]}>
            <Ionicons name="checkmark-circle" size={13} color="#FFF" />
            <Text style={styles.heroTagText}>{isDonation ? 'ADOTADO' : 'REENCONTRADO'}</Text>
          </View>

          <View style={styles.heroBody}>
            <Text style={styles.petName}>{pet?.name ?? 'Pet'}</Text>
            {pet?.breed ? <Text style={styles.petBreed}>{pet.breed}</Text> : null}
            <Text style={styles.concludedAt}>
              Caso concluído em {format(new Date(concluded), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </Text>
            {sc.days_lost != null && sc.days_lost > 0 && (
              <View style={styles.daysChip}>
                <Ionicons name="time-outline" size={14} color="#26B765" />
                <Text style={styles.daysChipText}>
                  {sc.days_lost} dia{sc.days_lost > 1 ? 's' : ''} até o reencontro
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Mensagem do tutor */}
        {!!sc.message && (
          <View style={styles.messageCard}>
            <Ionicons name="chatbox-ellipses" size={20} color="#2ED573" />
            <Text style={styles.messageText}>“{sc.message}”</Text>
          </View>
        )}

        {/* Pessoas */}
        <View style={styles.peopleCard}>
          <View style={styles.personRow}>
            <Avatar uri={sc.tutor?.photo_url ?? undefined} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.personRole}>Tutor(a)</Text>
              <Text style={styles.personName}>{sc.tutor?.full_name ?? '—'}</Text>
            </View>
          </View>
          {!!sc.finder_name && (
            <View style={[styles.personRow, styles.personRowBorder]}>
              <View style={styles.heroIconBadge}>
                <Ionicons name="medal" size={20} color="#FFA502" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.personRole}>{isDonation ? 'Adotante' : 'Herói do resgate'}</Text>
                <Text style={styles.personName}>{sc.finder_name}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Ações */}
        <TouchableOpacity style={styles.caseBtn} activeOpacity={0.85} onPress={() => router.push(`/pet/case/${petId}`)}>
          <Ionicons name="document-text" size={19} color="#FFF" />
          <Text style={styles.caseBtnText}>Ver ficha completa do caso</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shareFullBtn} activeOpacity={0.85} onPress={handleShare}>
          <Ionicons name="share-social" size={18} color="#26B765" />
          <Text style={styles.shareFullBtnText}>Compartilhar este final feliz</Text>
        </TouchableOpacity>
      </ScrollView>
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
  shareBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#2F3542' },

  heroCard: {
    backgroundColor: '#FFF', borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  heroPhoto: { width: '100%', height: 260, backgroundColor: '#F1F2F6' },
  heroPhotoEmpty: { justifyContent: 'center', alignItems: 'center' },
  heroTag: {
    position: 'absolute', top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  heroTagText: { color: '#FFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  heroBody: { padding: 18 },
  petName: { fontSize: 24, fontWeight: '900', color: '#2F3542' },
  petBreed: { fontSize: 14, color: '#747D8C', fontWeight: '600', marginTop: 2 },
  concludedAt: { fontSize: 12.5, color: '#A4B0BE', marginTop: 6 },
  daysChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#E8F8F0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 10,
  },
  daysChipText: { color: '#26B765', fontSize: 12.5, fontWeight: '800' },

  messageCard: {
    flexDirection: 'row', gap: 12, backgroundColor: '#FFF', borderRadius: 20, padding: 18, marginTop: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  messageText: { flex: 1, fontSize: 15, color: '#2F3542', fontStyle: 'italic', lineHeight: 23 },

  peopleCard: {
    backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 16, marginTop: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  personRowBorder: { borderTopWidth: 1, borderTopColor: '#F1F2F6' },
  personRole: { fontSize: 11.5, color: '#A4B0BE', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  personName: { fontSize: 15, fontWeight: '800', color: '#2F3542', marginTop: 1 },
  heroIconBadge: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF6E5',
    justifyContent: 'center', alignItems: 'center',
  },

  caseBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#FF4757', borderRadius: 18,
    paddingVertical: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  caseBtnText: { color: '#FFF', fontSize: 15.5, fontWeight: '900' },
  shareFullBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#E8F8F0', borderRadius: 18,
    paddingVertical: 15, justifyContent: 'center', alignItems: 'center', marginTop: 12,
  },
  shareFullBtnText: { color: '#26B765', fontSize: 15, fontWeight: '800' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#2F3542', marginTop: 10 },
  emptyText: { fontSize: 14, color: '#A4B0BE', textAlign: 'center' },
});
