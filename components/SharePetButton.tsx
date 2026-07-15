import React, { useRef, useState } from 'react';
import { Modal, StyleSheet, View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from './Feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SPECIES: Record<string, string> = { cachorro: 'Cachorro', gato: 'Gato', passaro: 'Pássaro', outro: 'Pet' };
const SIZE: Record<string, string> = { pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande' };
const SEX: Record<string, string> = { macho: 'Macho', femea: 'Fêmea' };

// Tema por tipo de pet (coerente com o resto do app).
const TYPE_THEME: Record<string, { banner: string; grad: [string, string]; verb: string; cta: string }> = {
  lost:     { banner: 'PROCURA-SE',  grad: ['#FF6B81', '#FF4757'], verb: 'Desapareceu em', cta: 'Você viu esse pet? Ajude a reencontrar!' },
  sighted:  { banner: 'PET VISTO',   grad: ['#FFC312', '#F79F1F'], verb: 'Visto em',        cta: 'Conhece o tutor? Ajude no reencontro!' },
  rescued:  { banner: 'RESGATADO',   grad: ['#2ED573', '#20BF6B'], verb: 'Resgatado em',    cta: 'É o seu pet ou de alguém? Compartilhe!' },
  donation: { banner: 'PARA ADOÇÃO', grad: ['#60A5FA', '#3B82F6'], verb: 'Disponível desde',cta: 'Que tal dar um lar pra ele? Adote!' },
};

function fmt(d?: string | null) {
  if (!d) return null;
  const x = new Date(`${d}T00:00:00`);
  return Number.isNaN(x.getTime()) ? null : format(x, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
}
function money(v?: number | null) {
  if (v == null || !(v > 0)) return null;
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Card = a "publicação destacada" que será capturada como imagem e compartilhada.
function ShareCard({ pet, address }: { pet: any; address?: string | null }) {
  const type = pet?.type ?? 'lost';
  const t = TYPE_THEME[type] ?? TYPE_THEME.lost;
  const photo = pet?.main_photo_url || pet?.photo_url || pet?.photo || (Array.isArray(pet?.gallery) ? pet.gallery[0] : null);
  const chips = [pet?.species ? SPECIES[pet.species] : null, pet?.breed, pet?.size ? SIZE[pet.size] : null, pet?.sex ? SEX[pet.sex] : null].filter(Boolean);
  const when = fmt(pet?.lost_date);
  // Aceita as duas formas: reward_amount (detalhe) e reward.amount (pins do mapa).
  const reward = money(pet?.reward_amount ?? pet?.reward?.amount);
  // Doação: concorda o pronome com o sexo do pet (evita "ele" numa fêmea).
  const cta = type === 'donation'
    ? (pet?.sex === 'femea' ? 'Que tal dar um lar pra ela? Adote!'
      : pet?.sex === 'macho' ? 'Que tal dar um lar pra ele? Adote!'
      : 'Que tal dar um lar? Adote!')
    : t.cta;

  return (
    <View style={styles.card}>
      <LinearGradient colors={t.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <Ionicons name="paw" size={18} color="#FFF" />
        <Text style={styles.bannerText}>{t.banner}</Text>
      </LinearGradient>

      <View style={styles.photoWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPh]}><Ionicons name="paw" size={54} color={t.grad[1]} /></View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{pet?.name ?? 'Pet'}</Text>
        {chips.length > 0 && (
          <View style={styles.chips}>
            {chips.map((c, i) => (
              <View key={i} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
            ))}
          </View>
        )}

        {when && (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#747D8C" />
            <Text style={styles.infoText}>{t.verb} {when}</Text>
          </View>
        )}
        {!!address && (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={15} color="#747D8C" />
            <Text style={styles.infoText} numberOfLines={2}>{address}</Text>
          </View>
        )}
        {reward && (
          <View style={styles.reward}>
            <Ionicons name="gift" size={15} color="#8A6D00" />
            <Text style={styles.rewardText}>Recompensa {reward}</Text>
          </View>
        )}

        <Text style={[styles.cta, { color: t.grad[1] }]}>{cta}</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.logoDot}><Ionicons name="paw" size={14} color="#FFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>PetPerdidoSOS</Text>
          <Text style={styles.brandSub}>Baixe o app e ajude a reencontrar 🐾</Text>
        </View>
      </View>
    </View>
  );
}

export function SharePetButton({ pet, address, style, label = 'Compartilhar', iconSize = 18 }: { pet: any; address?: string | null; style?: any; label?: string; iconSize?: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShot>(null);

  const doShare = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const available = await Sharing.isAvailableAsync();
      if (!available) { toast.error('Compartilhamento indisponível neste aparelho.'); return; }
      // captura o card 2x para uma imagem nítida
      const uri = await (shotRef.current as any)?.capture?.();
      if (!uri) throw new Error('Não foi possível gerar a imagem.');
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: `Ajude a encontrar ${pet?.name ?? 'este pet'}`,
        UTI: 'public.png',
      });
    } catch {
      // usuário pode cancelar o share — não trata como erro
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={style ?? styles.trigger} activeOpacity={0.85} onPress={() => setOpen(true)}>
        <Ionicons name="share-social" size={iconSize} color="#FF4757" />
        {!!label && <Text style={styles.triggerText}>{label}</Text>}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Compartilhar publicação</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#747D8C" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
              <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
                <ShareCard pet={pet} address={address} />
              </ViewShot>
            </ScrollView>

            <TouchableOpacity style={[styles.shareBtn, busy && { opacity: 0.7 }]} activeOpacity={0.9} onPress={doShare} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social'} size={20} color="#FFF" />
                  <Text style={styles.shareBtnText}>Compartilhar publicação</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 14, backgroundColor: '#FFF0F1' },
  triggerText: { color: '#FF4757', fontWeight: '800', fontSize: 14 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#F1F2F6', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 26, maxHeight: '92%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542' },

  card: { width: 320, backgroundColor: '#FFF', borderRadius: 24, overflow: 'hidden' },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11 },
  bannerText: { color: '#FFF', fontWeight: '900', fontSize: 17, letterSpacing: 2 },
  photoWrap: { paddingHorizontal: 14, paddingTop: 14 },
  photo: { width: '100%', height: 210, borderRadius: 18, backgroundColor: '#F1F2F6' },
  photoPh: { justifyContent: 'center', alignItems: 'center' },
  body: { paddingHorizontal: 18, paddingTop: 14 },
  name: { fontSize: 26, fontWeight: '900', color: '#2F3542', letterSpacing: -0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: '#F1F2F6', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12.5, fontWeight: '700', color: '#57606F' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  infoText: { fontSize: 13.5, color: '#57606F', fontWeight: '600', flex: 1 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#FFF4D6', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, marginTop: 12 },
  rewardText: { fontSize: 13.5, fontWeight: '800', color: '#8A6D00' },
  cta: { fontSize: 14.5, fontWeight: '800', marginTop: 14, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECECEC' },
  logoDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FF4757', justifyContent: 'center', alignItems: 'center' },
  brand: { fontSize: 14, fontWeight: '900', color: '#2F3542' },
  brandSub: { fontSize: 11.5, color: '#A4B0BE', fontWeight: '600', marginTop: 1 },

  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 16, backgroundColor: '#FF4757', marginTop: 12, shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  shareBtnText: { color: '#FFF', fontWeight: '900', fontSize: 16 },
});
