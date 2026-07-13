import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import * as Location from 'expo-location';
import { getUserSettings, updateUserSettings, updateMyLocation } from '../../services/api';
import { toast } from '../../components/Feedback';

type Channel = 'email' | 'whatsapp' | 'both' | 'none';
type TravelMode = 'walking' | 'driving' | 'bicycling' | 'transit';

const RADIUS_OPTIONS = [1000, 5000, 10000, 25000, 50000];

const PIN_COLORS = ['#3498DB', '#FF4757', '#2ED573', '#A855F7', '#FFA502', '#FF6B81', '#1ABC9C', '#2F3542'];
const DEFAULT_PIN_COLOR = '#3498DB';

const CHANNELS: { value: Channel; label: string; icon: any }[] = [
  { value: 'email', label: 'E-mail', icon: 'mail-outline' },
  { value: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { value: 'both', label: 'Ambos', icon: 'notifications-outline' },
  { value: 'none', label: 'Nenhum', icon: 'volume-mute-outline' },
];

const TRAVEL: { value: TravelMode; label: string; icon: any }[] = [
  { value: 'walking', label: 'A pé', icon: 'walk-outline' },
  { value: 'driving', label: 'Carro', icon: 'car-outline' },
  { value: 'bicycling', label: 'Bike', icon: 'bicycle-outline' },
  { value: 'transit', label: 'Ônibus', icon: 'bus-outline' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [channel, setChannel] = useState<Channel>('email');
  const [radius, setRadius] = useState(5000);
  const [travel, setTravel] = useState<TravelMode>('driving');
  const [pinColor, setPinColor] = useState(DEFAULT_PIN_COLOR);
  const [regionAlerts, setRegionAlerts] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const s = await getUserSettings(user.id);
        if (s) {
          setChannel(s.notification_channel ?? 'email');
          setRadius(Number(s.default_search_radius_m ?? 5000));
          setTravel(s.travel_mode ?? 'driving');
          setPinColor(s.pin_color ?? DEFAULT_PIN_COLOR);
          setRegionAlerts(!!s.region_alerts_enabled);
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
          toast.warning('Ative a localização para receber alertas da sua região.');
        }
      } catch {
        // silencioso — o alerta é best-effort
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
        style={styles.header}
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

        {/* Notificações */}
        <Text style={styles.sectionTitle}>Notificações de novos alertas</Text>
        <View style={styles.optionsGrid}>
          {CHANNELS.map((c) => (
            <TouchableOpacity
              key={c.value}
              style={[styles.optionCard, channel === c.value && styles.optionCardActive]}
              onPress={() => { setChannel(c.value); persist({ notification_channel: c.value }); }}
            >
              <Ionicons name={c.icon} size={22} color={channel === c.value ? '#FFF' : '#FF4757'} />
              <Text style={[styles.optionLabel, channel === c.value && styles.optionLabelActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

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

        {/* Locomoção */}
        <Text style={styles.sectionTitle}>Modo de locomoção (para rotas)</Text>
        <View style={styles.optionsGrid}>
          {TRAVEL.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.optionCard, travel === t.value && styles.optionCardActive]}
              onPress={() => { setTravel(t.value); persist({ travel_mode: t.value }); }}
            >
              <Ionicons name={t.icon} size={22} color={travel === t.value ? '#FFF' : '#FF4757'} />
              <Text style={[styles.optionLabel, travel === t.value && styles.optionLabelActive]}>{t.label}</Text>
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

  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionCard: {
    flexGrow: 1, flexBasis: '46%', height: 62, backgroundColor: '#FFF', borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8,
    borderWidth: 1, borderColor: '#DFE4EA',
  },
  optionCardActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  optionLabel: { fontSize: 14, color: '#2F3542', fontWeight: '700' },
  optionLabelActive: { color: '#FFF' },

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
