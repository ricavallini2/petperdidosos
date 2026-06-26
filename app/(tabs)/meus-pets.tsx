import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchMyPets, MyPet } from '../../services/api';

const SPECIES_LABEL: Record<string, string> = {
  cachorro: 'Cachorro', gato: 'Gato', passaro: 'Pássaro', outro: 'Outro',
};

// Idade aproximada a partir do nascimento (meses < 1 ano, senão anos).
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

function petSubtitle(pet: MyPet): string {
  return [pet.species ? SPECIES_LABEL[pet.species] : null, pet.breed, ageLabel(pet.birth_date)]
    .filter(Boolean)
    .join(' · ');
}

export default function MeusPetsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pets, setPets] = useState<MyPet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchInto = useCallback(async (isActive: () => boolean, mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await fetchMyPets();
      if (isActive()) setPets(data);
    } catch {
      // mantém o que já tinha; lista vazia mostra o estado inicial
    } finally {
      if (isActive()) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchInto(() => active, 'initial');
      return () => { active = false; };
    }, [fetchInto]),
  );

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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF4757" />
        </View>
      ) : pets.length === 0 ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="paw" size={40} color="#FF4757" />
          </View>
          <Text style={styles.soonTitle}>Nenhum pet cadastrado ainda 🐾</Text>
          <Text style={styles.soonText}>
            Cadastre seu pet e mantenha tudo em ordem — e se ele sumir, o alerta sai num toque.
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

          <TouchableOpacity
            style={styles.emptyCta}
            activeOpacity={0.9}
            // TODO Fase 3: gate criação quando !isPremium && pets.length >= maxFreePets
            onPress={() => router.push('/meu-pet/novo' as Href)}
          >
            <Ionicons name="add" size={22} color="#FFF" />
            <Text style={styles.emptyCtaText}>Cadastrar meu pet</Text>
          </TouchableOpacity>
          <View style={{ height: 120 }} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listBody}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchInto(() => true, 'refresh')} tintColor="#FF4757" />}
        >
          {pets.map((pet) => {
            const sub = petSubtitle(pet);
            return (
              <TouchableOpacity
                key={pet.id}
                style={styles.petCard}
                activeOpacity={0.85}
                onPress={() => router.push(`/meu-pet/${pet.id}` as Href)}
              >
                {pet.main_photo_url ? (
                  <Image source={{ uri: pet.main_photo_url }} style={styles.petThumb} />
                ) : (
                  <View style={[styles.petThumb, styles.petThumbPlaceholder]}>
                    <Ionicons name="paw" size={26} color="#FF4757" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.petName} numberOfLines={1}>{pet.name}</Text>
                  {!!sub && <Text style={styles.petSub} numberOfLines={1}>{sub}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={22} color="#A4B0BE" />
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 140 }} />
        </ScrollView>
      )}

      {/* FAB de adicionar (oculto no estado vazio, que já tem o CTA grande) */}
      {!loading && pets.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 80 }]}
          activeOpacity={0.9}
          // TODO Fase 3: gate criação quando !isPremium && pets.length >= maxFreePets
          onPress={() => router.push('/meu-pet/novo' as Href)}
        >
          <Ionicons name="add" size={30} color="#FFF" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingTop: 70, paddingHorizontal: 24, paddingBottom: 28,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#FFF', marginBottom: 6, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },

  // Estado vazio
  body: { padding: 24, paddingTop: 28, alignItems: 'center' },
  heroIconWrap: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#FFF0F1',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  soonTitle: { fontSize: 20, fontWeight: '900', color: '#2F3542', marginBottom: 8, textAlign: 'center' },
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
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'stretch', marginTop: 24, height: 56, borderRadius: 18, backgroundColor: '#FF4757',
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
  },
  emptyCtaText: { color: '#FFF', fontSize: 16, fontWeight: '800' },

  // Lista de pets
  listBody: { padding: 20, paddingTop: 22 },
  petCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFF',
    borderRadius: 18, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  petThumb: { width: 60, height: 60, borderRadius: 16, backgroundColor: '#F1F2F6' },
  petThumbPlaceholder: { backgroundColor: '#FFF0F1', justifyContent: 'center', alignItems: 'center' },
  petName: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginBottom: 3 },
  petSub: { fontSize: 13.5, color: '#747D8C' },

  fab: {
    position: 'absolute', right: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#FF4757',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 10,
  },
});
