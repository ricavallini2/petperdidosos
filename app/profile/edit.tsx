import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { getUserProfile, updateUserProfile } from '../../services/api';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../services/supabase';
import { toast } from '../../components/Feedback';

// Máscaras simples
const maskCpf = (v: string) =>
  v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

const maskPhone = (v: string) =>
  v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const data = await getUserProfile(user.id);
        setName(data?.full_name ?? data?.name ?? '');
        setBio(data?.bio ?? '');
        setCpf(data?.cpf ?? '');
        setPhone(data?.phone ?? '');
        setPixKey(data?.pix_key ?? '');
        setExistingPhotoUrl(data?.photo_url ?? undefined);
      } catch (e) {
        console.warn('Não foi possível carregar perfil', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [user]);

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return toast.warning('Permissão negada para acessar a galeria.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (!result.canceled && result.assets?.length) setPhotoUri(result.assets[0].uri);
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.warning('Digite seu nome completo.');
    if (!user) return;

    setIsSaving(true);
    try {
      let photoUrlPatch: string | undefined;
      if (photoUri) {
        const ext = photoUri.substring(photoUri.lastIndexOf('.') + 1) || 'jpg';
        const fileName = `profile_${user.id}_${Date.now()}.${ext}`;
        const base64 = await FileSystem.readAsStringAsync(photoUri, { encoding: 'base64' });
        const { error: uploadError } = await supabase.storage
          .from('pets')
          .upload(fileName, decode(base64), { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
        if (uploadError) throw uploadError;
        photoUrlPatch = supabase.storage.from('pets').getPublicUrl(fileName).data.publicUrl;
      }

      await updateUserProfile(user.id, {
        full_name: name.trim(),
        bio: bio.trim(),
        photo_url: photoUrlPatch,
        cpf: cpf.replace(/\D/g, '') || undefined,
        phone: phone.replace(/\D/g, '') || undefined,
        pix_key: pixKey.trim() || undefined,
      });
      toast.success('Perfil atualizado!');
      router.back();
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro ao atualizar perfil');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Editar Perfil</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.avatarContainer} onPress={handlePickImage}>
          {photoUri || existingPhotoUrl ? (
            <Image source={{ uri: photoUri ?? existingPhotoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={50} color="#DFE4EA" />
            </View>
          )}
          <View style={styles.editBadge}>
            <Ionicons name="camera" size={16} color="#FFF" />
          </View>
        </TouchableOpacity>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nome completo</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
            <TextInput style={styles.input} placeholder="Ex: João da Silva" placeholderTextColor="#A4B0BE" value={name} onChangeText={setName} />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Descrição do perfil</Text>
          <View style={[styles.inputWrapper, styles.inputWrapperMultiline]}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#A4B0BE" style={styles.inputIconTop} />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Ex: Amante de animais"
              placeholderTextColor="#A4B0BE"
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={120}
            />
          </View>
          <Text style={styles.charCount}>{bio.length}/120</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>CPF</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="card-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="000.000.000-00"
              placeholderTextColor="#A4B0BE"
              value={cpf}
              onChangeText={(t) => setCpf(maskCpf(t))}
              keyboardType="numeric"
              maxLength={14}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Celular</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="call-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="(11) 99999-9999"
              placeholderTextColor="#A4B0BE"
              value={phone}
              onChangeText={(t) => setPhone(maskPhone(t))}
              keyboardType="phone-pad"
              maxLength={15}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Chave PIX (para receber recompensas)</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="cash-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="CPF, e-mail, celular ou chave aleatória"
              placeholderTextColor="#A4B0BE"
              value={pixKey}
              onChangeText={setPixKey}
              autoCapitalize="none"
            />
          </View>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={isSaving}>
          {isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Salvar Alterações</Text>}
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: {
    paddingTop: 54, paddingHorizontal: 16, paddingBottom: 18,
    flexDirection: 'row', alignItems: 'center',
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },
  content: { padding: 24, alignItems: 'center' },
  avatarContainer: { position: 'relative', marginBottom: 30 },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  avatarPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center' },
  editBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#FF4757', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#FFF' },
  inputGroup: { width: '100%', marginBottom: 18 },
  label: { fontSize: 14, fontWeight: '700', color: '#2F3542', marginBottom: 8, marginLeft: 4 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F2F6', borderRadius: 16, paddingHorizontal: 16, height: 56 },
  inputWrapperMultiline: { height: undefined, minHeight: 80, alignItems: 'flex-start', paddingVertical: 14 },
  inputIcon: { marginRight: 12 },
  inputIconTop: { marginRight: 12, marginTop: 2 },
  input: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '500' },
  inputMultiline: { textAlignVertical: 'top', minHeight: 52 },
  charCount: { fontSize: 12, color: '#A4B0BE', alignSelf: 'flex-end', marginTop: 6, marginRight: 4 },
  saveBtn: { backgroundColor: '#FF4757', width: '100%', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8, marginTop: 12 },
  saveBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});
