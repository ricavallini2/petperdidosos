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

// Compartilhamento do CASO DE SUCESSO como card de imagem (mesmo padrão do
// SharePetButton dos alertas). Antes era só texto via Share.share.

function fmtDate(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
}

// Card = a "publicação destacada" capturada como imagem.
function SuccessCard({ sc, pet }: { sc: any; pet?: any }) {
  const isDonation = (pet?.type ?? sc?.pets?.type) === 'donation';
  const grad: [string, string] = isDonation ? ['#60A5FA', '#3B82F6'] : ['#2ED573', '#20BF6B'];
  const accent = grad[1];
  const banner = isDonation ? 'ADOTADO' : 'FINAL FELIZ';
  const name = pet?.name ?? sc?.pets?.name ?? 'Pet';
  const photo = sc?.photo_url || pet?.main_photo_url || sc?.pets?.main_photo_url;
  const concluded = fmtDate(sc?.concluded_at ?? sc?.created_at);
  const daysLost = sc?.days_lost != null && sc.days_lost > 0 ? sc.days_lost : null;

  return (
    <View style={styles.card}>
      <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <Ionicons name="trophy" size={18} color="#FFF" />
        <Text style={styles.bannerText}>{banner}</Text>
      </LinearGradient>

      <View style={styles.photoWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPh]}><Ionicons name="paw" size={54} color={accent} /></View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>

        {!!sc?.message && (
          <Text style={styles.quote} numberOfLines={5}>“{sc.message}”</Text>
        )}

        {concluded && (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color="#747D8C" />
            <Text style={styles.infoText}>{isDonation ? 'Adotado em' : 'Final feliz em'} {concluded}</Text>
          </View>
        )}
        {daysLost && (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={15} color="#747D8C" />
            <Text style={styles.infoText}>{daysLost} dia{daysLost > 1 ? 's' : ''} até o reencontro</Text>
          </View>
        )}
        {!!sc?.finder_name && (
          <View style={styles.heroRow}>
            <Ionicons name="medal" size={15} color="#8A6D00" />
            <Text style={styles.heroText}>{isDonation ? 'Adotante' : 'Herói do resgate'}: {sc.finder_name}</Text>
          </View>
        )}

        <Text style={[styles.cta, { color: accent }]}>
          {isDonation ? 'Mais um pet ganhou um lar! Adote você também. 🐾' : 'Mais um reencontro! Baixe o app e ajude a criar finais felizes. 🐾'}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.logoDot}><Ionicons name="paw" size={14} color="#FFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>PetPerdidoSOS</Text>
          <Text style={styles.brandSub}>A rede que reúne pets perdidos aos seus tutores</Text>
        </View>
      </View>
    </View>
  );
}

export function ShareSuccessButton({ sc, pet, style, label = 'Compartilhar', iconSize = 18 }: { sc: any; pet?: any; style?: any; label?: string; iconSize?: number }) {
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
      const uri = await (shotRef.current as any)?.capture?.();
      if (!uri) throw new Error('Não foi possível gerar a imagem.');
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: `Final feliz de ${pet?.name ?? sc?.pets?.name ?? 'um pet'}`,
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
        <Ionicons name="share-social" size={iconSize} color="#26B765" />
        {!!label && <Text style={styles.triggerText}>{label}</Text>}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Compartilhar final feliz</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#747D8C" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
              <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
                <SuccessCard sc={sc} pet={pet} />
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
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 14, backgroundColor: '#E8F8F0' },
  triggerText: { color: '#26B765', fontWeight: '800', fontSize: 15 },

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
  quote: { fontSize: 14, color: '#57606F', fontStyle: 'italic', lineHeight: 21, marginTop: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  infoText: { fontSize: 13.5, color: '#57606F', fontWeight: '600', flex: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#FFF4D6', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, marginTop: 12 },
  heroText: { fontSize: 13.5, fontWeight: '800', color: '#8A6D00' },
  cta: { fontSize: 14.5, fontWeight: '800', marginTop: 14, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECECEC' },
  logoDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2ED573', justifyContent: 'center', alignItems: 'center' },
  brand: { fontSize: 14, fontWeight: '900', color: '#2F3542' },
  brandSub: { fontSize: 11.5, color: '#A4B0BE', fontWeight: '600', marginTop: 1 },

  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 16, backgroundColor: '#2ED573', marginTop: 12, shadowColor: '#2ED573', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  shareBtnText: { color: '#FFF', fontWeight: '900', fontSize: 16 },
});
