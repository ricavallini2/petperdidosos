import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../../../contexts/AuthContext';
import { getPetCase } from '../../../services/api';
import { Avatar } from '../../../components/Avatar';

const W = Dimensions.get('window').width;

const sizeLabel = (s?: string) =>
  s === 'pequeno' ? 'Pequeno' : s === 'medio' ? 'Médio' : s === 'grande' ? 'Grande' : null;

const STATUS: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  encontrado: { label: 'Encontrado', color: '#2ED573', bg: '#E8F8F5', icon: 'checkmark-circle' },
  cancelado: { label: 'Cancelado', color: '#747D8C', bg: '#F1F2F6', icon: 'close-circle' },
  pausado: { label: 'Pausado', color: '#FFA502', bg: '#FFF6E5', icon: 'pause-circle' },
  ativo: { label: 'Ativo', color: '#FF4757', bg: '#FFF0F1', icon: 'radio' },
  doado: { label: 'Doado', color: '#3B82F6', bg: '#EFF6FF', icon: 'gift' },
};

const fmtDate = (iso?: string | null) =>
  iso ? format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '—';

const fmtMoney = (v?: number | null) => `R$ ${Number(v ?? 0).toFixed(2)}`;

export default function PetCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await getPetCase(String(id));
        setData(d);
      } catch (e) {
        console.warn('Erro ao carregar caso', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  if (!data?.pet) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Ionicons name="alert-circle" size={48} color="#FFA502" />
        <Text style={{ marginTop: 12, color: '#747D8C' }}>Caso não encontrado.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#FF4757', fontWeight: '700' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { pet, reward, finder, timeline, messages } = data;
  const status = STATUS[pet.status] ?? STATUS.ativo;
  const rewardPaid = reward && reward.status === 'paid';
  const rewardRefunded = reward && reward.status === 'refunded';

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ficha do Caso</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Foto + nome + status */}
        <View style={styles.heroWrap}>
          <ExpoImage source={{ uri: pet.main_photo_url }} style={styles.heroImg} contentFit="cover" />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.heroGradient} />
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{pet.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Ionicons name={status.icon} size={13} color={status.color} />
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Características */}
          {(pet.breed || pet.color || sizeLabel(pet.size)) && (
            <View style={styles.tagsRow}>
              {[pet.breed, pet.color, sizeLabel(pet.size)].filter(Boolean).map((t: string, i: number) => (
                <View key={i} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Timeline */}
          <Text style={styles.sectionTitle}>Linha do tempo</Text>
          <View style={styles.card}>
            <TimelineRow icon="megaphone" color="#FF4757" label="Perdido em" value={fmtDate(timeline.lost_date)} />
            <View style={styles.timelineConnector} />
            <TimelineRow
              icon={pet.status === 'cancelado' ? 'close-circle' : 'checkmark-circle'}
              color={pet.status === 'cancelado' ? '#747D8C' : '#2ED573'}
              label={pet.status === 'cancelado' ? 'Cancelado em' : 'Encontrado em'}
              value={fmtDate(timeline.found_date)}
            />
            {timeline.days_lost != null && (
              <View style={styles.daysLostBox}>
                <Ionicons name="time" size={16} color="#FFA502" />
                <Text style={styles.daysLostText}>
                  Ficou perdido por{' '}
                  <Text style={{ fontWeight: '900' }}>
                    {timeline.days_lost === 0 ? 'menos de 1 dia' : `${timeline.days_lost} ${timeline.days_lost === 1 ? 'dia' : 'dias'}`}
                  </Text>
                </Text>
              </View>
            )}
          </View>

          {/* Quem resgatou */}
          {finder && (
            <>
              <Text style={styles.sectionTitle}>Quem resgatou</Text>
              <View style={styles.card}>
                <View style={styles.finderRow}>
                  <Avatar uri={finder.photo_url} size={56} style={styles.finderAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.finderName}>{finder.full_name ?? 'Herói'}</Text>
                    <View style={styles.finderBadge}>
                      <Ionicons name="trophy" size={12} color="#FFF" />
                      <Text style={styles.finderBadgeText}>
                        {finder.rescues_count ?? 0} {finder.rescues_count === 1 ? 'resgate' : 'resgates'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Recompensa */}
          {reward && (
            <>
              <Text style={styles.sectionTitle}>Recompensa</Text>
              <View style={styles.card}>
                <View style={styles.rewardRow}>
                  <View>
                    <Text style={styles.rewardLabel}>
                      {rewardRefunded ? 'Recompensa (caso encerrado)' : 'Recompensa combinada'}
                    </Text>
                    <Text style={[styles.rewardValue, { color: rewardPaid ? '#2ED573' : '#2F3542' }]}>
                      {fmtMoney(reward.amount)}
                    </Text>
                  </View>
                  <Ionicons
                    name={rewardPaid ? 'gift' : rewardRefunded ? 'return-up-back' : 'wallet'}
                    size={36}
                    color={rewardPaid ? '#2ED573' : '#A4B0BE'}
                  />
                </View>
                <View style={styles.rewardMetaRow}>
                  <Text style={styles.rewardMeta}>Combinada diretamente entre as pessoas — o app não intermedia o pagamento.</Text>
                </View>
              </View>
            </>
          )}

          {/* Histórico do chat */}
          {messages && messages.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Histórico da conversa</Text>
              <View style={styles.card}>
                {messages.map((m: any) => {
                  const mine = m.sender_id === pet.user_id; // tutor = dono do pet
                  return (
                    <View key={m.id} style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}>
                      <View style={[styles.msgBubble, mine ? styles.msgBubbleMine : styles.msgBubbleOther]}>
                        {m.photo_url && (
                          <ExpoImage source={{ uri: m.photo_url }} style={styles.msgPhoto} contentFit="cover" />
                        )}
                        {m.content && (
                          <Text style={[styles.msgText, mine ? { color: '#FFF' } : { color: '#2F3542' }]}>
                            {m.content}
                          </Text>
                        )}
                        <Text style={[styles.msgTime, mine ? { color: 'rgba(255,255,255,0.7)' } : { color: '#A4B0BE' }]}>
                          {format(new Date(m.created_at), 'dd/MM HH:mm')}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* Descrição original */}
          {pet.description ? (
            <>
              <Text style={styles.sectionTitle}>Descrição do alerta</Text>
              <View style={styles.card}>
                <Text style={styles.bodyText}>{pet.description}</Text>
                {pet.extra_info ? <Text style={[styles.bodyText, { marginTop: 8, color: '#747D8C' }]}>{pet.extra_info}</Text> : null}
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function TimelineRow({ icon, color, label, value }: { icon: any; color: string; label: string; value: string }) {
  return (
    <View style={styles.timelineRow}>
      <View style={[styles.timelineDot, { backgroundColor: color }]}>
        <Ionicons name={icon} size={14} color="#FFF" />
      </View>
      <View>
        <Text style={styles.timelineLabel}>{label}</Text>
        <Text style={styles.timelineValue}>{value}</Text>
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

  heroWrap: { width: W, height: 260, position: 'relative' },
  heroImg: { width: W, height: 260, backgroundColor: '#DFE4EA' },
  heroGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  heroInfo: { position: 'absolute', left: 20, right: 20, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroName: { fontSize: 30, fontWeight: '900', color: '#FFF', letterSpacing: -0.5, flex: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '800' },

  body: { padding: 20 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: { backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  tagText: { fontSize: 13, color: '#2F3542', fontWeight: '600' },

  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase', marginTop: 22, marginBottom: 10 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  bodyText: { fontSize: 15, color: '#2F3542', lineHeight: 22 },

  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timelineDot: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  timelineConnector: { width: 2, height: 18, backgroundColor: '#DFE4EA', marginLeft: 14, marginVertical: 2 },
  timelineLabel: { fontSize: 12, color: '#747D8C', fontWeight: '600' },
  timelineValue: { fontSize: 15, color: '#2F3542', fontWeight: '800', marginTop: 1 },
  daysLostBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF6E5',
    padding: 12, borderRadius: 12, marginTop: 14,
  },
  daysLostText: { fontSize: 14, color: '#FFA502', fontWeight: '600' },

  finderRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  finderAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#DFE4EA' },
  finderAvatarEmpty: { justifyContent: 'center', alignItems: 'center' },
  finderName: { fontSize: 17, fontWeight: '800', color: '#2F3542' },
  finderBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFD32A',
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9, marginTop: 5, alignSelf: 'flex-start',
  },
  finderBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  rewardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rewardLabel: { fontSize: 13, color: '#747D8C', fontWeight: '600' },
  rewardValue: { fontSize: 28, fontWeight: '900', marginTop: 2 },
  rewardMetaRow: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F2F6', gap: 3 },
  rewardMeta: { fontSize: 12, color: '#A4B0BE', fontWeight: '500' },

  msgRow: { marginBottom: 8 },
  msgLeft: { alignItems: 'flex-start' },
  msgRight: { alignItems: 'flex-end' },
  msgBubble: { maxWidth: '82%', padding: 10, borderRadius: 14 },
  msgBubbleMine: { backgroundColor: '#FF4757', borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: '#F1F2F6', borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, lineHeight: 19 },
  msgPhoto: { width: 160, height: 160, borderRadius: 10, marginBottom: 4 },
  msgTime: { fontSize: 10, marginTop: 3, alignSelf: 'flex-end' },
});
