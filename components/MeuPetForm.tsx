import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, Image, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import DateTimePicker from '@react-native-community/datetimepicker';
import DateTimePickerSheet from './DateTimePickerSheet';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { decode } from 'base64-arraybuffer';
import { useRouter } from 'expo-router';
import { supabase } from '../services/supabase';
import { prepareForUpload } from '../services/upload';
import { toast, showActionSheet } from './Feedback';
import {
  createMyPet, updateMyPet, CreateMyPetInput, MyPet, PetSize, PetSex, PetSpecies,
} from '../services/api';

const SPECIES_OPTIONS: { value: PetSpecies; label: string }[] = [
  { value: 'cachorro', label: 'Cachorro' },
  { value: 'gato', label: 'Gato' },
  { value: 'passaro', label: 'Pássaro' },
  { value: 'outro', label: 'Outro' },
];

type Props = { title: string; petId?: string; initial?: MyPet | null };

export default function MeuPetForm({ title, petId, initial }: Props) {
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? '');
  const [species, setSpecies] = useState<PetSpecies | null>(initial?.species ?? null);
  const [breed, setBreed] = useState(initial?.breed ?? '');
  const [color, setColor] = useState(initial?.color ?? '');
  const [size, setSize] = useState<PetSize | null>(initial?.size ?? null);
  const [sex, setSex] = useState<PetSex | null>(initial?.sex && initial.sex !== 'desconhecido' ? initial.sex : null);
  const [birthDate, setBirthDate] = useState<Date | null>(
    initial?.birth_date ? new Date(`${initial.birth_date}T00:00:00`) : null,
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [microchip, setMicrochip] = useState(initial?.microchip ?? '');
  const [neutered, setNeutered] = useState(initial?.neutered ?? false);
  const [healthNotes, setHealthNotes] = useState(initial?.health_notes ?? '');

  const [mainPhoto, setMainPhoto] = useState<string | null>(initial?.main_photo_url ?? null);
  const [extraPhotos, setExtraPhotos] = useState<(string | null)[]>(() => {
    const e = initial?.extra_photos ?? [];
    return [e[0] ?? null, e[1] ?? null, e[2] ?? null];
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const applyPicked = (slot: 'main' | number, uri: string) => {
    if (slot === 'main') setMainPhoto(uri);
    else setExtraPhotos((prev) => prev.map((p, i) => (i === slot ? uri : p)));
  };

  const launch = async (slot: 'main' | number, source: 'camera' | 'gallery') => {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      toast.warning(source === 'camera' ? 'Precisamos de permissão para a câmera.' : 'Precisamos de permissão para a galeria.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: slot === 'main' ? [1, 1] : [4, 3],
      quality: 0.7,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.length) return;
    applyPicked(slot, await prepareForUpload(result.assets[0].uri));
  };

  const pickImage = (slot: 'main' | number) => {
    showActionSheet({
      title: 'Adicionar foto',
      message: 'Escolha a origem da foto',
      icon: 'image-outline',
      options: [
        { label: 'Câmera', icon: 'camera-outline', primary: true, onPress: () => launch(slot, 'camera') },
        { label: 'Galeria', icon: 'images-outline', onPress: () => launch(slot, 'gallery') },
      ],
    });
  };

  const uploadImage = async (uri: string): Promise<string> => {
    if (/^https?:\/\//.test(uri)) return uri; // já é remota — não re-envia
    const ext = uri.substring(uri.lastIndexOf('.') + 1) || 'jpg';
    const fileName = `mypet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const { error } = await supabase.storage
      .from('pets')
      .upload(fileName, decode(base64), { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (error) throw error;
    const { data } = supabase.storage.from('pets').getPublicUrl(fileName);
    return data.publicUrl;
  };

  // Android apenas: diálogo nativo. No iOS o picker vive no DateTimePickerSheet.
  const onChangeDate = (event: any, selected?: Date) => {
    if (Platform.OS !== 'android') return;
    setShowDatePicker(false);
    if (event?.type === 'dismissed' || !selected) return;
    setBirthDate(selected);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return toast.warning('Informe o nome do pet');
    setIsSubmitting(true);
    try {
      const mainUrl = mainPhoto ? await uploadImage(mainPhoto) : null;
      const extras: string[] = [];
      for (const uri of extraPhotos) {
        if (uri) extras.push(await uploadImage(uri));
      }
      const payload: CreateMyPetInput = {
        name: name.trim(),
        species: species ?? null,
        breed: breed.trim() || null,
        color: color.trim() || null,
        size: size ?? null,
        sex: sex ?? null,
        birth_date: birthDate ? format(birthDate, 'yyyy-MM-dd') : null,
        microchip: microchip.trim() || null,
        neutered,
        health_notes: healthNotes.trim() || null,
        main_photo_url: mainUrl,
        extra_photos: extras,
      };
      if (petId) {
        await updateMyPet(petId, payload);
        toast.success('Ficha atualizada!');
      } else {
        await createMyPet(payload);
        toast.success('Pet cadastrado!');
      }
      router.back();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={undefined}>
      <KeyboardAwareScrollView bottomOffset={24} style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
          <TouchableOpacity style={styles.headerBack} activeOpacity={0.8} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
            <Text style={styles.headerBackText}>Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerSubtitle}>Só o nome é obrigatório — o resto é opcional.</Text>
        </LinearGradient>

        <View style={styles.formContainer}>
          {/* Foto principal */}
          <Text style={styles.sectionTitle}>Foto</Text>
          <TouchableOpacity style={styles.imagePicker} activeOpacity={0.8} onPress={() => pickImage('main')}>
            {mainPhoto ? (
              <Image source={{ uri: mainPhoto }} style={styles.imagePreview} />
            ) : (
              <>
                <View style={styles.imagePickerIcon}>
                  <Ionicons name="camera" size={32} color="#FF4757" />
                </View>
                <Text style={styles.imagePickerText}>Adicionar foto</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.helperLabel}>Fotos adicionais (até 3, opcional)</Text>
          <View style={styles.extraPhotosRow}>
            {extraPhotos.map((uri, i) => (
              <TouchableOpacity key={i} style={styles.extraPhotoSlot} onPress={() => pickImage(i)} activeOpacity={0.8}>
                {uri ? <Image source={{ uri }} style={styles.extraPhotoImg} /> : <Ionicons name="add" size={28} color="#A4B0BE" />}
              </TouchableOpacity>
            ))}
          </View>

          {/* Identificação */}
          <Text style={styles.sectionTitle}>Identificação</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nome do pet</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="paw-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Ex: Rex, Mel, Thor..." placeholderTextColor="#A4B0BE" value={name} onChangeText={setName} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Espécie</Text>
            <View style={styles.speciesRow}>
              {SPECIES_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.speciesPill, species === opt.value && styles.pillActive]}
                  onPress={() => setSpecies((prev) => (prev === opt.value ? null : opt.value))}
                >
                  <Text style={[styles.speciesPillText, species === opt.value && styles.pillTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Raça (opcional)</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="ribbon-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Ex: Poodle, Vira-lata, Persa..." placeholderTextColor="#A4B0BE" value={breed} onChangeText={setBreed} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Cor (opcional)</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="color-palette-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Ex: Caramelo, Preto e branco..." placeholderTextColor="#A4B0BE" value={color} onChangeText={setColor} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Porte (opcional)</Text>
            <View style={styles.sizeRow}>
              {(['pequeno', 'medio', 'grande'] as PetSize[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.sizePill, size === opt && styles.pillActive]}
                  onPress={() => setSize((prev) => (prev === opt ? null : opt))}
                >
                  <Text style={[styles.sizePillText, size === opt && styles.pillTextActive]}>
                    {opt === 'pequeno' ? 'Pequeno' : opt === 'medio' ? 'Médio' : 'Grande'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Sexo (opcional)</Text>
            <View style={styles.sizeRow}>
              {([['macho', 'Macho'], ['femea', 'Fêmea']] as [PetSex, string][]).map(([val, lbl]) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.sizePill, sex === val && styles.pillActive]}
                  onPress={() => setSex((prev) => (prev === val ? null : val))}
                >
                  <Text style={[styles.sizePillText, sex === val && styles.pillTextActive]}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nascimento (opcional)</Text>
            <TouchableOpacity style={styles.locationButton} activeOpacity={0.8} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={22} color="#2F3542" />
              <Text style={[styles.locationButtonText, !birthDate && { color: '#A4B0BE' }]}>
                {birthDate ? format(birthDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Não informado'}
              </Text>
              {birthDate ? (
                <TouchableOpacity onPress={() => setBirthDate(null)} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color="#A4B0BE" />
                </TouchableOpacity>
              ) : (
                <Ionicons name="pencil-outline" size={20} color="#A4B0BE" />
              )}
            </TouchableOpacity>
            {Platform.OS === 'android' && showDatePicker && (
              <DateTimePicker
                value={birthDate ?? new Date()}
                mode="date"
                display="default"
                maximumDate={new Date()}
                onChange={onChangeDate}
                locale="pt-BR"
              />
            )}
            <DateTimePickerSheet
              visible={Platform.OS === 'ios' && showDatePicker}
              value={birthDate ?? new Date()}
              mode="date"
              title="Data de nascimento"
              maximumDate={new Date()}
              onConfirm={(d) => { setBirthDate(d); setShowDatePicker(false); }}
              onCancel={() => setShowDatePicker(false)}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Microchip (opcional)</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="hardware-chip-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Número do microchip" placeholderTextColor="#A4B0BE" value={microchip} onChangeText={setMicrochip} />
            </View>
          </View>

          <View style={styles.flagCard}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.flagTitle}>Castrado</Text>
              <Text style={styles.flagSub}>Indique se o pet já foi castrado.</Text>
            </View>
            <TouchableOpacity style={[styles.toggle, neutered && styles.toggleActive]} onPress={() => setNeutered((v) => !v)}>
              <View style={[styles.toggleDot, neutered && styles.toggleDotActive]} />
            </TouchableOpacity>
          </View>

          <View style={[styles.inputGroup, { marginTop: 16 }]}>
            <Text style={styles.label}>Observações de saúde (opcional)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Alergias, condições, medicação contínua..."
              placeholderTextColor="#A4B0BE"
              value={healthNotes}
              onChangeText={setHealthNotes}
              multiline
              numberOfLines={3}
            />
          </View>

          <TouchableOpacity style={styles.submitWrapper} activeOpacity={0.9} onPress={handleSubmit} disabled={isSubmitting}>
            <LinearGradient
              colors={isSubmitting ? ['#A4B0BE', '#A4B0BE'] : ['#FF6B81', '#FF4757']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitButton}
            >
              <Text style={styles.submitText}>{isSubmitting ? 'Salvando...' : petId ? 'Salvar alterações' : 'Cadastrar pet'}</Text>
              {!isSubmitting && <Ionicons name="checkmark" size={22} color="#FFF" />}
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 150 }} />
        </View>
      </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 70, paddingHorizontal: 24, paddingBottom: 30,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 10, opacity: 0.95 },
  headerBackText: { color: '#FFF', fontSize: 14, fontWeight: '700', marginLeft: 6 },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 8, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 22, fontWeight: '500' },
  formContainer: { padding: 20, paddingTop: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginTop: 8, marginBottom: 14 },

  imagePicker: {
    width: '100%', height: 180, backgroundColor: '#FFFFFF', borderRadius: 20,
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#DFE4EA', borderStyle: 'dashed', marginBottom: 14, overflow: 'hidden',
  },
  imagePickerIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF0F1', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  imagePickerText: { fontSize: 16, color: '#2F3542', fontWeight: '700' },
  imagePreview: { width: '100%', height: '100%' },
  helperLabel: { fontSize: 13, color: '#747D8C', marginBottom: 8, fontWeight: '600' },
  extraPhotosRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  extraPhotoSlot: {
    flex: 1, aspectRatio: 1, backgroundColor: '#FFF', borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#DFE4EA', borderStyle: 'dashed', overflow: 'hidden',
  },
  extraPhotoImg: { width: '100%', height: '100%' },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: '#2F3542', marginBottom: 8, marginLeft: 4 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '500' },
  textarea: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#DFE4EA',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, minHeight: 90, textAlignVertical: 'top',
  },
  sizeRow: { flexDirection: 'row', gap: 8 },
  speciesRow: { flexDirection: 'row', gap: 6 },
  speciesPill: {
    flex: 1, flexBasis: 0, height: 50, borderRadius: 14, borderWidth: 1, borderColor: '#DFE4EA',
    backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
  },
  speciesPillText: { fontWeight: '700', color: '#747D8C', fontSize: 13.5 },
  sizePill: {
    flex: 1, height: 52, borderRadius: 16, borderWidth: 1, borderColor: '#DFE4EA',
    backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center',
  },
  sizePillText: { fontWeight: '700', color: '#747D8C', fontSize: 15 },
  pillActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  pillTextActive: { color: '#FFF' },

  locationButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56,
  },
  locationButtonText: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '600', marginLeft: 12 },

  flagCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 18, marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  flagTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542', marginBottom: 3 },
  flagSub: { fontSize: 13, color: '#747D8C', lineHeight: 18 },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#DFE4EA', justifyContent: 'center', padding: 3 },
  toggleActive: { backgroundColor: '#2ED573' },
  toggleDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF' },
  toggleDotActive: { transform: [{ translateX: 22 }] },

  submitWrapper: { marginTop: 24, shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8 },
  submitButton: { flexDirection: 'row', height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', gap: 8 },
  submitText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
});
