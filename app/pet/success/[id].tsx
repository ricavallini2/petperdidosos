import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, Image,
  ActivityIndicator, Switch, Linking,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../services/supabase';
import { prepareForUpload } from '../../../services/upload';
import { getPetDetails, getSuccessCase, saveSuccessCase, getDonationConfig, API_URL } from '../../../services/api';
import { toast } from '../../../components/Feedback';

// ============================================================================
// FINAL FELIZ — tela mostrada ao tutor quando o caso é concluído.
// 1) Registra foto + mensagem do reencontro (com consentimento de publicação
//    no app e no site — opt-in explícito).
// 2) Agradece e convida a apoiar o app (link da página de doação).
// ============================================================================

export default function SuccessCaseScreen() {
  const { id: petId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = useState<'form' | 'thanks'>('form');
  const [pet, setPet] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [photoUri, setPhotoUri] = useState<string | null>(null); // local (novo)
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null); // já registrado
  const [message, setMessage] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);

  const [donation, setDonation] = useState<{ pixKey: string | null; url: string | null }>({ pixKey: null, url: null });
  const donationUrl = donation.url || `${API_URL}/doar`;

  useEffect(() => {
    if (!petId) return;
    (async () => {
      try {
        const [p, sc] = await Promise.all([
          getPetDetails(petId as string),
          getSuccessCase(petId as string).catch(() => null),
        ]);
        setPet(p);
        if (sc) {
          // Já registrado antes → permite editar
          setMessage(sc.message ?? '');
          setAuthorized(sc.authorized === true);
          setSavedPhotoUrl(sc.photo_url ?? null);
        }
      } catch (e) {
        console.warn('Erro ao carregar final feliz', e);
      } finally {
        setLoading(false);
      }
    })();
    getDonationConfig().then(setDonation).catch(() => {});
  }, [petId]);

  const isDonationCase = pet?.type === 'donation';
  const isFemale = pet?.sex === 'femea';
  const headline = isDonationCase
    ? `${pet?.name ?? 'O pet'} foi ${isFemale ? 'adotada' : 'adotado'}! 🎉`
    : `${pet?.name ?? 'O pet'} está em casa! 🎉`;

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return toast.warning('Permissão negada.');
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    // Redimensiona já na escolha (evita OOM de foto 12MP no iOS)
    setPhotoUri(await prepareForUpload(result.assets[0].uri));
  };

  const handleSave = async () => {
    if (!petId || !user) return;
    if (!message.trim() && !photoUri && !savedPhotoUrl) {
      return toast.warning('Adicione uma foto ou escreva uma mensagem do reencontro.');
    }
    setSaving(true);
    try {
      let photoUrl: string | null = savedPhotoUrl;
      if (photoUri) {
        const fileName = `success_${petId}_${Date.now()}.jpg`;
        const base64 = await FileSystem.readAsStringAsync(photoUri, { encoding: 'base64' });
        const { error: upErr } = await supabase.storage
          .from('pets')
          .upload(fileName, decode(base64), { contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from('pets').getPublicUrl(fileName).data.publicUrl;
      }
      await saveSuccessCase(petId as string, {
        photoUrl,
        message: message.trim(),
        authorized,
      });
      toast.success(
        authorized
          ? 'Seu final feliz agora inspira outras pessoas. 💚'
          : 'Final feliz registrado na ficha do caso.',
        'Registrado! 🎉'
      );
      setStep('thanks');
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#2ED573" />
      </View>
    );
  }

  // ── Passo 2: agradecimento + convite pra apoiar o app ──
  if (step === 'thanks') {
    return (
      <View style={styles.container}>
        <View style={styles.thanksWrap}>
          <LinearGradient colors={['#2ED573', '#26B765']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.thanksHero}>
            <View style={styles.thanksIcon}>
              <Ionicons name="heart" size={34} color="#26B765" />
            </View>
            <Text style={styles.thanksTitle}>Que bom que deu certo! 💚</Text>
            <Text style={styles.thanksSub}>
              Histórias como a {isFemale ? 'da' : 'do'} {pet?.name ?? 'seu pet'} só acontecem porque o app
              continua no ar — e ele é gratuito para todo mundo.
            </Text>
          </LinearGradient>

          <View style={styles.thanksCard}>
            <Text style={styles.thanksCardTitle}>Ajude o próximo reencontro</Text>
            <Text style={styles.thanksCardText}>
              Uma doação voluntária, de qualquer valor, mantém os mapas, as notificações e a busca por IA
              funcionando para outros tutores.
            </Text>
            <TouchableOpacity style={styles.donateBtn} activeOpacity={0.85} onPress={() => Linking.openURL(donationUrl)}>
              <Ionicons name="heart" size={19} color="#FFF" />
              <Text style={styles.donateBtnText}>Apoiar o PetPerdidoSOS</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.finishBtn} onPress={() => router.replace('/(tabs)/profile')}>
            <Text style={styles.finishBtnText}>Concluir</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Passo 1: registrar o final feliz ──
  const previewUri = photoUri || savedPhotoUrl || pet?.main_photo_url || null;

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
        <LinearGradient colors={['#2ED573', '#26B765']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setStep('thanks')}>
            <Ionicons name="close" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.heroEmoji}>🎉</Text>
          <Text style={styles.heroTitle}>{headline}</Text>
          <Text style={styles.heroSub}>
            Registre esse final feliz: a história fica na ficha do caso e pode inspirar quem ainda está procurando.
          </Text>
        </LinearGradient>

        <View style={styles.body}>
          {/* Foto */}
          <Text style={styles.label}>Foto do reencontro</Text>
          <View style={styles.photoCard}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <Ionicons name="image-outline" size={38} color="#A4B0BE" />
              </View>
            )}
            <View style={styles.photoBtns}>
              <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto(true)}>
                <Ionicons name="camera" size={18} color="#26B765" />
                <Text style={styles.photoBtnText}>Câmera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto(false)}>
                <Ionicons name="images" size={18} color="#26B765" />
                <Text style={styles.photoBtnText}>Galeria</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Mensagem */}
          <Text style={styles.label}>Mensagem do final feliz</Text>
          <TextInput
            style={styles.input}
            placeholder={`Conte como foi o reencontro ${isFemale ? 'da' : 'do'} ${pet?.name ?? 'seu pet'}…`}
            placeholderTextColor="#A4B0BE"
            multiline
            maxLength={600}
            value={message}
            onChangeText={setMessage}
          />
          <Text style={styles.counter}>{message.length}/600</Text>

          {/* Consentimento de publicação */}
          <View style={styles.consentCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.consentTitle}>Publicar este final feliz</Text>
              <Text style={styles.consentText}>
                Autorizo mostrar a foto e a mensagem na área Casos de Sucesso do app e no site do PetPerdidoSOS.
              </Text>
            </View>
            <Switch
              value={authorized}
              onValueChange={setAuthorized}
              trackColor={{ false: '#DFE4EA', true: '#7BE8A8' }}
              thumbColor={authorized ? '#2ED573' : '#FFF'}
            />
          </View>

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} disabled={saving} onPress={handleSave}>
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                <Text style={styles.saveBtnText}>{authorized ? 'Publicar final feliz' : 'Salvar final feliz'}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={() => setStep('thanks')}>
            <Text style={styles.skipBtnText}>Agora não</Text>
          </TouchableOpacity>
        </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },

  hero: { paddingTop: 64, paddingBottom: 28, paddingHorizontal: 24, alignItems: 'center', borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  closeBtn: {
    position: 'absolute', top: 54, right: 18, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center',
  },
  heroEmoji: { fontSize: 44 },
  heroTitle: { color: '#FFF', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  heroSub: { color: 'rgba(255,255,255,0.95)', fontSize: 13.5, textAlign: 'center', marginTop: 8, lineHeight: 19 },

  body: { padding: 16 },
  label: {
    fontSize: 13, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 16, marginBottom: 8, marginLeft: 4,
  },
  photoCard: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  photo: { width: '100%', height: 220, borderRadius: 14, backgroundColor: '#F1F2F6' },
  photoEmpty: { justifyContent: 'center', alignItems: 'center' },
  photoBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  photoBtn: {
    flex: 1, flexDirection: 'row', gap: 6, height: 42, borderRadius: 12,
    backgroundColor: '#E8F8F0', justifyContent: 'center', alignItems: 'center',
  },
  photoBtnText: { color: '#26B765', fontWeight: '800', fontSize: 13.5 },

  input: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 16, minHeight: 110,
    fontSize: 15, color: '#2F3542', textAlignVertical: 'top',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: '#A4B0BE', marginTop: 4, marginRight: 6 },

  consentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF',
    borderRadius: 20, padding: 16, marginTop: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  consentTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  consentText: { fontSize: 12.5, color: '#747D8C', marginTop: 3, lineHeight: 18 },

  saveBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#2ED573', borderRadius: 18,
    paddingVertical: 17, justifyContent: 'center', alignItems: 'center', marginTop: 20,
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  saveBtnText: { color: '#FFF', fontSize: 16.5, fontWeight: '900' },
  skipBtn: { paddingVertical: 16, alignItems: 'center' },
  skipBtnText: { color: '#747D8C', fontWeight: '700', fontSize: 14 },

  // Passo 2
  thanksWrap: { flex: 1, padding: 16, paddingTop: 70 },
  thanksHero: {
    borderRadius: 24, padding: 26, alignItems: 'center',
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 6,
  },
  thanksIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  thanksTitle: { color: '#FFF', fontSize: 23, fontWeight: '900', textAlign: 'center' },
  thanksSub: { color: 'rgba(255,255,255,0.95)', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 21 },

  thanksCard: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 20, marginTop: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  thanksCardTitle: { fontSize: 17, fontWeight: '900', color: '#2F3542' },
  thanksCardText: { fontSize: 13.5, color: '#747D8C', marginTop: 6, lineHeight: 20 },
  donateBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#2ED573', borderRadius: 16,
    paddingVertical: 15, justifyContent: 'center', alignItems: 'center', marginTop: 16,
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 9, elevation: 4,
  },
  donateBtnText: { color: '#FFF', fontSize: 15.5, fontWeight: '900' },

  finishBtn: { paddingVertical: 18, alignItems: 'center' },
  finishBtnText: { color: '#747D8C', fontWeight: '800', fontSize: 15 },
});
