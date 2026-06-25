import React from 'react';
import { StyleSheet, View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// Placeholder da Fase 1. A Fase 2 preenche: ficha do pet, carteirinha de saúde
// (vacina/vermífugo/medicação/peso), lembretes e atalho "Perdi este pet".
export default function MeusPetsScreen() {
  const features: { icon: any; title: string; sub: string }[] = [
    { icon: 'paw', title: 'Ficha do seu pet', sub: 'Fotos, raça, cor, microchip e dados de saúde.' },
    { icon: 'medkit', title: 'Carteirinha de saúde', sub: 'Vacinas, vermífugo, medicação e peso num só lugar.' },
    { icon: 'notifications', title: 'Lembretes', sub: 'O app te avisa antes da próxima vacina ou dose.' },
    { icon: 'alert-circle', title: 'Perdi meu pet — 1 toque', sub: 'Se sumir, o alerta já sai pré-preenchido.' },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <Text style={styles.headerTitle}>Meus Pets</Text>
        <Text style={styles.headerSubtitle}>O cantinho de cuidado do seu pet</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.heroIconWrap}>
          <Ionicons name="paw" size={40} color="#FF4757" />
        </View>
        <Text style={styles.soonTitle}>Chega em breve 🐾</Text>
        <Text style={styles.soonText}>
          Aqui você vai cadastrar seu pet e manter tudo em ordem — e se ele sumir, o alerta sai num toque.
        </Text>

        <View style={styles.list}>
          {features.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={20} color="#FF4757" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureSub}>{f.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 70, paddingHorizontal: 24, paddingBottom: 28,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 6, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  body: { padding: 24, paddingTop: 28, alignItems: 'center' },
  heroIconWrap: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#FFF0F1',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  soonTitle: { fontSize: 20, fontWeight: '900', color: '#2F3542', marginBottom: 8 },
  soonText: { fontSize: 14, color: '#747D8C', textAlign: 'center', lineHeight: 20, marginBottom: 24, maxWidth: 320 },
  list: { alignSelf: 'stretch', gap: 12 },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFF',
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  featureIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFF0F1', justifyContent: 'center', alignItems: 'center' },
  featureTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542', marginBottom: 2 },
  featureSub: { fontSize: 13, color: '#747D8C', lineHeight: 18 },
});
