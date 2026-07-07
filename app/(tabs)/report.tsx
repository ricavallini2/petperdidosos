import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, Image, Modal, Keyboard, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { decode } from 'base64-arraybuffer';
import { createPetReport, PetSize, PetSex, PetAgeGroup, PetType, PetSpecies } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../services/supabase';
import { prepareForUpload } from '../../services/upload';
import { toast, showConfirm, showActionSheet } from '../../components/Feedback';

const SPECIES_OPTIONS: { value: PetSpecies; label: string }[] = [
  { value: 'cachorro', label: 'Cachorro' },
  { value: 'gato', label: 'Gato' },
  { value: 'passaro', label: 'Pássaro' },
  { value: 'outro', label: 'Outro' },
];

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

// Metadados de cada modo de alerta (perdido / visto / resgatado / doação).
const MODE_META: Record<PetType, { title: string; subtitle: string; colors: [string, string]; icon: string; cta: string }> = {
  lost:     { title: 'Perdi meu pet',   subtitle: 'Quanto mais detalhes, maior a chance de encontrar.', colors: ['#FF6B81', '#FF4757'], icon: 'megaphone', cta: 'Ativar Alerta' },
  sighted:  { title: 'Vi um pet',       subtitle: 'Avise a comunidade sobre um pet visto na rua.',       colors: ['#FFC312', '#F79F1F'], icon: 'eye',       cta: 'Publicar pet visto' },
  rescued:  { title: 'Resgatei um pet', subtitle: 'Cadastre um pet que você resgatou e procura o dono.', colors: ['#26de81', '#20bf6b'], icon: 'alert-circle', cta: 'Publicar resgate' },
  donation: { title: 'Doar um pet',     subtitle: 'Encontre um novo lar para um pet disponível para adoção.', colors: ['#60A5FA', '#3B82F6'], icon: 'gift', cta: 'Publicar doação' },
};
const MODE_ORDER: PetType[] = ['lost', 'sighted', 'rescued', 'donation'];

export default function ReportScreen() {
  // Modo do alerta: null = mostrando o seletor de 3 opções
  const [mode, setMode] = useState<PetType | null>(null);

  // Identificação
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [color, setColor] = useState('');
  const [size, setSize] = useState<PetSize | null>(null);
  const [sex, setSex] = useState<PetSex>('desconhecido');
  const [ageGroup, setAgeGroup] = useState<PetAgeGroup>('desconhecido');

  // Espécie
  const [species, setSpecies] = useState<PetSpecies | null>(null);

  // "Não sei" para raça / cor / porte
  const [breedUnknown, setBreedUnknown] = useState(false);
  const [colorUnknown, setColorUnknown] = useState(false);
  const [sizeUnknown, setSizeUnknown] = useState(false);

  // Descrição
  const [description, setDescription] = useState('');
  const [extraInfo, setExtraInfo] = useState('');

  // Fotos
  const [mainPhoto, setMainPhoto] = useState<string | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<(string | null)[]>([null, null, null]);

  // Quando/onde
  const [lostDate, setLostDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  const openDateTimePicker = () => {
    setPickerMode('date');
    setShowDatePicker(true);
  };

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
  const [locationMode, setLocationMode] = useState<'gps' | 'map'>('gps');
  const [mapLocation, setMapLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const mapRef = useRef<MapView>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Monta o MapView só depois que o modal abre (evita mapa em branco no Android,
  // quando a superfície inicializa com tamanho zero durante a animação).
  const [mapPickerReady, setMapPickerReady] = useState(false);

  // Zoom inicial do mapa de seleção (quanto menor o delta, mais perto).
  const PICKER_DELTA = 0.004;

  // Centraliza o mapa numa coordenada com um zoom de bairro.
  const focusMapOn = (latitude: number, longitude: number) => {
    setMapLocation({ latitude, longitude });
    mapRef.current?.animateToRegion(
      { latitude, longitude, latitudeDelta: PICKER_DELTA, longitudeDelta: PICKER_DELTA },
      450,
    );
  };

  // Abre o seletor já centralizado (zoom de bairro) no melhor ponto conhecido.
  const openMapPicker = () => {
    if (!mapLocation && userLocation) setMapLocation(userLocation);
    setShowMapPicker(true);
    // Atrasa a montagem do mapa até a animação do modal terminar.
    setTimeout(() => setMapPickerReady(true), 350);
  };

  const closeMapPicker = () => {
    setShowMapPicker(false);
    setMapPickerReady(false);
    setSearchError(null);
  };

  // Busca por CEP ou endereço e move o mapa para o ponto encontrado.
  // CEP (8 dígitos) usa o ViaCEP para montar o endereço; depois geocodifica.
  const handleSearchAddress = async () => {
    const raw = addressQuery.trim();
    if (!raw || searchingAddress) return;
    setSearchingAddress(true);
    setSearchError(null);
    try {
      Keyboard.dismiss();
      let query = raw;
      const digits = raw.replace(/\D/g, '');
      if (/^\d{8}$/.test(digits)) {
        // É um CEP — resolve via ViaCEP para um endereço completo.
        const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const data = await resp.json().catch(() => null);
        if (data && !data.erro) {
          query = [data.logradouro, data.bairro, data.localidade, data.uf, 'Brasil']
            .filter(Boolean)
            .join(', ');
        } else {
          // Erro inline (o toast ficaria atrás do Modal do mapa no iOS).
          setSearchError('CEP não encontrado. Tente o endereço.');
          setSearchingAddress(false);
          return;
        }
      }
      const results = await Location.geocodeAsync(query);
      if (results && results.length > 0) {
        focusMapOn(results[0].latitude, results[0].longitude);
      } else {
        setSearchError('Não localizamos esse endereço. Tente ser mais específico.');
      }
    } catch {
      setSearchError('Falha ao buscar o endereço. Verifique sua conexão.');
    } finally {
      setSearchingAddress(false);
    }
  };

  // Pré-carrega a localização atual pra usar como ponto inicial do mapa
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !alive) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (alive) setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch (e) {
        // silencioso — fallback no mapa será São Paulo
      }
    })();
    return () => { alive = false; };
  }, []);

  // Flags por tipo
  const [allowContact, setAllowContact] = useState(true);   // sighted
  const [isWithFinder, setIsWithFinder] = useState(true);   // rescued

  // Doação
  const [adoptionRules, setAdoptionRules] = useState('');         // donation: regras p/ adoção
  const [consentResponsibility, setConsentResponsibility] = useState(false);
  const [consentSearchedOwner, setConsentSearchedOwner] = useState(false);

  // Recompensa
  const [rewardEnabled, setRewardEnabled] = useState(true);
  const [reward, setReward] = useState('50');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const initParams = useLocalSearchParams<{
    initMode?: string; initPhoto?: string; initLat?: string; initLng?: string;
    initName?: string; initSpecies?: string; initBreed?: string; initColor?: string; initSize?: string; initSex?: string;
  }>();

  // Pré-preenche o cadastro quando chega da busca por IA ("Encontrei um pet") ou
  // do atalho "Perdi este pet" (Meus Pets): entra no modo, com foto/dados e local.
  useEffect(() => {
    const m = initParams.initMode;
    if (!m) return;
    if (['lost', 'sighted', 'rescued', 'donation'].includes(m)) setMode(m as PetType);

    // Começa de um estado limpo para não herdar texto de um rascunho anterior
    // (a aba Alertar é persistente). Depois aplica os dados recebidos por params.
    setName(''); setBreed(''); setColor(''); setSize(null); setSex('desconhecido'); setAgeGroup('desconhecido');
    setSpecies(null); setBreedUnknown(false); setColorUnknown(false); setSizeUnknown(false);
    setDescription(''); setExtraInfo(''); setExtraPhotos([null, null, null]);
    setReward('50'); setRewardEnabled(true);

    setMainPhoto(initParams.initPhoto ? String(initParams.initPhoto) : null);
    if (initParams.initName) setName(String(initParams.initName));
    const sp = initParams.initSpecies ? String(initParams.initSpecies) : '';
    if (['cachorro', 'gato', 'passaro', 'outro'].includes(sp)) setSpecies(sp as PetSpecies);
    if (initParams.initBreed) setBreed(String(initParams.initBreed));
    if (initParams.initColor) setColor(String(initParams.initColor));
    const sz = initParams.initSize ? String(initParams.initSize) : '';
    if (['pequeno', 'medio', 'grande'].includes(sz)) setSize(sz as PetSize);
    const sx = initParams.initSex ? String(initParams.initSex) : '';
    if (['macho', 'femea'].includes(sx)) setSex(sx as PetSex);

    const lat = Number(initParams.initLat);
    const lng = Number(initParams.initLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setLocationMode('map');
      setMapLocation({ latitude: lat, longitude: lng });
    } else {
      setLocationMode('gps');
      setMapLocation(null);
    }
    // Limpa para não reaplicar ao voltar/focar de novo.
    router.setParams({
      initMode: '', initPhoto: '', initLat: '', initLng: '',
      initName: '', initSpecies: '', initBreed: '', initColor: '', initSize: '', initSex: '',
    });
  }, [initParams.initMode, initParams.initPhoto, initParams.initLat, initParams.initLng,
      initParams.initName, initParams.initSpecies, initParams.initBreed, initParams.initColor,
      initParams.initSize, initParams.initSex]);

  const rewardValue = Number(reward) || 0;

  // Cadastro completo (nome, idade, descrição): pet perdido e pet em doação.
  const fullForm = mode === 'lost' || mode === 'donation';

  const applyPicked = (slot: 'main' | number, uri: string) => {
    if (slot === 'main') setMainPhoto(uri);
    else {
      const copy = [...extraPhotos];
      copy[slot] = uri;
      setExtraPhotos(copy);
    }
  };

  const launchGallery = async (slot: 'main' | number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      toast.warning('Precisamos de permissão para acessar a galeria.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: slot === 'main' ? [1, 1] : [4, 3],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.length) return;
    applyPicked(slot, await prepareForUpload(result.assets[0].uri));
  };

  const launchCamera = async (slot: 'main' | number) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      toast.warning('Precisamos de permissão para usar a câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: slot === 'main' ? [1, 1] : [4, 3],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.length) return;
    applyPicked(slot, await prepareForUpload(result.assets[0].uri));
  };

  const pickImage = (slot: 'main' | number) => {
    // Pet perdido: foto vem da galeria (o dono usa fotos existentes).
    // Vi/Resgatei: a foto é do pet encontrado na hora — câmera ou galeria.
    if (mode === 'lost') {
      launchGallery(slot);
      return;
    }
    showActionSheet({
      title: 'Adicionar foto',
      message: 'Escolha a origem da foto',
      icon: 'image-outline',
      options: [
        { label: 'Câmera', icon: 'camera-outline', primary: true, onPress: () => launchCamera(slot) },
        { label: 'Galeria', icon: 'images-outline', onPress: () => launchGallery(slot) },
      ],
    });
  };

  const uploadImage = async (uri: string): Promise<string> => {
    // Já é uma URL remota (ex.: foto reaproveitada da busca por IA) — não re-envia.
    if (/^https?:\/\//.test(uri)) return uri;
    const ext = uri.substring(uri.lastIndexOf('.') + 1) || 'jpg';
    const fileName = `pet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const { error } = await supabase.storage
      .from('pets')
      .upload(fileName, decode(base64), {
        contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
      });
    if (error) throw error;
    const { data } = supabase.storage.from('pets').getPublicUrl(fileName);
    return data.publicUrl;
  };

  const validate = (): string | null => {
    if (fullForm && !name.trim()) return 'Informe o nome do pet';
    if (!species) return 'Selecione a espécie';
    if (!breedUnknown && !breed.trim()) return 'Informe a raça (ou marque "Não sei")';
    if (!colorUnknown && !color.trim()) return 'Informe a cor (ou marque "Não sei")';
    if (!sizeUnknown && !size) return 'Selecione o porte (ou marque "Não sei")';
    if (fullForm && !description.trim()) return 'Adicione uma descrição';
    if (!mainPhoto) return 'A foto principal é obrigatória';
    if (mode === 'lost' && rewardEnabled && rewardValue <= 0) return 'Valor de recompensa inválido';
    if (mode === 'donation') {
      if (!adoptionRules.trim()) return 'Descreva as regras para adoção';
      if (!consentResponsibility) return 'Confirme que entende as responsabilidades de doar um pet';
      if (!consentSearchedOwner) return 'Confirme que já procurou o dono antes de doar';
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) return toast.warning(err);

    setIsSubmitting(true);
    try {
      // 1. Localização
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast.warning('Precisamos da localização para definir onde o pet foi visto.');
        setIsSubmitting(false);
        return;
      }
      let finalLat: number, finalLng: number;
      if (locationMode === 'gps') {
        let loc: Location.LocationObject | null;
        if (Platform.OS === 'ios') {
          // iOS: accuracy reduzida + timeout 8s + fallback p/ a última posição —
          // evita o "Publicando..." travado quando o GPS demora (local fechado).
          // Isolado em iOS para NÃO alterar o comportamento do Android.
          let timer: ReturnType<typeof setTimeout> | undefined;
          loc = await Promise.race<Location.LocationObject | null>([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), 8000); }),
          ]).catch(() => null);
          if (timer) clearTimeout(timer);
          if (!loc) loc = await Location.getLastKnownPositionAsync();
          if (!loc) {
            toast.warning('Não consegui sua localização agora. Toque em "Marcar no Mapa" para escolher o local.');
            setIsSubmitting(false);
            return;
          }
        } else {
          // Android: comportamento original inalterado.
          loc = await Location.getCurrentPositionAsync({});
        }
        finalLat = loc.coords.latitude;
        finalLng = loc.coords.longitude;
      } else {
        if (!mapLocation) {
          toast.warning('Confirme o local no mapa.');
          setIsSubmitting(false);
          return;
        }
        finalLat = mapLocation.latitude;
        finalLng = mapLocation.longitude;
      }

      // 2. Upload fotos
      const mainUrl = await uploadImage(mainPhoto!);
      const extras: string[] = [];
      for (const uri of extraPhotos) {
        if (uri) extras.push(await uploadImage(uri));
      }

      // 3. Criar pet
      const isLost = mode === 'lost';
      const submittedMode = mode;
      const created = await createPetReport({
        userId: user?.id ?? '',
        name: name.trim() || (mode === 'sighted' ? 'Pet visto sem tutor' : mode === 'rescued' ? 'Pet resgatado' : mode === 'donation' ? 'Pet para doação' : ''),
        species: species ?? undefined,
        breed: breedUnknown ? undefined : (breed.trim() || undefined),
        color: colorUnknown ? undefined : (color.trim() || undefined),
        size: sizeUnknown ? undefined : (size ?? undefined),
        sex,
        age_group: ageGroup,
        description: description.trim(),
        extra_info: extraInfo.trim() || undefined,
        main_photo_url: mainUrl,
        latitude: finalLat,
        longitude: finalLng,
        lost_date: lostDate.toISOString(),
        reward_amount: isLost && rewardEnabled ? rewardValue : 0,
        extra_photos: extras,
        type: mode ?? 'lost',
        allow_contact: mode === 'sighted' ? allowContact : undefined,
        is_with_finder: mode === 'rescued' ? isWithFinder : undefined,
        adoption_rules: mode === 'donation' ? adoptionRules.trim() : undefined,
        consent_responsibility: mode === 'donation' ? consentResponsibility : undefined,
        consent_searched_owner: mode === 'donation' ? consentSearchedOwner : undefined,
      });

      // Para visto/resgatado vamos abrir o confirm de "Reconhecimento facial" logo
      // abaixo — não mostrar também o toast (evita empilhar dois feedbacks; o confirm
      // já comunica o sucesso). O toast volta nos demais casos.
      const willOfferMatch = (submittedMode === 'sighted' || submittedMode === 'rescued') && !!created?.id;
      if (!willOfferMatch) {
        toast.success(
          isLost
            ? (rewardEnabled
                ? `Recompensa de R$ ${rewardValue.toFixed(2)} informada no anúncio.`
                : 'Seu pet já aparece no mapa.')
            : (mode === 'sighted'
                ? 'Pet visto publicado no mapa.'
                : mode === 'rescued'
                  ? 'Pet resgatado publicado no mapa.'
                  : 'Pet para doação publicado no mapa.'),
          isLost ? 'Alerta criado!' : 'Publicado!',
        );
      }

      // Reset
      setName(''); setBreed(''); setColor(''); setSize(null); setSex('desconhecido'); setAgeGroup('desconhecido');
      setSpecies(null);
      setBreedUnknown(false); setColorUnknown(false); setSizeUnknown(false);
      setDescription(''); setExtraInfo('');
      setMainPhoto(null); setExtraPhotos([null, null, null]);
      setReward('50'); setRewardEnabled(true);
      setAllowContact(true); setIsWithFinder(true);
      setAdoptionRules(''); setConsentResponsibility(false); setConsentSearchedOwner(false);
      setLostDate(new Date()); setLocationMode('gps'); setMapLocation(null);
      setMode(null); // volta ao seletor de opções

      // Pós-publicação (visto/resgatado): oferecer reconhecimento facial.
      // Doação não oferece — o doador já procurou o dono antes de doar.
      if (submittedMode && (submittedMode === 'sighted' || submittedMode === 'rescued') && created?.id) {
        showConfirm({
          title: 'Reconhecimento facial',
          message: 'Deseja verificar se há um pet perdido parecido com este na sua região?',
          icon: 'sparkles',
          confirmText: 'Verificar',
          cancelText: 'Agora não',
          onConfirm: () => router.push({
            pathname: '/match-owners',
            params: { sourcePetId: created.id, photo: mainUrl, lat: String(finalLat), lng: String(finalLng) },
          }),
        });
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Seletor inicial: 3 opções (Perdi / Vi / Resgatei) ao abrir a aba Alertar.
  if (!mode) {
    return (
      <View style={styles.chooserContainer}>
        <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
          <Text style={styles.headerTitle}>Alertar</Text>
          <Text style={styles.headerSubtitle}>O que você quer reportar?</Text>
        </LinearGradient>
        <View style={styles.chooserList}>
          {MODE_ORDER.map((m) => (
            <TouchableOpacity key={m} style={styles.chooserCard} activeOpacity={0.85} onPress={() => setMode(m)}>
              <View style={[styles.chooserIcon, { backgroundColor: MODE_META[m].colors[1] }]}>
                <Ionicons name={MODE_META[m].icon as any} size={26} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chooserTitle}>{MODE_META[m].title}</Text>
                <Text style={styles.chooserSub}>{MODE_META[m].subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color="#A4B0BE" />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {/* Picker de localização no mapa */}
      <Modal visible={showMapPicker} animationType="slide">
        <View style={styles.mapModalContainer}>
          {mapPickerReady ? (
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={{ flex: 1 }}
              initialRegion={{
                latitude: mapLocation?.latitude ?? userLocation?.latitude ?? -23.55,
                longitude: mapLocation?.longitude ?? userLocation?.longitude ?? -46.63,
                latitudeDelta: PICKER_DELTA,
                longitudeDelta: PICKER_DELTA,
              }}
              onRegionChangeComplete={(region) => setMapLocation({ latitude: region.latitude, longitude: region.longitude })}
              showsUserLocation
              showsMyLocationButton
            />
          ) : (
            <View style={[styles.mapModalLoading, { flex: 1 }]}>
              <ActivityIndicator size="large" color="#FF4757" />
            </View>
          )}
          <View style={styles.mapCenterPin} pointerEvents="none">
            <Ionicons name="location" size={48} color="#FF4757" />
          </View>
          <View style={styles.mapModalHeader}>
            <TouchableOpacity style={styles.mapModalCloseBtn} onPress={closeMapPicker}>
              <Ionicons name="close" size={24} color="#2F3542" />
            </TouchableOpacity>
            <Text style={styles.mapModalTitle}>Arraste para marcar</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Busca por CEP ou endereço para localizar o ponto no mapa */}
          <View style={styles.mapSearchBar}>
            <Ionicons name="search" size={18} color="#747D8C" style={{ marginLeft: 4 }} />
            <TextInput
              style={styles.mapSearchInput}
              placeholder="Buscar por CEP ou endereço"
              placeholderTextColor="#A4B0BE"
              value={addressQuery}
              onChangeText={(t) => { setAddressQuery(t); if (searchError) setSearchError(null); }}
              returnKeyType="search"
              onSubmitEditing={handleSearchAddress}
            />
            <TouchableOpacity
              style={styles.mapSearchBtn}
              onPress={handleSearchAddress}
              disabled={searchingAddress || !addressQuery.trim()}
            >
              {searchingAddress
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Ionicons name="arrow-forward" size={18} color="#FFF" />}
            </TouchableOpacity>
          </View>

          {/* Erro da busca (inline — o toast ficaria escondido atrás deste Modal no iOS) */}
          {!!searchError && (
            <View style={styles.mapSearchError} pointerEvents="none">
              <Ionicons name="alert-circle" size={15} color="#FFF" />
              <Text style={styles.mapSearchErrorText}>{searchError}</Text>
            </View>
          )}

          <View style={styles.mapModalFooter}>
            <TouchableOpacity style={styles.mapConfirmBtn} onPress={closeMapPicker}>
              <Text style={styles.mapConfirmBtnText}>Confirmar este local</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <LinearGradient
          colors={MODE_META[mode].colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <TouchableOpacity style={styles.headerBack} activeOpacity={0.8} onPress={() => setMode(null)}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
            <Text style={styles.headerBackText}>Trocar tipo</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{MODE_META[mode].title}</Text>
          <Text style={styles.headerSubtitle}>{MODE_META[mode].subtitle}</Text>
        </LinearGradient>

        <View style={styles.formContainer}>
          {/* Foto principal */}
          <Text style={styles.sectionTitle}>1. Foto principal</Text>
          <TouchableOpacity
            style={[styles.imagePicker, mainPhoto ? { borderStyle: 'solid', borderWidth: 0 } : {}]}
            activeOpacity={0.8}
            onPress={() => pickImage('main')}
          >
            {mainPhoto ? (
              <Image source={{ uri: mainPhoto }} style={styles.imagePreview} />
            ) : (
              <>
                <View style={styles.imagePickerIcon}>
                  <Ionicons name="camera" size={32} color="#FF4757" />
                </View>
                <Text style={styles.imagePickerText}>Adicionar foto principal</Text>
                <Text style={styles.imagePickerSub}>Centralize o rosto — vira o ícone no mapa</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Fotos adicionais */}
          <Text style={styles.helperLabel}>Fotos adicionais (até 3, opcional)</Text>
          <View style={styles.extraPhotosRow}>
            {extraPhotos.map((uri, i) => (
              <TouchableOpacity key={i} style={styles.extraPhotoSlot} onPress={() => pickImage(i)} activeOpacity={0.8}>
                {uri ? (
                  <Image source={{ uri }} style={styles.extraPhotoImg} />
                ) : (
                  <Ionicons name="add" size={28} color="#A4B0BE" />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Identificação */}
          <Text style={styles.sectionTitle}>2. Identificação</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Espécie</Text>
            <View style={styles.speciesRow}>
              {SPECIES_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.speciesPill, species === opt.value && styles.sizePillActive]}
                  onPress={() => setSpecies(opt.value)}
                >
                  <Text
                    style={[styles.speciesPillText, species === opt.value && styles.sizePillTextActive]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {fullForm && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nome do Pet</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="paw-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Ex: Rex, Mel, Thor..." placeholderTextColor="#A4B0BE" value={name} onChangeText={setName} />
            </View>
          </View>
          )}

          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Raça</Text>
              <TouchableOpacity style={[styles.unknownChip, breedUnknown && styles.unknownChipActive]} onPress={() => setBreedUnknown(!breedUnknown)}>
                <Text style={[styles.unknownChipText, breedUnknown && styles.unknownChipTextActive]}>Não sei</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, breedUnknown && styles.inputDisabled]}>
              <Ionicons name="ribbon-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} editable={!breedUnknown} placeholder={breedUnknown ? 'Não informado' : 'Ex: Poodle, Vira-lata, Persa...'} placeholderTextColor="#A4B0BE" value={breedUnknown ? '' : breed} onChangeText={setBreed} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Cor predominante</Text>
              <TouchableOpacity style={[styles.unknownChip, colorUnknown && styles.unknownChipActive]} onPress={() => setColorUnknown(!colorUnknown)}>
                <Text style={[styles.unknownChipText, colorUnknown && styles.unknownChipTextActive]}>Não sei</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, colorUnknown && styles.inputDisabled]}>
              <Ionicons name="color-palette-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
              <TextInput style={styles.input} editable={!colorUnknown} placeholder={colorUnknown ? 'Não informado' : 'Ex: Branco, Caramelo, Preto e branco...'} placeholderTextColor="#A4B0BE" value={colorUnknown ? '' : color} onChangeText={setColor} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Porte</Text>
              <TouchableOpacity
                style={[styles.unknownChip, sizeUnknown && styles.unknownChipActive]}
                onPress={() => { const next = !sizeUnknown; setSizeUnknown(next); if (next) setSize(null); }}
              >
                <Text style={[styles.unknownChipText, sizeUnknown && styles.unknownChipTextActive]}>Não sei</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.sizeRow}>
              {(['pequeno', 'medio', 'grande'] as PetSize[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.sizePill, !sizeUnknown && size === opt && styles.sizePillActive]}
                  onPress={() => { setSize(opt); setSizeUnknown(false); }}
                >
                  <Text style={[styles.sizePillText, !sizeUnknown && size === opt && styles.sizePillTextActive]}>
                    {opt === 'pequeno' ? 'Pequeno' : opt === 'medio' ? 'Médio' : 'Grande'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Sexo</Text>
              <TouchableOpacity
                style={[styles.unknownChip, sex === 'desconhecido' && styles.unknownChipActive]}
                onPress={() => setSex('desconhecido')}
              >
                <Text style={[styles.unknownChipText, sex === 'desconhecido' && styles.unknownChipTextActive]}>Não sei</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.sizeRow}>
              {SEX_OPTIONS.filter((o) => o.value !== 'desconhecido').map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sizePill, sex === opt.value && styles.sizePillActive]}
                  onPress={() => setSex(opt.value)}
                >
                  <Text style={[styles.sizePillText, sex === opt.value && styles.sizePillTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {fullForm && (
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Idade</Text>
              <TouchableOpacity
                style={[styles.unknownChip, ageGroup === 'desconhecido' && styles.unknownChipActive]}
                onPress={() => setAgeGroup('desconhecido')}
              >
                <Text style={[styles.unknownChipText, ageGroup === 'desconhecido' && styles.unknownChipTextActive]}>Não sei</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.sizeRow}>
              {AGE_OPTIONS.filter((o) => o.value !== 'desconhecido').map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sizePill, ageGroup === opt.value && styles.sizePillActive]}
                  onPress={() => setAgeGroup(opt.value)}
                >
                  <Text style={[styles.sizePillText, ageGroup === opt.value && styles.sizePillTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          )}

          {/* Descrição / Maiores informações */}
          <Text style={styles.sectionTitle}>{fullForm ? '3. Descrição' : '3. Maiores informações'}</Text>
          {fullForm && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Descrição</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder={mode === 'donation' ? 'Temperamento, convivência com outros pets/crianças, saúde...' : 'Comportamento, marcas distintas, coleira...'}
              placeholderTextColor="#A4B0BE"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>
          )}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{fullForm ? 'Maiores informações (opcional)' : 'Maiores informações'}</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Saúde, medicação, contato adicional..."
              placeholderTextColor="#A4B0BE"
              value={extraInfo}
              onChangeText={setExtraInfo}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Quando/Onde */}
          <Text style={styles.sectionTitle}>{mode === 'lost' ? '4. Quando e onde' : mode === 'sighted' ? '4. Quando e onde você viu' : mode === 'rescued' ? '4. Onde você resgatou' : '4. Onde está o pet'}</Text>
          {(mode === 'lost' || mode === 'sighted') && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{mode === 'lost' ? 'Data e Hora do Desaparecimento' : 'Data e hora em que vi'}</Text>
            <TouchableOpacity style={styles.locationButton} activeOpacity={0.8} onPress={openDateTimePicker}>
              <Ionicons name="calendar-outline" size={22} color="#2F3542" />
              <Text style={styles.locationButtonText}>{format(lostDate, "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</Text>
              <Ionicons name="pencil-outline" size={20} color="#A4B0BE" />
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={lostDate}
                mode={Platform.OS === 'ios' ? 'datetime' : pickerMode}
                is24Hour
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={new Date()}
                onChange={onChangePicker}
              />
            )}
          </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{mode === 'lost' ? 'Local visto por último' : 'Use seu GPS atual ou marque no mapa'}</Text>
            <View style={styles.locationTabs}>
              <TouchableOpacity style={[styles.locTab, locationMode === 'gps' && styles.locTabActive]} onPress={() => setLocationMode('gps')}>
                <Ionicons name="locate" size={20} color={locationMode === 'gps' ? '#FFF' : '#747D8C'} />
                <Text style={[styles.locTabText, locationMode === 'gps' && styles.locTabTextActive]}>Meu GPS Atual</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locTab, locationMode === 'map' && styles.locTabActive]}
                onPress={() => {
                  setLocationMode('map');
                  openMapPicker();
                }}
              >
                <Ionicons name="map" size={20} color={locationMode === 'map' ? '#FFF' : '#747D8C'} />
                <Text style={[styles.locTabText, locationMode === 'map' && styles.locTabTextActive]}>Marcar no Mapa</Text>
              </TouchableOpacity>
            </View>
            {locationMode === 'map' && (
              <TouchableOpacity style={styles.mapEditBtn} onPress={openMapPicker}>
                <Ionicons name="checkmark-circle" size={20} color="#2ED573" />
                <Text style={styles.mapEditText}>
                  {mapLocation ? 'Local selecionado (toque para editar)' : 'Toque para abrir o mapa'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Flags por tipo */}
          {mode === 'sighted' && (
            <View style={styles.flagCard}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.flagTitle}>Permitir contato pelo chat</Text>
                <Text style={styles.flagSub}>Tutores poderão te chamar no chat sobre este pet visto.</Text>
              </View>
              <TouchableOpacity style={[styles.toggle, allowContact && styles.toggleActive]} onPress={() => setAllowContact(!allowContact)}>
                <View style={[styles.toggleDot, allowContact && styles.toggleDotActive]} />
              </TouchableOpacity>
            </View>
          )}
          {mode === 'rescued' && (
            <View style={styles.flagCard}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.flagTitle}>O pet está comigo</Text>
                <Text style={styles.flagSub}>Indique se você está com o pet enquanto procura o dono.</Text>
              </View>
              <TouchableOpacity style={[styles.toggle, isWithFinder && styles.toggleActive]} onPress={() => setIsWithFinder(!isWithFinder)}>
                <View style={[styles.toggleDot, isWithFinder && styles.toggleDotActive]} />
              </TouchableOpacity>
            </View>
          )}

          {/* Doação — regras de adoção + consentimentos */}
          {mode === 'donation' && (<>
            <Text style={styles.sectionTitle}>5. Regras para adoção</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Descreva as regras e o que espera do adotante</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Ex: castração obrigatória, lar com tela de proteção, visita prévia, termo de adoção..."
                placeholderTextColor="#A4B0BE"
                value={adoptionRules}
                onChangeText={setAdoptionRules}
                multiline
                numberOfLines={4}
              />
            </View>

            <Text style={styles.sectionTitle}>6. Confirmações</Text>
            <TouchableOpacity
              style={[styles.consentCard, consentResponsibility && styles.consentCardActive]}
              activeOpacity={0.85}
              onPress={() => setConsentResponsibility((v) => !v)}
            >
              <View style={[styles.consentBox, consentResponsibility && styles.consentBoxActive]}>
                {consentResponsibility && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.consentTitle}>Entendo as responsabilidades de doar um pet</Text>
                <Text style={styles.consentSub}>Comprometo-me a entregar o pet a um lar responsável e seguro.</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.consentCard, consentSearchedOwner && styles.consentCardActive]}
              activeOpacity={0.85}
              onPress={() => setConsentSearchedOwner((v) => !v)}
            >
              <View style={[styles.consentBox, consentSearchedOwner && styles.consentBoxActive]}>
                {consentSearchedOwner && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.consentTitle}>Já procurei o dono antes de doar</Text>
                <Text style={styles.consentSub}>Confirmo que busquei o tutor original e não o encontrei.</Text>
              </View>
            </TouchableOpacity>
          </>)}

          {/* Recompensa — só para pet perdido */}
          {mode === 'lost' && (<>
          <Text style={styles.sectionTitle}>5. Recompensa</Text>
          <View style={styles.rewardCard}>
            <View style={styles.rewardHeader}>
              <View style={styles.rewardTitleContainer}>
                <Ionicons name="gift" size={24} color="#FFD32A" />
                <Text style={styles.rewardTitle}>Oferecer recompensa</Text>
              </View>
              <TouchableOpacity
                style={[styles.toggle, rewardEnabled && styles.toggleActive]}
                onPress={() => setRewardEnabled(!rewardEnabled)}
              >
                <View style={[styles.toggleDot, rewardEnabled && styles.toggleDotActive]} />
              </TouchableOpacity>
            </View>

            {rewardEnabled && (
              <>
                <View style={styles.currencyContainer}>
                  <Text style={styles.currencySymbol}>R$</Text>
                  <TextInput style={styles.currencyInput} keyboardType="numeric" value={reward} onChangeText={setReward} maxLength={6} />
                </View>
                <Text style={styles.rewardDescription}>
                  Valor apenas informativo no anúncio, combinado diretamente entre você e quem ajudar. O app não intermedia o pagamento.
                </Text>
              </>
            )}
          </View>
          </>)}

          <TouchableOpacity style={styles.submitWrapper} activeOpacity={0.9} onPress={handleSubmit} disabled={isSubmitting}>
            <LinearGradient
              colors={isSubmitting ? ['#A4B0BE', '#A4B0BE'] : MODE_META[mode].colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitButton}
            >
              <Text style={styles.submitText}>{isSubmitting ? 'Publicando...' : MODE_META[mode].cta}</Text>
              {!isSubmitting && <Ionicons name="flash" size={20} color="#FFF" />}
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 150 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },

  // Seletor de 3 opções (Perdi / Vi / Resgatei)
  chooserContainer: { flex: 1, backgroundColor: '#F1F2F6' },
  chooserList: { padding: 20, paddingTop: 24, gap: 14 },
  chooserCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 20, padding: 18, gap: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  chooserIcon: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  chooserTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginBottom: 3 },
  chooserSub: { fontSize: 13, color: '#747D8C', lineHeight: 18 },

  // Botão "Trocar tipo" no header do formulário
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 10, opacity: 0.95 },
  headerBackText: { color: '#FFF', fontSize: 14, fontWeight: '700', marginLeft: 6 },

  // Card de flag (permitir contato / está comigo)
  flagCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 18, marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  flagTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542', marginBottom: 3 },
  flagSub: { fontSize: 13, color: '#747D8C', lineHeight: 18 },

  // Consentimentos da doação
  consentCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 16, marginBottom: 12, gap: 14,
    borderWidth: 1.5, borderColor: '#DFE4EA',
  },
  consentCardActive: { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  consentBox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#CBD5E1',
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF',
  },
  consentBoxActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  consentTitle: { fontSize: 14.5, fontWeight: '800', color: '#2F3542', marginBottom: 2 },
  consentSub: { fontSize: 12.5, color: '#747D8C', lineHeight: 17 },
  header: {
    paddingTop: 70, paddingHorizontal: 24, paddingBottom: 30,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 8, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 22, fontWeight: '500' },
  formContainer: { padding: 20, paddingTop: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginTop: 8, marginBottom: 14 },
  imagePicker: {
    width: '100%', height: 180, backgroundColor: '#FFFFFF', borderRadius: 20,
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#DFE4EA', borderStyle: 'dashed', marginBottom: 14,
  },
  imagePickerIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF0F1', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  imagePickerText: { fontSize: 16, color: '#2F3542', fontWeight: '700', marginBottom: 4 },
  imagePickerSub: { fontSize: 13, color: '#A4B0BE' },
  imagePreview: { width: '100%', height: '100%', borderRadius: 20 },
  helperLabel: { fontSize: 13, color: '#747D8C', marginBottom: 8, fontWeight: '600' },
  extraPhotosRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  extraPhotoSlot: {
    flex: 1, aspectRatio: 1, backgroundColor: '#FFF', borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#DFE4EA', borderStyle: 'dashed',
    overflow: 'hidden',
  },
  extraPhotoImg: { width: '100%', height: '100%' },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: '#2F3542', marginBottom: 8, marginLeft: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unknownChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
    borderWidth: 1, borderColor: '#DFE4EA', backgroundColor: '#FFF', marginBottom: 8,
  },
  unknownChipActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  unknownChipText: { fontSize: 12, fontWeight: '700', color: '#747D8C' },
  unknownChipTextActive: { color: '#FFF' },
  inputDisabled: { backgroundColor: '#F1F2F6', opacity: 0.7 },
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
  sizePillActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  sizePillText: { fontWeight: '700', color: '#747D8C', fontSize: 15 },
  sizePillTextActive: { color: '#FFF' },
  locationButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56,
  },
  locationButtonText: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '600', marginLeft: 12 },
  locationTabs: { flexDirection: 'row', backgroundColor: '#DFE4EA', borderRadius: 16, padding: 4 },
  locTab: { flex: 1, flexDirection: 'row', height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  locTabActive: { backgroundColor: '#FF4757' },
  locTabText: { marginLeft: 8, fontSize: 15, fontWeight: '600', color: '#747D8C' },
  locTabTextActive: { color: '#FFF' },
  mapEditBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F8F5', padding: 16, borderRadius: 16, marginTop: 12 },
  mapEditText: { marginLeft: 8, color: '#2ED573', fontWeight: '600' },

  rewardCard: {
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.05, shadowRadius: 15, elevation: 4,
  },
  rewardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  rewardTitleContainer: { flexDirection: 'row', alignItems: 'center' },
  rewardTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginLeft: 8 },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#DFE4EA', justifyContent: 'center', padding: 3 },
  toggleActive: { backgroundColor: '#2ED573' },
  toggleDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF' },
  toggleDotActive: { transform: [{ translateX: 22 }] },
  rewardDescription: { fontSize: 14, color: '#747D8C', lineHeight: 20, marginBottom: 16 },
  currencyContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F2F6', borderRadius: 16, paddingHorizontal: 20, paddingVertical: 12 },
  currencySymbol: { fontSize: 26, fontWeight: '900', color: '#2ED573', marginRight: 12 },
  currencyInput: { flex: 1, fontSize: 28, fontWeight: '900', color: '#2F3542' },
  feeBreakdown: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F1F2F6' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  feeLabel: { fontSize: 14, color: '#747D8C', fontWeight: '500' },
  feeValue: { fontSize: 14, color: '#2F3542', fontWeight: '700' },
  feeTotal: { borderTopWidth: 1, borderTopColor: '#F1F2F6', marginTop: 4, paddingTop: 10 },
  feeTotalLabel: { fontSize: 15, color: '#2F3542', fontWeight: '800' },
  feeTotalValue: { fontSize: 16, color: '#FF4757', fontWeight: '900' },
  paymentNote: { fontSize: 12, color: '#FFA502', marginTop: 12, fontWeight: '600' },

  submitWrapper: { marginTop: 30, shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8 },
  submitButton: { flexDirection: 'row', height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  submitText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginRight: 8 },

  mapModalContainer: { flex: 1, backgroundColor: '#F1F2F6' },
  mapCenterPin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -24, marginTop: -48, zIndex: 10 },
  mapModalHeader: {
    position: 'absolute', top: 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', backgroundColor: '#FFF', padding: 15, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  mapModalLoading: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#EAEDF0' },
  mapModalCloseBtn: { width: 40, height: 40, backgroundColor: '#F1F2F6', borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  mapModalTitle: { fontSize: 18, fontWeight: '700', color: '#2F3542' },
  mapSearchBar: {
    position: 'absolute', top: 122, left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', paddingLeft: 12, paddingRight: 6, height: 52, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  mapSearchInput: { flex: 1, fontSize: 15, color: '#2F3542', fontWeight: '500', paddingVertical: 0 },
  mapSearchBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FF4757', justifyContent: 'center', alignItems: 'center' },
  mapSearchError: {
    position: 'absolute', top: 178, left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FF4757', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  mapSearchErrorText: { color: '#FFF', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  mapModalFooter: { position: 'absolute', bottom: 40, left: 20, right: 20 },
  mapConfirmBtn: { backgroundColor: '#FF4757', height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  mapConfirmBtnText: { color: '#FFF', fontSize: 18, fontWeight: '800' },
});
