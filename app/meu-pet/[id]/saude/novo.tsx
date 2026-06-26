import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import HealthRecordForm from '../../../../components/HealthRecordForm';

export default function NovoRegistroSaudeScreen() {
  const { id, petName } = useLocalSearchParams<{ id: string; petName?: string }>();
  return <HealthRecordForm petId={String(id)} petName={petName ? String(petName) : 'seu pet'} />;
}
