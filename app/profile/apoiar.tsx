import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { getDonationConfig, API_URL } from '../../services/api';

// ============================================================================
// APOIE O APP — doação voluntária que substitui o antigo Premium.
// O app é 100% gratuito; esta tela explica os custos e leva pra página de
// doação (Pix com valor livre) hospedada no backend (/doar).
// ============================================================================

const COSTS = [
  { icon: 'map' as const, color: '#3B82F6', bg: '#EFF6FF', title: 'Mapas e localização', desc: 'O mapa ao vivo com alertas e buscadores usa serviços pagos de geolocalização.' },
  { icon: 'sparkles' as const, color: '#8B5CF6', bg: '#F5F3FF', title: 'Busca por IA', desc: 'Cada foto analisada pelo reconhecimento de pets roda em servidores de IA.' },
  { icon: 'cloud' as const, color: '#0EA5E9', bg: '#F0F9FF', title: 'Servidores e fotos', desc: 'Banco de dados, fotos e o sistema que mantém tudo no ar 24h por dia.' },
  { icon: 'notifications' as const, color: '#FFA502', bg: '#FFF6E5', title: 'Notificações', desc: 'Alertas por região que fazem um pet perdido ser visto mais rápido.' },
];

export default function ApoiarScreen() {
  const router = useRouter();
  const [donation, setDonation] = useState<{ pixKey: string | null; url: string | null }>({ pixKey: null, url: null });

  useEffect(() => {
    getDonationConfig().then(setDonation).catch(() => {});
  }, []);

  // Página de doação: URL configurada no admin ou a página /doar do backend.
  const donationUrl = donation.url || `${API_URL}/doar`;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#2F3542" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Apoie o app</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <LinearGradient colors={['#2ED573', '#26B765']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="heart" size={30} color="#26B765" />
          </View>
          <Text style={styles.heroTitle}>Ajude a manter o{'\n'}PetPerdidoSOS no ar</Text>
          <Text style={styles.heroSub}>
            O app é e continuará <Text style={{ fontWeight: '900' }}>100% gratuito</Text> para quem perdeu
            um pet. Uma doação voluntária, de qualquer valor, cobre os custos que mantêm as buscas funcionando.
          </Text>
        </LinearGradient>

        {/* Para onde vai */}
        <Text style={styles.sectionTitle}>Para onde vai sua doação</Text>
        <View style={styles.costsCard}>
          {COSTS.map((c, i) => (
            <View key={c.title} style={[styles.costRow, i > 0 && styles.costRowBorder]}>
              <View style={[styles.costIcon, { backgroundColor: c.bg }]}>
                <Ionicons name={c.icon} size={20} color={c.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.costTitle}>{c.title}</Text>
                <Text style={styles.costDesc}>{c.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.donateBtn} activeOpacity={0.85} onPress={() => Linking.openURL(donationUrl)}>
          <Ionicons name="heart" size={20} color="#FFF" />
          <Text style={styles.donateBtnText}>Fazer uma doação via Pix</Text>
        </TouchableOpacity>
        <Text style={styles.donateNote}>
          Você escolhe o valor. O Pix é gerado no padrão do Banco Central e cai direto na conta do projeto — sem intermediários.
        </Text>

        {!!donation.pixKey && (
          <View style={styles.pixCard}>
            <Ionicons name="key-outline" size={18} color="#26B765" />
            <View style={{ flex: 1 }}>
              <Text style={styles.pixLabel}>Prefere copiar a chave Pix?</Text>
              <Text style={styles.pixKey} selectable>{donation.pixKey}</Text>
            </View>
          </View>
        )}

        {/* Transparência */}
        <View style={styles.trustCard}>
          <Ionicons name="shield-checkmark" size={20} color="#2ED573" />
          <Text style={styles.trustText}>
            Doar é opcional e não desbloqueia nada: todas as funções do app são liberadas para todo mundo.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 50, paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 3,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#2F3542' },

  hero: {
    borderRadius: 24, padding: 24, alignItems: 'center',
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 6,
  },
  heroIcon: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  heroTitle: { color: '#FFF', fontSize: 22, fontWeight: '900', textAlign: 'center', lineHeight: 29 },
  heroSub: { color: 'rgba(255,255,255,0.95)', fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 21 },

  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 24, marginBottom: 10, marginLeft: 4,
  },
  costsCard: {
    backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  costRowBorder: { borderTopWidth: 1, borderTopColor: '#F1F2F6' },
  costIcon: { width: 42, height: 42, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  costTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  costDesc: { fontSize: 12.5, color: '#747D8C', marginTop: 2, lineHeight: 17 },

  donateBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#2ED573', borderRadius: 18,
    paddingVertical: 17, justifyContent: 'center', alignItems: 'center', marginTop: 24,
    shadowColor: '#2ED573', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  donateBtnText: { color: '#FFF', fontSize: 16.5, fontWeight: '900' },
  donateNote: { fontSize: 12, color: '#A4B0BE', textAlign: 'center', marginTop: 10, lineHeight: 17, paddingHorizontal: 10 },

  pixCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E8F8F0',
    borderRadius: 16, padding: 14, marginTop: 16,
  },
  pixLabel: { fontSize: 12, fontWeight: '800', color: '#26B765' },
  pixKey: { fontSize: 13, color: '#2F3542', fontWeight: '600', marginTop: 2 },

  trustCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF',
    borderRadius: 16, padding: 14, marginTop: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  trustText: { flex: 1, fontSize: 12.5, color: '#747D8C', lineHeight: 18 },
});
