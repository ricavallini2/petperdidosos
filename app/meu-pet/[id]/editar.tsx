import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import MeuPetForm from '../../../components/MeuPetForm';
import { getMyPet, MyPet } from '../../../services/api';

export default function EditarMeuPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pet, setPet] = useState<MyPet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await getMyPet(String(id));
        if (alive) setPet(p);
      } catch {
        // segue com formulário vazio se falhar
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  return <MeuPetForm title="Editar pet" petId={String(id)} initial={pet} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F2F6' },
});
