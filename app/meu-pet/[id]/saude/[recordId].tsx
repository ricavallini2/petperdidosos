import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import HealthRecordForm from '../../../../components/HealthRecordForm';
import { getMyPet, HealthRecord } from '../../../../services/api';

export default function EditarRegistroSaudeScreen() {
  const { id, recordId } = useLocalSearchParams<{ id: string; recordId: string }>();
  const [state, setState] = useState<{ petName: string; record: HealthRecord | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pet = await getMyPet(String(id));
        const rec = (pet.health_records ?? []).find((r) => r.id === String(recordId)) ?? null;
        if (alive) setState({ petName: pet.name, record: rec });
      } catch {
        if (alive) setState({ petName: 'seu pet', record: null });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, recordId]);

  if (loading || !state) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  return <HealthRecordForm petId={String(id)} petName={state.petName} record={state.record} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F2F6' },
});
