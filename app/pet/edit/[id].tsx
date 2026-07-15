import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, Image, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import MapView from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import DateTimePicker from '@react-native-community/datetimepicker';
import { decode } from 'base64-arraybuffer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../services/supabase';
import { prepareForUpload } from '../../../services/upload';
import { getPetDetails, updatePet, increaseReward, PetSize, PetSex, PetAgeGroup, PetType } from '../../../services/api';
import { RegionAlertButton } from '../../../components/RegionAlertButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from '../../../components/Feedback';

// Metadados por tipo de alerta (cor/título/rótulos) — espelha a tela de criar.
const TYPE_META: Record<PetType, { colors: [string, string]; accent: string; title: string; dateLabel: string }> = {
  lost:     { colors: ['#FF6B81', '#FF4757'], accent: '#FF4757', title: 'Editar pet perdido',    dateLabel: 'Data e hora do desaparecimento' },
  sighted:  { colors: ['#FFC312', '#F79F1F'], accent: '#F79F1F', title: 'Editar pet visto',      dateLabel: 'Data e hora em que vi' },
  rescued:  { colors: ['#26de81', '#20bf6b'], accent: '#20bf6b', title: 'Editar pet resgatado',  dateLabel: '' },
  donation: { colors: ['#60A5FA', '#3B82F6'], accent: '#3B82F6', title: 'Editar doação',          dateLabel: '' },
};

const SEX_OPTIONS: { value: PetSex; label: string }[] = [
  { value: 'macho', label: 'Macho' },
  { value: 'femea', label: 'Fêmea' },
  { value: 'desconhecido', label: 'Não sei' },
];

const AGE_OPTIONS: { value: PetAgeGroup; label: string }[] = [
  { value: 'filhote', label: 'Filhote' },
  { value: 'adulto', label: 'Adulto' },
  { value: 'idoso', label: 'Idoso' },
  { value: 'desconhecido', label: 'Não sei' },
];

export default function EditPetScreen() {
  const { id: petId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tipo do alerta (perdido / visto / resgatado) + flags por tipo
  const [type, setType] = useState<PetType>('lost');
  const [allowContact, setAllowContact] = useState(true); // sighted
  const [isWithFinder, setIsWithFinder] = useState(true);  // rescued
  const [adoptionRules, setAdoptionRules] = useState('');  // donation
  const meta = TYPE_META[type];
  const accent = meta.accent;

  // Form state
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [color, setColor] = useState('');
  const [size, setSize] = useState<PetSize | null>(null);
  const [sex, setSex] = useState<PetSex>('desconhecido');
  const [ageGroup, setAgeGroup] = useState<PetAgeGroup>('desconhecido');
  const [description, setDescription] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [lostDate, setLostDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  const openDateTimePicker = () => { setPickerMode('date'); setShowDatePicker(true); };

  const onChangePicker = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event?.type === 'dismissed' || !selectedDate) return;
      const next = new Date(lostDate);
      if (pickerMode === 'date') {
        next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        setLostDate(next);
        setTimeout(() => { setPickerMode('time'); setShowDatePicker(true); }, 100);
      } else {
        next.setHours(selectedDate.getHours(), selectedDate.getMinutes());
        setLostDate(next);
      }
    } else {
      if (selectedDate) setLostDate(selectedDate);
    }
  };

  // Fotos: cada slot pode ser uma URL existente (https) OU um URI local recém-selecionado (file://)
  const [mainPhoto, setMainPhoto] = useState<string | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<(string | null)[]>([null, null, null]);

  // Localização
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapDraft, setMapDraft] = useState<{ latitude: number; longitude: number } | null>(null);

  // Recompensa
  const [currentReward, setCurrentReward] = useState(0);
  const [rewardStatus, setRewardStatus] = useState<string | null>(null);
  const [increaseValue, setIncreaseValue] = useState('');
  const incNum = Number(increaseValue.replace(',', '.')) || 0;

  useEffect(() => {
    (async () => {
      if (!petId) return;
      try {
        const pet = await getPetDetails(String(petId));
        setType((pet.type as PetType) ?? 'lost');
        setAllowContact(pet.allow_contact !== false);
        setIsWithFinder(pet.is_with_finder === true);
        setAdoptionRules(pet.adoption_rules ?? '');
        setName(pet.name ?? '');
        setBreed(pet.breed ?? '');
        setColor(pet.color ?? '');
        setSize(pet.size ?? null);
        setSex(pet.sex ?? 'desconhecido');
        setAgeGroup(pet.age_group ?? 'desconhecido');
        setDescription(pet.description ?? '');
        setExtraInfo(pet.extra_info ?? '');
        setMainPhoto(pet.main_photo_url ?? null);
        if (pet.lost_date) setLostDate(new Date(pet.lost_date));
        setLat(Number(pet.latitude));
        setLng(Number(pet.longitude));

        const extras = (pet.pet_photos ?? [])
          .slice()
          .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
          .map((p: any) => p.photo_url);
        const slots: (string | null)[] = [null, null, null];
        extras.slice(0, 3).forEach((u: string, i: number) => (slots[i] = u));
        setExtraPhotos(slots);

        const reward = Array.isArray(pet.rewards)
          ? pet.rewards.find((r: any) => r.status === 'pending' || r.status === 'locked')
          : null;
        setCurrentReward(reward ? Number(reward.amount) : 0);
        setRewardStatus(reward?.status ?? null);
      } catch (e: any) {
        toast.error(e?.message ?? 'Não foi possível carregar o pet.');
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [petId]);

  const pickImage = async (slot: 'main' | number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return toast.warning('Permissão negada para acessar a galeria.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: slot === 'main' ? [1, 1] : [4, 3],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.length) return;
    const uri = await prepareForUpload(result.assets[0].uri);
    if (slot === 'main') setMainPhoto(uri);
    else {
      const copy = [...extraPhotos];
      copy[slot] = uri;
      setExtraPhotos(copy);
    }
  };

  const removeExtra = (i: number) => {
    const copy = [...extraPhotos];
    copy[i] = null;
    setExtraPhotos(copy);
  };

  const uploadIfLocal = async (uri: string | null): Promise<string | null> => {
    if (!uri) return null;
    if (uri.startsWith('http')) return uri; // já é URL pública, mantém
    const ext = uri.substring(uri.lastIndexOf('.') + 1) || 'jpg';
    const fileName = `pet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const { error } = await supabase.storage
      .from('pets')
      .upload(fileName, decode(base64), { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (error) throw error;
    return supabase.storage.from('pets').getPublicUrl(fileName).data.publicUrl;
  };

  const handleSave = async () => {
    if (!user || !petId) return;
    if (!name.trim() || !size || !mainPhoto) {
      return toast.warning('Preencha nome, porte e foto principal.');
    }

    setSaving(true);
    try {
      // 1. Upload da foto principal se for nova (URI local)
      const mainUrl = await uploadIfLocal(mainPhoto);
      // 2. Upload das fotos adicionais novas
      const extrasUrls: string[] = [];
      for (const u of extraPhotos) {
        const final = await uploadIfLocal(u);
        if (final) extrasUrls.push(final);
      }

      // 3. PATCH no pet (campos por tipo)
      await updatePet(String(petId), {
        userId: user.id,
        name: name.trim(),
        breed: breed.trim(),
        color: color.trim(),
        size: size!,
        sex,
        age_group: ageGroup,
        description: description.trim(),
        extra_info: extraInfo.trim() || undefined,
        main_photo_url: mainUrl!,
        latitude: lat,
        longitude: lng,
        lost_date: (type === 'lost' || type === 'sighted') ? lostDate.toISOString() : undefined,
        extra_photos: extrasUrls,
        allow_contact: type === 'sighted' ? allowContact : undefined,
        is_with_finder: type === 'rescued' ? isWithFinder : undefined,
        adoption_rules: type === 'donation' ? adoptionRules.trim() : undefined,
      });

      // 4. Aumento de recompensa — só para pet perdido
      if (type === 'lost' && incNum > 0) {
        await increaseReward(String(petId), user.id, incNum);
      }

      toast.success('Alterações salvas!');
      router.back();
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#F1F2F6' }} behavior={undefined}>
      <Modal visible={showMapPicker} animationType="slide">
        <View style={styles.mapModalContainer}>
          <MapView
            style={{ flex: 1 }}
            initialRegion={{ latitude: lat || -23.55, longitude: lng || -46.63, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
            onRegionChangeComplete={(r) => setMapDraft({ latitude: r.latitude, longitude: r.longitude })}
            showsUserLocation
          />
          <View style={styles.mapCenterPin} pointerEvents="none">
            <Ionicons name="location" size={48} color="#FF4757" />
          </View>
          <View style={styles.mapModalHeader}>
            <TouchableOpacity style={styles.mapCloseBtn} onPress={() => setShowMapPicker(false)}>
              <Ionicons name="close" size={24} color="#2F3542" />
            </TouchableOpacity>
            <Text style={styles.mapTitle}>Arraste para marcar</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.mapFooter}>
            <TouchableOpacity
              style={styles.mapConfirmBtn}
              onPress={() => {
                if (mapDraft) { setLat(mapDraft.latitude); setLng(mapDraft.longitude); }
                setShowMapPicker(false);
              }}
            >
              <Text style={styles.mapConfirmText}>Confirmar local</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Header fixo — gradiente vermelho, no estilo da tela de criar alerta */}
      <LinearGradient
        colors={meta.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { shadowColor: accent, paddingTop: insets.top + 10 }]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{meta.title}</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={true}>
        <View style={styles.formContainer}>
          {/* Foto principal */}
          <Text style={styles.sectionTitle}>Foto principal</Text>
          <TouchableOpacity style={styles.imagePicker} activeOpacity={0.8} onPress={() => pickImage('main')}>
            {mainPhoto ? (
              <Image source={{ uri: mainPhoto }} style={styles.imagePreview} />
            ) : (
              <View style={{ alignItems: 'center' }}>
                <Ionicons name="camera" size={32} color="#FF4757" />
                <Text style={styles.imagePickerText}>Adicionar foto principal</Text>
              </View>
            )}
            <View style={styles.replaceTag}>
              <Ionicons name="repeat" size={14} color="#FFF" />
              <Text style={styles.replaceTagText}>{mainPhoto ? 'Substituir' : 'Adicionar'}</Text>
            </View>
          </TouchableOpacity>

          {/* Fotos adicionais */}
          <Text style={styles.helperLabel}>Fotos adicionais (até 3)</Text>
          <View style={styles.extraPhotosRow}>
            {extraPhotos.map((uri, i) => (
              <View key={i} style={styles.extraPhotoSlot}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => pickImage(i)} activeOpacity={0.8}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.extraPhotoImg} />
                  ) : (
                    <View style={styles.extraPhotoEmpty}>
                      <Ionicons name="add" size={28} color="#A4B0BE" />
                    </View>
                  )}
                </TouchableOpacity>
                {uri && (
                  <TouchableOpacity style={styles.extraRemoveBtn} onPress={() => removeExtra(i)}>
                    <Ionicons name="close" size={14} color="#FFF" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          {/* Identificação */}
          <Text style={styles.sectionTitle}>Identificação</Text>
          <Field label="Nome" icon="paw-outline" value={name} onChangeText={setName} />
          <Field label="Raça" icon="ribbon-outline" value={breed} onChangeText={setBreed} />
          <Field label="Cor predominante" icon="color-palette-outline" value={color} onChangeText={setColor} />

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Porte</Text>
            <View style={styles.sizeRow}>
              {(['pequeno', 'medio', 'grande'] as PetSize[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.sizePill, size === opt && { backgroundColor: accent, borderColor: accent }]}
                  onPress={() => setSize(opt)}
                >
                  <Text style={[styles.sizePillText, size === opt && styles.sizePillTextActive]}>
                    {opt === 'pequeno' ? 'Pequeno' : opt === 'medio' ? 'Médio' : 'Grande'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Sexo</Text>
            <View style={styles.sizeRow}>
              {SEX_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sizePill, sex === opt.value && { backgroundColor: accent, borderColor: accent }]}
                  onPress={() => setSex(opt.value)}
                >
                  <Text style={[styles.sizePillText, sex === opt.value && styles.sizePillTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Idade</Text>
            <View style={styles.sizeRow}>
              {AGE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sizePill, ageGroup === opt.value && { backgroundColor: accent, borderColor: accent }]}
                  onPress={() => setAgeGroup(opt.value)}
                >
                  <Text style={[styles.sizePillText, ageGroup === opt.value && styles.sizePillTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Descrição */}
          <Text style={styles.sectionTitle}>Descrição</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Descrição</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={description}
              onChangeText={setDescription}
              multiline
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Maiores informações</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={extraInfo}
              onChangeText={setExtraInfo}
              multiline
            />
          </View>

          {/* Quando/onde */}
          <Text style={styles.sectionTitle}>{type === 'rescued' ? 'Onde você resgatou' : type === 'sighted' ? 'Quando e onde você viu' : type === 'donation' ? 'Onde está o pet' : 'Quando e onde'}</Text>
          {(type === 'lost' || type === 'sighted') && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{meta.dateLabel}</Text>
            <TouchableOpacity style={styles.locationButton} onPress={openDateTimePicker}>
              <Ionicons name="calendar-outline" size={22} color="#2F3542" />
              <Text style={styles.locationButtonText}>{format(lostDate, "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</Text>
              <Ionicons name="pencil-outline" size={20} color="#A4B0BE" />
            </TouchableOpacity>
            {showDatePicker && (
              <>
                <DateTimePicker
                  value={lostDate}
                  mode={Platform.OS === 'ios' ? 'datetime' : pickerMode}
                  is24Hour
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={new Date()}
                  onChange={onChangePicker}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={{ alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 10 }}
                    onPress={() => setShowDatePicker(false)}
                  >
                    <Text style={{ color: '#FF4757', fontWeight: '800', fontSize: 15 }}>Concluir</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Local</Text>
            <TouchableOpacity style={styles.locationButton} onPress={() => setShowMapPicker(true)}>
              <Ionicons name="map" size={22} color="#2F3542" />
              <Text style={styles.locationButtonText} numberOfLines={1}>
                {lat && lng ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Selecionar no mapa'}
              </Text>
              <Ionicons name="pencil-outline" size={20} color="#A4B0BE" />
            </TouchableOpacity>
          </View>

          {/* Flags por tipo */}
          {type === 'sighted' && (
            <View style={styles.flagCard}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.flagTitle}>Permitir contato pelo chat</Text>
                <Text style={styles.flagSub}>Tutores poderão te chamar no chat sobre este pet visto.</Text>
              </View>
              <TouchableOpacity style={[styles.toggle, allowContact && { backgroundColor: accent }]} onPress={() => setAllowContact(!allowContact)}>
                <View style={[styles.toggleDot, allowContact && styles.toggleDotActive]} />
              </TouchableOpacity>
            </View>
          )}
          {type === 'rescued' && (
            <View style={styles.flagCard}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.flagTitle}>O pet está comigo</Text>
                <Text style={styles.flagSub}>Indique se você está com o pet enquanto procura o dono.</Text>
              </View>
              <TouchableOpacity style={[styles.toggle, isWithFinder && { backgroundColor: accent }]} onPress={() => setIsWithFinder(!isWithFinder)}>
                <View style={[styles.toggleDot, isWithFinder && styles.toggleDotActive]} />
              </TouchableOpacity>
            </View>
          )}

          {/* Regras para adoção — só para doação */}
          {type === 'donation' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Regras para adoção</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Ex: castração obrigatória, lar com tela, termo de adoção..."
                placeholderTextColor="#A4B0BE"
                value={adoptionRules}
                onChangeText={setAdoptionRules}
                multiline
              />
            </View>
          )}

          {/* Recompensa — só para pet perdido */}
          {type === 'lost' && (<>
          <Text style={styles.sectionTitle}>Recompensa</Text>
          <View style={styles.rewardCard}>
            <View style={styles.rewardCurrentRow}>
              <View>
                <Text style={styles.rewardCurrentLabel}>Valor atual</Text>
                <Text style={styles.rewardCurrentValue}>R$ {currentReward.toFixed(2)}</Text>
              </View>
              <Ionicons name="gift" size={40} color="#FFD32A" />
            </View>

            <View style={styles.divider} />

            <Text style={styles.rewardIncreaseTitle}>Aumentar recompensa</Text>
            <Text style={styles.rewardIncreaseSub}>
              Você pode apenas <Text style={{ fontWeight: '800', color: '#2F3542' }}>aumentar</Text> o valor informado no anúncio.
              O valor é combinado diretamente com quem ajudar.
            </Text>

            <View style={styles.currencyContainer}>
              <Text style={styles.currencySymbol}>+ R$</Text>
              <TextInput
                style={styles.currencyInput}
                keyboardType="numeric"
                placeholder="0,00"
                placeholderTextColor="#A4B0BE"
                value={increaseValue}
                onChangeText={setIncreaseValue}
                maxLength={7}
              />
            </View>

            {incNum > 0 && (
              <View style={styles.newTotalBox}>
                <Ionicons name="trending-up" size={16} color="#2ED573" />
                <Text style={styles.newTotalText}>
                  Recompensa final: <Text style={{ fontWeight: '900' }}>R$ {(currentReward + incNum).toFixed(2)}</Text>
                </Text>
              </View>
            )}
          </View>
          </>)}

          {type === 'lost' && (
            <>
              <Text style={styles.sectionTitle}>Alertar a região</Text>
              <RegionAlertButton petId={String(petId)} />
            </>
          )}

          <TouchableOpacity style={[styles.submitWrapper, { shadowColor: accent }]} activeOpacity={0.9} onPress={handleSave} disabled={saving}>
            <LinearGradient
              colors={saving ? ['#A4B0BE', '#A4B0BE'] : meta.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitButton}
            >
              <Text style={styles.submitText}>{saving ? 'Salvando...' : 'Salvar alterações'}</Text>
              {!saving && <Ionicons name="checkmark" size={20} color="#FFF" />}
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 100 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, value, onChangeText }: { label: string; icon: any; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name={icon} size={20} color="#A4B0BE" style={styles.inputIcon} />
        <TextInput style={styles.input} placeholderTextColor="#A4B0BE" value={value} onChangeText={onChangeText} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 54, paddingHorizontal: 16, paddingBottom: 18,
    flexDirection: 'row', alignItems: 'center',
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },
  formContainer: { padding: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#2F3542', marginTop: 14, marginBottom: 12 },

  imagePicker: {
    width: '100%', height: 180, backgroundColor: '#FFF', borderRadius: 20,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginBottom: 14,
  },
  imagePickerText: { color: '#2F3542', fontWeight: '700', marginTop: 8 },
  imagePreview: { width: '100%', height: '100%' },
  replaceTag: {
    position: 'absolute', bottom: 10, right: 10, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4,
  },
  replaceTagText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  helperLabel: { fontSize: 13, color: '#747D8C', marginBottom: 8, fontWeight: '600' },
  extraPhotosRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  extraPhotoSlot: { flex: 1, aspectRatio: 1, backgroundColor: '#FFF', borderRadius: 14, overflow: 'hidden', position: 'relative' },
  extraPhotoImg: { width: '100%', height: '100%' },
  extraPhotoEmpty: { flex: 1, borderWidth: 2, borderColor: '#DFE4EA', borderStyle: 'dashed', borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  extraRemoveBtn: {
    position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center',
  },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: '#2F3542', marginBottom: 8, marginLeft: 4 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '500' },
  textarea: {
    backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#DFE4EA',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, minHeight: 90, textAlignVertical: 'top',
  },
  sizeRow: { flexDirection: 'row', gap: 8 },
  sizePill: {
    flex: 1, height: 52, borderRadius: 16, borderWidth: 1, borderColor: '#DFE4EA',
    backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center',
  },
  sizePillActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  sizePillText: { fontWeight: '700', color: '#747D8C' },
  sizePillTextActive: { color: '#FFF' },
  locationButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56, gap: 12,
  },
  locationButtonText: { flex: 1, fontSize: 15, color: '#2F3542', fontWeight: '600' },

  // Flags por tipo (visto / resgatado)
  flagCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', padding: 16, marginBottom: 4,
  },
  flagTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  flagSub: { fontSize: 12.5, color: '#747D8C', marginTop: 2, lineHeight: 17 },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#DFE4EA', padding: 3, justifyContent: 'center' },
  toggleDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF' },
  toggleDotActive: { alignSelf: 'flex-end' },

  rewardCard: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 3,
  },
  rewardCurrentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rewardCurrentLabel: { fontSize: 13, color: '#747D8C', fontWeight: '700', textTransform: 'uppercase' },
  rewardCurrentValue: { fontSize: 32, fontWeight: '900', color: '#2F3542', marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 8, alignSelf: 'flex-start' },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#F1F2F6', marginVertical: 18 },
  rewardIncreaseTitle: { fontSize: 16, fontWeight: '800', color: '#2F3542' },
  rewardIncreaseSub: { fontSize: 13, color: '#747D8C', lineHeight: 18, marginTop: 6, marginBottom: 14 },
  currencyContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F2F6', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  currencySymbol: { fontSize: 22, fontWeight: '900', color: '#2ED573', marginRight: 10 },
  currencyInput: { flex: 1, fontSize: 26, fontWeight: '900', color: '#2F3542' },
  feeBreakdown: { marginTop: 14 },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  feeLabel: { fontSize: 13, color: '#747D8C' },
  feeValue: { fontSize: 13, color: '#2F3542', fontWeight: '700' },
  feeTotal: { borderTopWidth: 1, borderTopColor: '#F1F2F6', marginTop: 4, paddingTop: 10 },
  feeTotalLabel: { fontSize: 14, fontWeight: '800', color: '#2F3542' },
  feeTotalValue: { fontSize: 15, color: '#FF4757', fontWeight: '900' },
  newTotalBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E8F8F5',
    padding: 10, borderRadius: 10, marginTop: 12, justifyContent: 'center',
  },
  newTotalText: { color: '#2ED573', fontWeight: '700', fontSize: 13 },

  submitWrapper: {
    marginTop: 24,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8,
  },
  submitButton: { flexDirection: 'row', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', gap: 8 },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: '900' },

  mapModalContainer: { flex: 1, backgroundColor: '#F1F2F6' },
  mapCenterPin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -24, marginTop: -48 },
  mapModalHeader: {
    position: 'absolute', top: 50, left: 20, right: 20, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: '#FFF', padding: 14, borderRadius: 16,
  },
  mapCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F2F6', justifyContent: 'center', alignItems: 'center' },
  mapTitle: { fontSize: 16, fontWeight: '700', color: '#2F3542' },
  mapFooter: { position: 'absolute', bottom: 30, left: 20, right: 20 },
  mapConfirmBtn: { backgroundColor: '#FF4757', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  mapConfirmText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});
