import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPetDetails } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../../components/Feedback';
import { ZoomableImage } from '../../components/ZoomableImage';
import { SharePetButton } from '../../components/SharePetButton';

const DONATION_COLOR = '#3B82F6';
const { width } = Dimensions.get('window');

const speciesLabel = (s?: string | null) =>
  s === 'cachorro' ? 'Cachorro' : s === 'gato' ? 'Gato' : s === 'passaro' ? 'Pássaro' : s === 'outro' ? 'Outro' : '—';
const sizeLabel = (s?: string | null) =>
  s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : '—';
const ageLabel = (a?: string | null) =>
  a === 'filhote' ? 'Filhote' : a === 'adulto' ? 'Adulto' : a === 'idoso' ? 'Idoso' : '—';
const sexLabel = (s?: string | null) => (s === 'macho' ? 'Macho' : s === 'femea' ? 'Fêmea' : '—');

function Spec({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.spec}>
      <View style={styles.specIcon}><Ionicons name={icon} size={16} color={DONATION_COLOR} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.specLabel}>{label}</Text>
        <Text style={styles.specValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

export default function DonationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [pet, setPet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [galleryZooming, setGalleryZooming] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getPetDetails(String(id));
        setPet(data);
      } catch {
        toast.error('Não foi possível carregar este pet.', 'Erro');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const donorId = pet?.user_id;
  const isMine = !!user && donorId === user.id;
  const donor = pet?.profiles ?? null;
  const photos: string[] = pet
    ? [pet.main_photo_url, ...((pet.pet_photos ?? []).sort((a: any, b: any) => a.position - b.position).map((x: any) => x.photo_url))].filter(Boolean)
    : [];

  const handleContact = () => {
    if (!pet) return;
    if (isMine) { router.push('/(tabs)/chats'); return; }
    router.push(`/chat/${pet.id}?tutorId=${donorId}`);
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={DONATION_COLOR} />
      </View>
    );
  }

  if (!pet) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
        <Ionicons name="alert-circle-outline" size={48} color="#CED6E0" />
        <Text style={styles.emptyText}>Pet não encontrado ou indisponível.</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={!galleryZooming} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Galeria */}
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            scrollEnabled={!galleryZooming}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {photos.map((uri, i) => (
              <ZoomableImage
                key={i}
                source={{ uri }}
                style={{ width, height: width * 0.9 }}
                resizeMode="cover"
                onZoomStart={() => setGalleryZooming(true)}
                onZoomEnd={() => setGalleryZooming(false)}
              />
            ))}
          </ScrollView>
          <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.galleryTopShade} pointerEvents="none" />
          <TouchableOpacity style={[styles.backBtn, { top: insets.top + 8 }]} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          {/* Compartilhar a publicação (canto superior direito) */}
          <SharePetButton pet={pet} label="" style={[styles.shareBtnHero, { top: insets.top + 8 }]} />
          <View style={styles.donationTag}>
            <Ionicons name="heart" size={13} color="#FFF" />
            <Text style={styles.donationTagText}>Para adoção</Text>
          </View>
          {photos.length > 1 && (
            <View style={styles.dots}>
              {photos.map((_, i) => (
                <View key={i} style={[styles.dot, i === photoIndex && styles.dotActive]} />
              ))}
            </View>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{pet.name}</Text>

          {/* Specs */}
          <View style={styles.specGrid}>
            <Spec icon="paw-outline" label="Espécie" value={speciesLabel(pet.species)} />
            <Spec icon="ribbon-outline" label="Raça" value={pet.breed?.trim() || '—'} />
            <Spec icon="color-palette-outline" label="Cor" value={pet.color?.trim() || '—'} />
            <Spec icon="resize-outline" label="Porte" value={sizeLabel(pet.size)} />
            <Spec icon="calendar-outline" label="Idade" value={ageLabel(pet.age_group)} />
            <Spec icon="male-female-outline" label="Sexo" value={sexLabel(pet.sex)} />
          </View>

          {/* Descrição */}
          {pet.description?.trim() ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sobre</Text>
              <Text style={styles.sectionText}>{pet.description}</Text>
            </View>
          ) : null}

          {/* Regras de adoção */}
          {pet.adoption_rules?.trim() ? (
            <View style={[styles.section, styles.rulesCard]}>
              <View style={styles.rulesTitleRow}>
                <Ionicons name="document-text-outline" size={18} color={DONATION_COLOR} />
                <Text style={styles.rulesTitle}>Regras para adoção</Text>
              </View>
              <Text style={styles.sectionText}>{pet.adoption_rules}</Text>
            </View>
          ) : null}

          {/* Mais informações */}
          {pet.extra_info?.trim() ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Mais informações</Text>
              <Text style={styles.sectionText}>{pet.extra_info}</Text>
            </View>
          ) : null}

          {/* Doador */}
          {donor && (
            <View style={styles.donorCard}>
              {donor.photo_url
                ? <Image source={{ uri: donor.photo_url }} style={styles.donorAvatar} />
                : <View style={[styles.donorAvatar, styles.donorAvatarFallback]}><Ionicons name="person" size={20} color="#A4B0BE" /></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.donorName}>{donor.full_name ?? 'Doador'}</Text>
                <Text style={styles.donorSub}>Responsável pela doação</Text>
              </View>
              {(donor.rescues_count ?? 0) > 0 && (
                <View style={styles.rescueBadge}>
                  <Ionicons name="heart" size={12} color="#2ED573" />
                  <Text style={styles.rescueBadgeText}>{donor.rescues_count}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* CTA fixo */}
      <View style={[styles.ctaBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.9} onPress={handleContact}>
          <Ionicons name={isMine ? 'chatbubbles' : 'chatbubble-ellipses'} size={20} color="#FFF" />
          <Text style={styles.ctaText}>{isMine ? 'Ver conversas' : 'Tenho interesse — falar com o tutor'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  galleryTopShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 90 },
  backBtn: {
    position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center',
  },
  shareBtnHero: {
    position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)', flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 5,
  },
  donationTag: {
    position: 'absolute', bottom: 14, left: 16, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: DONATION_COLOR, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  donationTagText: { color: '#FFF', fontWeight: '800', fontSize: 12.5 },
  dots: { position: 'absolute', bottom: 16, right: 16, flexDirection: 'row', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#FFF', width: 18 },

  body: { padding: 20, gap: 16 },
  name: { fontSize: 26, fontWeight: '900', color: '#2F3542', letterSpacing: -0.5 },
  specGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  spec: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  specIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center' },
  specLabel: { fontSize: 11, color: '#A4B0BE', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  specValue: { fontSize: 14.5, color: '#2F3542', fontWeight: '700', marginTop: 1 },

  section: { gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#2F3542' },
  sectionText: { fontSize: 14.5, color: '#57606F', lineHeight: 21, fontWeight: '500' },
  rulesCard: { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 16 },
  rulesTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  rulesTitle: { fontSize: 15.5, fontWeight: '800', color: DONATION_COLOR },

  donorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8F9FB',
    borderRadius: 16, padding: 14, marginTop: 4,
  },
  donorAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EAEDF0' },
  donorAvatarFallback: { justifyContent: 'center', alignItems: 'center' },
  donorName: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  donorSub: { fontSize: 12.5, color: '#A4B0BE', fontWeight: '600', marginTop: 1 },
  rescueBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#E8F8F5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  rescueBadgeText: { fontSize: 12, fontWeight: '800', color: '#2ED573' },

  ctaBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#F1F2F6',
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 54, borderRadius: 16, backgroundColor: DONATION_COLOR,
  },
  ctaText: { color: '#FFF', fontSize: 15.5, fontWeight: '800' },

  emptyText: { fontSize: 14, color: '#A4B0BE', fontWeight: '600', textAlign: 'center', marginTop: 10 },
  backLink: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10 },
  backLinkText: { color: DONATION_COLOR, fontWeight: '800', fontSize: 15 },
});
