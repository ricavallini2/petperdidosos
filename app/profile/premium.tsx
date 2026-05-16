import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../../contexts/AuthContext';
import { usePremium } from '../../hooks/use-premium';
import { subscribePremium, updatePremiumSettings } from '../../services/api';
import { toast, showConfirm } from '../../components/Feedback';

const FEATURES = [
  {
    icon: 'sparkles',
    color: '#A855F7',
    title: 'Buscas por IA ilimitadas',
    desc: 'Use o reconhecimento por IA quantas vezes quiser por mês.',
  },
  {
    icon: 'notifications',
    color: '#FF4757',
    title: 'Alerta prioritário de recompensas',
    desc: 'Receba primeiro quando um pet com recompensa aparecer no seu raio ou faixa de valor.',
  },
  {
    icon: 'star',
    color: '#FFA502',
    title: 'Destaque no mapa',
    desc: 'Seu ícone de buscador aparece destacado no mapa para outros usuários.',
  },
];

export default function PremiumScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const premium = usePremium();

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'lifetime'>('monthly');
  const [purchasing, setPurchasing] = useState(false);

  const [alertEnabled, setAlertEnabled] = useState(premium.premiumSettings.alertEnabled);
  const [highlightOnMap, setHighlightOnMap] = useState(premium.premiumSettings.highlightOnMap);
  const [savingSettings, setSavingSettings] = useState(false);

  React.useEffect(() => {
    setAlertEnabled(premium.premiumSettings.alertEnabled);
    setHighlightOnMap(premium.premiumSettings.highlightOnMap);
  }, [premium.premiumSettings.alertEnabled, premium.premiumSettings.highlightOnMap]);

  const handlePurchase = async () => {
    if (!user) return;
    showConfirm({
      title: 'Confirmar assinatura',
      message: `Plano ${selectedPlan === 'monthly' ? 'Mensal' : 'Vitalício'} — R$ ${selectedPlan === 'monthly' ? '9,90/mês' : '79,90 único'}\n\nPagamento simulado (sem cobrança real).`,
      confirmText: 'Ativar Premium',
      cancelText: 'Cancelar',
      icon: 'star',
      onConfirm: async () => {
        setPurchasing(true);
        try {
          await subscribePremium(user.id, selectedPlan);
          await premium.reload();
          toast.success('Aproveite todas as vantagens da assinatura.', 'Premium ativado! ⭐');
        } catch (e: any) {
          toast.error(e?.message ?? 'Não foi possível ativar o premium.');
        } finally {
          setPurchasing(false);
        }
      },
    });
  };

  const saveSettings = async (patch: { alertEnabled?: boolean; highlightOnMap?: boolean }) => {
    if (!user || !premium.isPremium) return;
    setSavingSettings(true);
    try {
      await updatePremiumSettings(user.id, patch);
    } catch (e) {
      console.warn('Erro ao salvar configurações premium', e);
    } finally {
      setSavingSettings(false);
    }
  };

  if (premium.loading) {
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
        <Text style={styles.headerTitle}>Premium</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        <LinearGradient
          colors={['#FFD700', '#FFA502', '#FF6B35']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroIconWrap}>
            <Ionicons name="star" size={44} color="#FFF" />
          </View>
          {premium.isPremium ? (
            <>
              <Text style={styles.heroTitle}>Você é Premium ⭐</Text>
              <Text style={styles.heroSub}>
                Plano {premium.plan === 'lifetime' ? 'Vitalício' : 'Mensal'}
                {premium.expiresAt
                  ? ` · Renova em ${format(new Date(premium.expiresAt), "dd/MM/yyyy", { locale: ptBR })}`
                  : ' · Sem expiração'}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>PetPerdidoSOS Premium</Text>
              <Text style={styles.heroSub}>
                {premium.aiSearchesLeft != null
                  ? `Você ainda tem ${premium.aiSearchesLeft} busca${premium.aiSearchesLeft !== 1 ? 's' : ''} por IA este mês`
                  : 'Limite de buscas atingido'}
              </Text>
            </>
          )}
        </LinearGradient>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>O que está incluído</Text>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: f.color + '20' }]}>
                <Ionicons name={f.icon as any} size={22} color={f.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color="#2ED573" />
            </View>
          ))}
        </View>

        {!premium.isPremium && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Escolha seu plano</Text>

            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('monthly')}
              activeOpacity={0.85}
            >
              <View style={styles.planCardInner}>
                <View>
                  <Text style={styles.planName}>Mensal</Text>
                  <Text style={styles.planDesc}>Cancele quando quiser</Text>
                </View>
                <View style={styles.planPriceWrap}>
                  <Text style={styles.planCurrency}>R$</Text>
                  <Text style={styles.planPrice}>9</Text>
                  <Text style={styles.planCents}>,90</Text>
                  <Text style={styles.planPer}>/mês</Text>
                </View>
              </View>
              {selectedPlan === 'monthly' && (
                <View style={styles.planCheck}>
                  <Ionicons name="checkmark-circle" size={22} color="#FFA502" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'lifetime' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('lifetime')}
              activeOpacity={0.85}
            >
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>Melhor custo</Text>
              </View>
              <View style={styles.planCardInner}>
                <View>
                  <Text style={styles.planName}>Vitalício</Text>
                  <Text style={styles.planDesc}>Pague uma vez, use sempre</Text>
                </View>
                <View style={styles.planPriceWrap}>
                  <Text style={styles.planCurrency}>R$</Text>
                  <Text style={styles.planPrice}>79</Text>
                  <Text style={styles.planCents}>,90</Text>
                </View>
              </View>
              {selectedPlan === 'lifetime' && (
                <View style={styles.planCheck}>
                  <Ionicons name="checkmark-circle" size={22} color="#FFA502" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.buyBtn, purchasing && { opacity: 0.7 }]}
              onPress={handlePurchase}
              disabled={purchasing}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['#FFD700', '#FFA502']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.buyBtnGradient}
              >
                {purchasing ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="star" size={20} color="#FFF" />
                    <Text style={styles.buyBtnText}>Ativar Premium</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <Text style={styles.disclaimer}>
              Pagamento simulado — sem cobrança real nesta versão MVP.
              A integração com gateway de pagamento será adicionada em breve.
            </Text>
          </View>
        )}

        {premium.isPremium && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Configurações Premium</Text>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Alerta de recompensas</Text>
                <Text style={styles.settingDesc}>
                  Receba notificações prioritárias quando um pet com recompensa aparecer no seu raio
                </Text>
              </View>
              <Switch
                value={alertEnabled}
                onValueChange={(v) => { setAlertEnabled(v); saveSettings({ alertEnabled: v }); }}
                trackColor={{ false: '#DFE4EA', true: '#FFA50250' }}
                thumbColor={alertEnabled ? '#FFA502' : '#A4B0BE'}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Destaque no mapa</Text>
                <Text style={styles.settingDesc}>
                  Exibir seu ícone com borda dourada no mapa ao vivo
                </Text>
              </View>
              <Switch
                value={highlightOnMap}
                onValueChange={(v) => { setHighlightOnMap(v); saveSettings({ highlightOnMap: v }); }}
                trackColor={{ false: '#DFE4EA', true: '#FFA50250' }}
                thumbColor={highlightOnMap ? '#FFA502' : '#A4B0BE'}
              />
            </View>

            {savingSettings && (
              <ActivityIndicator size="small" color="#FFA502" style={{ marginTop: 8 }} />
            )}
          </View>
        )}

        <View style={[styles.section, { marginBottom: 0 }]}>
          <Text style={styles.sectionTitle}>Uso de buscas por IA</Text>
          <View style={styles.usageCard}>
            <View style={styles.usageRow}>
              <Text style={styles.usageLabel}>Usadas este mês</Text>
              <Text style={styles.usageValue}>{premium.aiSearchesUsed}</Text>
            </View>
            <View style={styles.usageRow}>
              <Text style={styles.usageLabel}>Limite mensal</Text>
              <Text style={styles.usageValue}>
                {premium.isPremium ? '∞ Ilimitado' : String(premium.aiSearchesLimit)}
              </Text>
            </View>
            {!premium.isPremium && (
              <>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.min(100, (premium.aiSearchesUsed / premium.aiSearchesLimit) * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.usageResetNote}>O contador reseta todo dia 1º do mês</Text>
              </>
            )}
          </View>
        </View>
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

  hero: {
    margin: 20, borderRadius: 24, padding: 28, alignItems: 'center',
    shadowColor: '#FFA502', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 8,
  },
  heroIconWrap: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#FFF', textAlign: 'center', marginBottom: 8 },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.9)', textAlign: 'center', lineHeight: 20 },

  section: {
    backgroundColor: '#FFF', marginHorizontal: 20, marginBottom: 16,
    borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 10, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase', marginBottom: 16 },

  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  featureTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542', marginBottom: 2 },
  featureDesc: { fontSize: 13, color: '#747D8C', lineHeight: 18 },

  planCard: {
    borderRadius: 16, borderWidth: 2, borderColor: '#DFE4EA', padding: 18,
    marginBottom: 10, position: 'relative',
  },
  planCardSelected: { borderColor: '#FFA502', backgroundColor: '#FFFBF0' },
  planCardInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planBadge: {
    position: 'absolute', top: -10, right: 14,
    backgroundColor: '#FFA502', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
  },
  planBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  planName: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginBottom: 2 },
  planDesc: { fontSize: 12, color: '#747D8C' },
  planPriceWrap: { flexDirection: 'row', alignItems: 'flex-end' },
  planCurrency: { fontSize: 14, fontWeight: '700', color: '#2F3542', marginBottom: 4 },
  planPrice: { fontSize: 34, fontWeight: '900', color: '#2F3542', lineHeight: 38 },
  planCents: { fontSize: 18, fontWeight: '700', color: '#2F3542', marginBottom: 4 },
  planPer: { fontSize: 12, color: '#747D8C', marginBottom: 6, marginLeft: 2 },
  planCheck: { position: 'absolute', top: 12, right: 14 },

  buyBtn: { marginTop: 8, borderRadius: 16, overflow: 'hidden', shadowColor: '#FFA502', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  buyBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 56 },
  buyBtnText: { color: '#FFF', fontSize: 17, fontWeight: '900' },
  disclaimer: { fontSize: 11, color: '#A4B0BE', textAlign: 'center', marginTop: 12, lineHeight: 16 },

  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F2F6',
  },
  settingLabel: { fontSize: 15, fontWeight: '700', color: '#2F3542', marginBottom: 2 },
  settingDesc: { fontSize: 12, color: '#747D8C', lineHeight: 17 },

  usageCard: { backgroundColor: '#F8F9FA', borderRadius: 14, padding: 16 },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  usageLabel: { fontSize: 14, color: '#57606F', fontWeight: '600' },
  usageValue: { fontSize: 14, fontWeight: '800', color: '#2F3542' },
  progressBar: { height: 8, backgroundColor: '#DFE4EA', borderRadius: 4, overflow: 'hidden', marginTop: 4, marginBottom: 8 },
  progressFill: { height: 8, backgroundColor: '#FFA502', borderRadius: 4 },
  usageResetNote: { fontSize: 11, color: '#A4B0BE', textAlign: 'center' },
});
