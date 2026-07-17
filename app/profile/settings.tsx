import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import * as Location from 'expo-location';
import { getUserSettings, updateUserSettings, updateMyLocation } from '../../services/api';
import { toast } from '../../components/Feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RADIUS_OPTIONS = [1000, 5000, 10000, 25000, 50000];

const PIN_COLORS = ['#3498DB', '#FF4757', '#2ED573', '#A855F7', '#FFA502', '#FF6B81', '#1ABC9C', '#2F3542'];
const DEFAULT_PIN_COLOR = '#3498DB';

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [radius, setRadius] = useState(5000);
  const [pinColor, setPinColor] = useState(DEFAULT_PIN_COLOR);
  const [regionAlerts, setRegionAlerts] = useState(false);
  // Push: padrão ligado (igual ao default do banco).
  const [pushMessages, setPushMessages] = useState(true);
  const [pushCaseActivity, setPushCaseActivity] = useState(true);
  const [pushAnnouncements, setPushAnnouncements] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const s = await getUserSettings(user.id);
        if (s) {
          setRadius(Number(s.default_search_radius_m ?? 5000));
          setPinColor(s.pin_color ?? DEFAULT_PIN_COLOR);
          setRegionAlerts(!!s.region_alerts_enabled);
          setPushMessages(s.push_messages !== false);
          setPushCaseActivity(s.push_case_activity !== false);
          setPushAnnouncements(s.push_announcements !== false);
        }
      } catch (e) {
        console.warn('Erro ao carregar config', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const persist = async (patch: Parameters<typeof updateUserSettings>[1]) => {
    if (!user) return;
    try {
      setSaving(true);
      await updateUserSettings(user.id, patch);
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const toggleRegionAlerts = async (v: boolean) => {
    setRegionAlerts(v);
    await persist({ region_alerts_enabled: v });
    if (v) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          await updateMyLocation(loc.coords.latitude, loc.coords.longitude);
        } else {
          // Sem permissão de localização o opt-in é inútil (o backend não grava
          // localização) → reverte o toggle para não iludir o usuário.
          setRegionAlerts(false);
          await persist({ region_alerts_enabled: false });
          toast.warning('Ative a permissão de localização para receber alertas da sua região.');
        }
      } catch {
        setRegionAlerts(false);
      }
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
    <View style={styles.container}>
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 10 }]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Configurações</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
        {/* Atalho para Privacidade e Segurança (visibilidade no mapa, foto, senha) */}
        <TouchableOpacity style={styles.privacyLink} onPress={() => router.push('/profile/privacy')} activeOpacity={0.7}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#FF4757" />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Privacidade e Segurança</Text>
            <Text style={styles.rowSub}>Visibilidade no mapa, foto de perfil, senha</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#C7CDD4" />
        </TouchableOpacity>

        {/* Notificações push. Desligar aqui silencia só o aviso no celular — a
            notificação continua aparecendo no sino, dentro do app. */}
        <Text style={styles.sectionTitle}>Notificações no celular</Text>
        <View style={styles.pushCard}>
          <PushRow
            icon="chatbubbles-outline"
            title="Novas mensagens"
            sub="Quando alguém responde no chat"
            value={pushMessages}
            onToggle={(v) => { setPushMessages(v); persist({ push_messages: v }); }}
          />
          <View style={styles.pushDivider} />
          <PushRow
            icon="paw-outline"
            title="Atividade nos meus casos"
            sub="Avistamentos, confirmações de reencontro e doações"
            value={pushCaseActivity}
            onToggle={(v) => { setPushCaseActivity(v); persist({ push_case_activity: v }); }}
          />
          <View style={styles.pushDivider} />
          <PushRow
            icon="megaphone-outline"
            title="Novidades do app"
            sub="Comunicados e avisos de atualização"
            value={pushAnnouncements}
            onToggle={(v) => { setPushAnnouncements(v); persist({ push_announcements: v }); }}
          />
        </View>
        <Text style={styles.pushHint}>
          Mesmo desligadas, as notificações continuam no sino, dentro do app.
        </Text>

        {/* Alertas de pets perdidos na região (opt-in) */}
        <Text style={styles.sectionTitle}>Alertas da minha região</Text>
        <View style={styles.raCard}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.raTitle}>Avisar sobre pets perdidos perto de mim</Text>
            <Text style={styles.raSub}>
              Você recebe um aviso quando um tutor destacar um pet perdido na sua região.
              Usa sua localização (guardada só enquanto isto estiver ligado).
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.toggle, regionAlerts && styles.toggleOn]}
            activeOpacity={0.8}
            onPress={() => toggleRegionAlerts(!regionAlerts)}
          >
            <View style={[styles.toggleDot, regionAlerts && styles.toggleDotOn]} />
          </TouchableOpacity>
        </View>

        {/* Raio padrão */}
        <Text style={styles.sectionTitle}>Raio de busca padrão</Text>
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.radiusPill, radius === r && styles.radiusPillActive]}
              onPress={() => { setRadius(r); persist({ default_search_radius_m: r }); }}
            >
              <Text style={[styles.radiusText, radius === r && styles.radiusTextActive]}>
                {r >= 1000 ? `${r / 1000}km` : `${r}m`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cor do pin */}
        <Text style={styles.sectionTitle}>Cor do meu pin no mapa</Text>
        <View style={styles.colorCard}>
          <View style={styles.colorRow}>
            {PIN_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c },
                  pinColor === c && styles.colorSwatchActive,
                ]}
                onPress={() => { setPinColor(c); persist({ pin_color: c }); }}
                activeOpacity={0.8}
              >
                {pinColor === c && <Ionicons name="checkmark" size={20} color="#FFF" />}
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.pinPreview}>
            <Ionicons name="walk" size={30} color={pinColor} />
            <Text style={styles.pinPreviewText}>Prévia do seu marcador no mapa</Text>
          </View>
        </View>

        {saving && (
          <View style={{ marginTop: 20, alignItems: 'center' }}>
            <ActivityIndicator color="#FF4757" />
            <Text style={{ color: '#747D8C', marginTop: 6, fontSize: 12 }}>Salvando…</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Linha de preferência de push: ícone + título/descrição + toggle.
function PushRow({ icon, title, sub, value, onToggle }: {
  icon: any; title: string; sub: string; value: boolean; onToggle: (v: boolean) => void;
}) {
  return (
    <TouchableOpacity style={styles.pushRow} activeOpacity={0.7} onPress={() => onToggle(!value)}>
      <View style={[styles.pushIcon, value && styles.pushIconOn]}>
        <Ionicons name={icon} size={19} color={value ? '#FF4757' : '#A4B0BE'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.pushTitle}>{title}</Text>
        <Text style={styles.pushSub}>{sub}</Text>
      </View>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleDot, value && styles.toggleDotOn]} />
      </View>
    </TouchableOpacity>
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

  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#747D8C', marginTop: 22, marginBottom: 10, marginLeft: 4, textTransform: 'uppercase' },

  // Preferências de push
  pushCard: {
    backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  pushIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: '#F1F2F6',
    justifyContent: 'center', alignItems: 'center',
  },
  pushIconOn: { backgroundColor: '#FFF0F1' },
  pushTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  pushSub: { fontSize: 12.5, color: '#A4B0BE', fontWeight: '600', marginTop: 2, lineHeight: 17 },
  pushDivider: { height: 1, backgroundColor: '#F1F2F6' },
  pushHint: { fontSize: 12, color: '#A4B0BE', fontWeight: '600', marginTop: 8, marginLeft: 4, lineHeight: 17 },

  row: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 15, color: '#2F3542', fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#A4B0BE', marginTop: 2 },
  privacyLink: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginTop: 4,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },


  raCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, padding: 16 },
  raTitle: { fontSize: 15, color: '#2F3542', fontWeight: '800', marginBottom: 3 },
  raSub: { fontSize: 12.5, color: '#747D8C', lineHeight: 17 },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#DFE4EA', justifyContent: 'center', padding: 3 },
  toggleOn: { backgroundColor: '#2ED573' },
  toggleDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF' },
  toggleDotOn: { transform: [{ translateX: 22 }] },

  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radiusPill: {
    backgroundColor: '#FFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#DFE4EA',
  },
  radiusPillActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  radiusText: { fontSize: 14, fontWeight: '700', color: '#2F3542' },
  radiusTextActive: { color: '#FFF' },

  colorCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  colorSwatch: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  colorSwatchActive: {
    borderColor: '#2F3542',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  pinPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F1F2F6',
  },
  pinPreviewText: { fontSize: 13, color: '#747D8C', fontWeight: '600' },
});
