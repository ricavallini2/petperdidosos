import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  getMyPet, deleteMyPet, deleteHealthRecord, MyPetDetail, HealthRecord, HealthRecordType,
} from '../../../services/api';
import { cancelHealthReminder } from '../../../services/reminders';
import { toast, showConfirm, showActionSheet } from '../../../components/Feedback';
import { ZoomableImage } from '../../../components/ZoomableImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SPECIES_LABEL: Record<string, string> = { cachorro: 'Cachorro', gato: 'Gato', passaro: 'Pássaro', outro: 'Outro' };
const SIZE_LABEL: Record<string, string> = { pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande' };
const SEX_LABEL: Record<string, string> = { macho: 'Macho', femea: 'Fêmea' };

const TYPE_META: Record<HealthRecordType, { label: string; icon: any; color: string; bg: string }> = {
  vacina: { label: 'Vacina', icon: 'medkit', color: '#26de81', bg: '#E8FBF1' },
  vermifugo: { label: 'Vermífugo', icon: 'bug', color: '#60A5FA', bg: '#EAF3FE' },
  antipulgas: { label: 'Antipulgas', icon: 'paw', color: '#FFA502', bg: '#FFF4E0' },
  medicacao: { label: 'Medicação', icon: 'medical', color: '#FF6B81', bg: '#FFECF0' },
  peso: { label: 'Peso', icon: 'fitness', color: '#A55EEA', bg: '#F3ECFD' },
};

function ageLabel(birth?: string | null): string | null {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  if (months < 0) return null;
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'ano' : 'anos'}`;
}

function fmtDate(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : format(d, 'dd/MM/yyyy', { locale: ptBR });
}

function daysUntil(s: string): number | null {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function NextBadge({ proxima }: { proxima: string }) {
  const d = daysUntil(proxima);
  const dateLbl = fmtDate(proxima);
  if (d == null) return null;
  let bg = '#F1F2F6', color = '#747D8C', text = `Próxima: ${dateLbl}`;
  if (d < 0) { bg = '#FFECEE'; color = '#FF4757'; text = `Vencido (${dateLbl})`; }
  else if (d === 0) { bg = '#FFF4E0'; color = '#FFA502'; text = 'Vence hoje'; }
  else if (d <= 14) { bg = '#FFF4E0'; color = '#FFA502'; text = `Faltam ${d} ${d === 1 ? 'dia' : 'dias'}`; }
  return (
    <View style={[styles.nextBadge, { backgroundColor: bg }]}>
      <Ionicons name="alarm-outline" size={12} color={color} />
      <Text style={[styles.nextBadgeText, { color }]}>{text}</Text>
    </View>
  );
}

export default function MeuPetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [pet, setPet] = useState<MyPetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [heroZooming, setHeroZooming] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const data = await getMyPet(String(id));
      setPet(data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goLost = () => {
    if (!pet) return;
    // Abre o Alertar já pré-preenchido com os dados do pet (modo perdido).
    const q = new URLSearchParams({ initMode: 'lost', initName: pet.name });
    if (pet.main_photo_url) q.set('initPhoto', pet.main_photo_url);
    if (pet.species) q.set('initSpecies', pet.species);
    if (pet.breed) q.set('initBreed', pet.breed);
    if (pet.color) q.set('initColor', pet.color);
    if (pet.size) q.set('initSize', pet.size);
    if (pet.sex && pet.sex !== 'desconhecido') q.set('initSex', pet.sex);
    router.push(`/(tabs)/report?${q.toString()}` as Href);
  };

  const handleDeletePet = () => {
    if (!pet) return;
    showConfirm({
      title: 'Excluir pet?',
      message: `Isso remove "${pet.name}" e toda a carteirinha de saúde. Não dá para desfazer.`,
      icon: 'trash',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          await deleteMyPet(String(id));
          toast.success('Pet removido.');
          router.back();
        } catch (e: any) {
          toast.error(e?.message ?? 'Tente novamente.');
        }
      },
    });
  };

  const openRecordActions = (record: HealthRecord) => {
    showActionSheet({
      title: TYPE_META[record.type].label,
      message: 'O que deseja fazer com este registro?',
      icon: 'create-outline',
      options: [
        {
          label: 'Editar',
          icon: 'pencil-outline',
          primary: true,
          onPress: () => router.push(`/meu-pet/${id}/saude/${record.id}` as Href),
        },
        {
          label: 'Excluir',
          icon: 'trash-outline',
          onPress: () =>
            showConfirm({
              title: 'Excluir registro?',
              message: 'Este registro de saúde será removido.',
              icon: 'trash',
              confirmText: 'Excluir',
              cancelText: 'Cancelar',
              onConfirm: async () => {
                try {
                  await deleteHealthRecord(String(id), record.id);
                  await cancelHealthReminder(record.id);
                  toast.success('Registro removido.');
                  load();
                } catch (e: any) {
                  toast.error(e?.message ?? 'Tente novamente.');
                }
              },
            }),
        },
      ],
    });
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#FF4757" /></View>;
  }
  if (notFound || !pet) {
    return (
      <View style={styles.center}>
        <Ionicons name="paw-outline" size={48} color="#A4B0BE" />
        <Text style={styles.notFoundText}>Não encontramos este pet.</Text>
        <TouchableOpacity style={styles.notFoundBtn} onPress={() => router.back()}>
          <Text style={styles.notFoundBtnText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const subtitle = [pet.species ? SPECIES_LABEL[pet.species] : null, pet.breed, ageLabel(pet.birth_date)]
    .filter(Boolean)
    .join(' · ');
  const records = pet.health_records ?? [];

  // Ficha premium: destaques glanceáveis (identidade) + linhas detalhadas com ícone.
  type Tile = { icon: any; tint: string; bg: string; label: string; value: string };
  const age = ageLabel(pet.birth_date);
  const highlights: Tile[] = [];
  if (pet.species) highlights.push({ icon: 'paw', tint: '#5AA9FF', bg: '#EAF3FE', label: 'Espécie', value: SPECIES_LABEL[pet.species] ?? pet.species });
  if (pet.sex && SEX_LABEL[pet.sex]) highlights.push({ icon: pet.sex === 'femea' ? 'female' : 'male', tint: pet.sex === 'femea' ? '#FF6B81' : '#5AA9FF', bg: pet.sex === 'femea' ? '#FFECF0' : '#EAF3FE', label: 'Sexo', value: SEX_LABEL[pet.sex] });
  if (age) highlights.push({ icon: 'sparkles', tint: '#FFA502', bg: '#FFF4E0', label: 'Idade', value: age });
  if (pet.size) highlights.push({ icon: 'resize', tint: '#A55EEA', bg: '#F3ECFD', label: 'Porte', value: SIZE_LABEL[pet.size] ?? pet.size });

  const infoItems: Tile[] = [];
  if (pet.breed) infoItems.push({ icon: 'ribbon-outline', tint: '#5AA9FF', bg: '#EAF3FE', label: 'Raça', value: pet.breed });
  if (pet.color) infoItems.push({ icon: 'color-palette-outline', tint: '#A55EEA', bg: '#F3ECFD', label: 'Cor', value: pet.color });
  const birthLbl = fmtDate(pet.birth_date);
  if (birthLbl) infoItems.push({ icon: 'calendar-outline', tint: '#FFA502', bg: '#FFF4E0', label: 'Nascimento', value: birthLbl });
  infoItems.push({ icon: 'cut-outline', tint: '#26de81', bg: '#E8FBF1', label: 'Castrado', value: pet.neutered ? 'Sim' : 'Não' });
  if (pet.microchip) infoItems.push({ icon: 'hardware-chip-outline', tint: '#8E99A8', bg: '#F1F2F6', label: 'Microchip', value: pet.microchip });

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={!heroZooming}>
        {/* Hero */}
        <View style={styles.hero}>
          {pet.main_photo_url ? (
            <ZoomableImage source={{ uri: pet.main_photo_url }} style={styles.heroImg} resizeMode="cover" onZoomStart={() => setHeroZooming(true)} onZoomEnd={() => setHeroZooming(false)} />
          ) : (
            <LinearGradient colors={['#FF6B81', '#FF4757']} style={styles.heroImg} />
          )}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.65)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <TouchableOpacity style={[styles.heroBack, { top: insets.top + 8 }]} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.heroEdit, { top: insets.top + 8 }]} onPress={() => router.push(`/meu-pet/${id}/editar` as Href)}>
            <Ionicons name="pencil" size={18} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.heroTextWrap} pointerEvents="none">
            <Text style={styles.heroName}>{pet.name}</Text>
            {!!subtitle && <Text style={styles.heroSub}>{subtitle}</Text>}
          </View>
        </View>

        <View style={styles.body}>
          {/* Perdi este pet */}
          <TouchableOpacity style={styles.lostBtn} activeOpacity={0.9} onPress={goLost}>
            <Ionicons name="alert-circle" size={22} color="#FFF" />
            <Text style={styles.lostBtnText}>Perdi este pet</Text>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
          <Text style={styles.lostHint}>Abre o alerta já com a foto preenchida.</Text>

          {/* Ficha */}
          <Text style={styles.sectionTitle}>Ficha</Text>
          {highlights.length > 0 && (
            <View style={styles.highlightRow}>
              {highlights.map((h) => (
                <View key={h.label} style={styles.highlightTile}>
                  <View style={[styles.highlightIcon, { backgroundColor: h.bg }]}>
                    <Ionicons name={h.icon} size={17} color={h.tint} />
                  </View>
                  <Text style={styles.highlightValue} numberOfLines={1}>{h.value}</Text>
                  <Text style={styles.highlightLabel}>{h.label}</Text>
                </View>
              ))}
            </View>
          )}
          {infoItems.length > 0 && (
            <View style={styles.infoCard}>
              {infoItems.map((it, idx) => (
                <View key={it.label} style={[styles.infoRow, idx === infoItems.length - 1 && styles.infoRowLast]}>
                  <View style={[styles.infoIcon, { backgroundColor: it.bg }]}>
                    <Ionicons name={it.icon} size={15} color={it.tint} />
                  </View>
                  <Text style={styles.infoLabel}>{it.label}</Text>
                  <Text style={styles.infoValue} numberOfLines={2}>{it.value}</Text>
                </View>
              ))}
            </View>
          )}
          {!!pet.health_notes && (
            <View style={styles.healthNote}>
              <View style={styles.healthNoteIcon}>
                <Ionicons name="heart" size={16} color="#FF6B81" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.healthNoteLabel}>Saúde</Text>
                <Text style={styles.healthNoteText}>{pet.health_notes}</Text>
              </View>
            </View>
          )}

          {/* Carteirinha */}
          <View style={styles.carteirinhaHeader}>
            <Text style={styles.carteirinhaTitle}>Carteirinha de saúde</Text>
            <TouchableOpacity
              style={styles.addRecordBtn}
              activeOpacity={0.85}
              onPress={() => router.push(`/meu-pet/${id}/saude/novo?petName=${encodeURIComponent(pet.name)}` as Href)}
            >
              <Ionicons name="add" size={18} color="#FFF" />
              <Text style={styles.addRecordText}>Adicionar</Text>
            </TouchableOpacity>
          </View>

          {records.length === 0 ? (
            <View style={styles.emptyRecords}>
              <Ionicons name="medkit-outline" size={30} color="#A4B0BE" />
              <Text style={styles.emptyRecordsText}>Nenhum registro ainda. Adicione vacinas, vermífugo, peso e mais.</Text>
            </View>
          ) : (
            records.map((r) => {
              const meta = TYPE_META[r.type] ?? TYPE_META.medicacao;
              const dateLbl = fmtDate(r.date_aplicada);
              const titleExtra =
                r.type === 'peso'
                  ? r.weight_kg != null ? ` · ${r.weight_kg} kg` : ''
                  : r.name ? ` · ${r.name}` : '';
              const dateLine = dateLbl ? `${r.type === 'peso' ? 'Pesado' : 'Aplicado'} em ${dateLbl}` : null;
              return (
                <TouchableOpacity key={r.id} style={styles.recordCard} activeOpacity={0.85} onPress={() => openRecordActions(r)}>
                  <View style={[styles.recordIcon, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordTitle} numberOfLines={1}>{meta.label}{titleExtra}</Text>
                    {!!dateLine && <Text style={styles.recordSub}>{dateLine}</Text>}
                    {!!r.vet && <Text style={styles.recordSub}>{r.vet}</Text>}
                    {!!r.proxima_data && <NextBadge proxima={r.proxima_data} />}
                  </View>
                  <Ionicons name="ellipsis-vertical" size={18} color="#A4B0BE" />
                </TouchableOpacity>
              );
            })
          )}

          {/* Excluir pet */}
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDeletePet}>
            <Ionicons name="trash-outline" size={18} color="#FF4757" />
            <Text style={styles.deleteBtnText}>Excluir este pet</Text>
          </TouchableOpacity>

          <View style={{ height: 60 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F2F6', gap: 12 },
  notFoundText: { color: '#747D8C', fontSize: 15, fontWeight: '600' },
  notFoundBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#FF4757', borderRadius: 14 },
  notFoundBtnText: { color: '#FFF', fontWeight: '800' },

  hero: { height: 280, backgroundColor: '#FFE0E4' },
  heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroBack: {
    position: 'absolute', top: 50, left: 18, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center',
  },
  heroEdit: {
    position: 'absolute', top: 50, right: 18, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center',
  },
  heroTextWrap: { position: 'absolute', left: 22, right: 22, bottom: 20 },
  heroName: { fontSize: 30, fontWeight: '900', color: '#FFF', letterSpacing: -0.5 },
  heroSub: { fontSize: 15, color: 'rgba(255,255,255,0.92)', fontWeight: '600', marginTop: 4 },

  body: { padding: 20, paddingTop: 22 },
  lostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FF4757',
    height: 58, borderRadius: 18, paddingHorizontal: 20,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
  },
  lostBtnText: { flex: 1, color: '#FFF', fontSize: 17, fontWeight: '800' },
  lostHint: { fontSize: 12.5, color: '#A4B0BE', marginTop: 8, marginLeft: 4, marginBottom: 4 },

  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginTop: 18, marginBottom: 12 },
  highlightRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  highlightTile: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 6, alignItems: 'center',
    shadowColor: '#8A94A6', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2,
  },
  highlightIcon: { width: 40, height: 40, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginBottom: 9 },
  highlightValue: { fontSize: 14, fontWeight: '800', color: '#2F3542', textAlign: 'center' },
  highlightLabel: { fontSize: 11, fontWeight: '700', color: '#A4B0BE', marginTop: 3 },

  infoCard: {
    backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4,
    shadowColor: '#8A94A6', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 2,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F1F4' },
  infoRowLast: { borderBottomWidth: 0 },
  infoIcon: { width: 30, height: 30, borderRadius: 9, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  infoLabel: { fontSize: 14, color: '#747D8C', fontWeight: '600' },
  infoValue: { flex: 1, fontSize: 14.5, color: '#2F3542', fontWeight: '700', textAlign: 'right', marginLeft: 16 },

  healthNote: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF4F6',
    borderRadius: 18, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#FFE1E7',
  },
  healthNoteIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#FFE1E7', justifyContent: 'center', alignItems: 'center' },
  healthNoteLabel: { fontSize: 11, fontWeight: '800', color: '#FF6B81', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 },
  healthNoteText: { fontSize: 14, color: '#2F3542', fontWeight: '600', lineHeight: 19 },

  carteirinhaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  carteirinhaTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542' },
  addRecordBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FF4757', paddingHorizontal: 14, height: 36, borderRadius: 13,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  addRecordText: { color: '#FFF', fontWeight: '800', fontSize: 13.5 },
  emptyRecords: {
    backgroundColor: '#FFF', borderRadius: 18, padding: 22, alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: '#ECECEC', borderStyle: 'dashed',
  },
  emptyRecordsText: { fontSize: 13.5, color: '#747D8C', textAlign: 'center', lineHeight: 19 },
  recordCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFF',
    borderRadius: 16, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  recordIcon: { width: 44, height: 44, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  recordTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  recordSub: { fontSize: 13, color: '#747D8C', marginTop: 2 },
  nextBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 6 },
  nextBadgeText: { fontSize: 11.5, fontWeight: '800' },

  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 26, paddingVertical: 14 },
  deleteBtnText: { color: '#FF4757', fontSize: 14.5, fontWeight: '700' },
});
