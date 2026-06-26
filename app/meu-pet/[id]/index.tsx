import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
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

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          {pet.main_photo_url ? (
            <Image source={{ uri: pet.main_photo_url }} style={styles.heroImg} />
          ) : (
            <LinearGradient colors={['#FF6B81', '#FF4757']} style={styles.heroImg} />
          )}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.65)']} style={StyleSheet.absoluteFill} />
          <TouchableOpacity style={styles.heroBack} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.heroEdit} onPress={() => router.push(`/meu-pet/${id}/editar` as Href)}>
            <Ionicons name="pencil" size={18} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.heroTextWrap}>
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
          <View style={styles.infoCard}>
            <InfoRow label="Espécie" value={pet.species ? SPECIES_LABEL[pet.species] : null} />
            <InfoRow label="Raça" value={pet.breed} />
            <InfoRow label="Cor" value={pet.color} />
            <InfoRow label="Porte" value={pet.size ? SIZE_LABEL[pet.size] : null} />
            <InfoRow label="Sexo" value={pet.sex ? SEX_LABEL[pet.sex] : null} />
            <InfoRow label="Idade" value={ageLabel(pet.birth_date)} />
            <InfoRow label="Nascimento" value={fmtDate(pet.birth_date)} />
            <InfoRow label="Microchip" value={pet.microchip} />
            <InfoRow label="Castrado" value={pet.neutered ? 'Sim' : 'Não'} />
            <InfoRow label="Saúde" value={pet.health_notes} />
          </View>

          {/* Carteirinha */}
          <View style={styles.carteirinhaHeader}>
            <Text style={styles.sectionTitle}>Carteirinha de saúde</Text>
            <TouchableOpacity
              style={styles.addRecordBtn}
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
  infoCard: {
    backgroundColor: '#FFF', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECECEC' },
  infoLabel: { fontSize: 14, color: '#747D8C', fontWeight: '600' },
  infoValue: { fontSize: 14.5, color: '#2F3542', fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 16 },

  carteirinhaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addRecordBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FF4757', paddingHorizontal: 14, height: 38, borderRadius: 12, marginTop: 6 },
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
