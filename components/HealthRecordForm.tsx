import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useRouter } from 'expo-router';
import { toast } from './Feedback';
import { addHealthRecord, updateHealthRecord, HealthRecord, HealthRecordInput, HealthRecordType } from '../services/api';
import { scheduleHealthReminder } from '../services/reminders';

const TYPE_META: Record<HealthRecordType, { label: string; icon: any; color: string }> = {
  vacina: { label: 'Vacina', icon: 'medkit', color: '#26de81' },
  vermifugo: { label: 'Vermífugo', icon: 'bug', color: '#60A5FA' },
  antipulgas: { label: 'Antipulgas', icon: 'paw', color: '#FFA502' },
  medicacao: { label: 'Medicação', icon: 'medical', color: '#FF6B81' },
  peso: { label: 'Peso', icon: 'fitness', color: '#A55EEA' },
};
const TYPES = Object.keys(TYPE_META) as HealthRecordType[];

type Props = { petId: string; petName: string; record?: HealthRecord | null };

const toDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export default function HealthRecordForm({ petId, petName, record }: Props) {
  const router = useRouter();
  const editing = !!record;

  const [type, setType] = useState<HealthRecordType>(record?.type ?? 'vacina');
  const [name, setName] = useState(record?.name ?? '');
  const [dateAplicada, setDateAplicada] = useState<Date | null>(toDate(record?.date_aplicada));
  const [proximaData, setProximaData] = useState<Date | null>(toDate(record?.proxima_data));
  const [vet, setVet] = useState(record?.vet ?? '');
  const [lote, setLote] = useState(record?.lote ?? '');
  const [weight, setWeight] = useState(record?.weight_kg != null ? String(record.weight_kg) : '');
  const [obs, setObs] = useState(record?.obs ?? '');
  const [picker, setPicker] = useState<'aplicada' | 'proxima' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPeso = type === 'peso';

  const onChangeDate = (event: any, selected?: Date) => {
    const field = picker;
    if (Platform.OS === 'android') {
      setPicker(null);
      if (event?.type === 'dismissed' || !selected) return;
    } else if (!selected) {
      return;
    }
    if (selected) {
      if (field === 'aplicada') setDateAplicada(selected);
      else if (field === 'proxima') setProximaData(selected);
    }
  };

  const handleSubmit = async () => {
    if (isPeso && (!weight.trim() || !Number.isFinite(Number(weight.replace(',', '.'))))) {
      return toast.warning('Informe um peso válido (kg).');
    }
    setIsSubmitting(true);
    try {
      const input: HealthRecordInput = {
        type,
        name: isPeso ? null : (name.trim() || null),
        date_aplicada: dateAplicada ? format(dateAplicada, 'yyyy-MM-dd') : null,
        proxima_data: proximaData ? format(proximaData, 'yyyy-MM-dd') : null,
        vet: isPeso ? null : (vet.trim() || null),
        lote: isPeso ? null : (lote.trim() || null),
        weight_kg: isPeso ? Number(weight.replace(',', '.')) : null,
        obs: obs.trim() || null,
      };

      let recordId: string;
      if (editing && record) {
        await updateHealthRecord(petId, record.id, input);
        recordId = record.id;
      } else {
        const created = await addHealthRecord(petId, input);
        recordId = created.id;
      }

      // Agenda/reagenda o lembrete (best-effort, não trava o salvar).
      await scheduleHealthReminder({
        recordId,
        meuPetId: petId,
        petName,
        type,
        proximaData: input.proxima_data ?? null,
      });

      toast.success(editing ? 'Registro atualizado!' : 'Registro adicionado!');
      router.back();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const DateField = ({ label, value, field }: { label: string; value: Date | null; field: 'aplicada' | 'proxima' }) => (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.locationButton} activeOpacity={0.8} onPress={() => setPicker(field)}>
        <Ionicons name="calendar-outline" size={22} color="#2F3542" />
        <Text style={[styles.locationButtonText, !value && { color: '#A4B0BE' }]}>
          {value ? format(value, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Não informado'}
        </Text>
        {value ? (
          <TouchableOpacity onPress={() => (field === 'aplicada' ? setDateAplicada(null) : setProximaData(null))} hitSlop={10}>
            <Ionicons name="close-circle" size={20} color="#A4B0BE" />
          </TouchableOpacity>
        ) : (
          <Ionicons name="pencil-outline" size={20} color="#A4B0BE" />
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
          <TouchableOpacity style={styles.headerBack} activeOpacity={0.8} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
            <Text style={styles.headerBackText}>Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{editing ? 'Editar registro' : 'Novo registro'}</Text>
          <Text style={styles.headerSubtitle}>Carteirinha de {petName}</Text>
        </LinearGradient>

        <View style={styles.formContainer}>
          <Text style={styles.sectionTitle}>Tipo</Text>
          <View style={styles.typeWrap}>
            {TYPES.map((t) => {
              const active = type === t;
              return (
                <TouchableOpacity key={t} style={[styles.typePill, active && styles.pillActive]} onPress={() => setType(t)}>
                  <Ionicons name={TYPE_META[t].icon} size={15} color={active ? '#FFF' : TYPE_META[t].color} />
                  <Text style={[styles.typePillText, active && styles.pillTextActive]}>{TYPE_META[t].label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isPeso ? (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Peso (kg)</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="fitness-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
                <TextInput style={styles.input} placeholder="Ex: 8.5" placeholderTextColor="#A4B0BE" keyboardType="decimal-pad" value={weight} onChangeText={setWeight} />
              </View>
            </View>
          ) : (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{type === 'medicacao' ? 'Medicação' : type === 'vacina' ? 'Vacina' : 'Produto'} (opcional)</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="pricetag-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
                <TextInput style={styles.input} placeholder="Ex: V10, Bravecto, Antibiótico..." placeholderTextColor="#A4B0BE" value={name} onChangeText={setName} />
              </View>
            </View>
          )}

          <DateField label={isPeso ? 'Data da pesagem' : 'Data aplicada'} value={dateAplicada} field="aplicada" />
          <DateField label="Próxima data (gera lembrete)" value={proximaData} field="proxima" />

          {!isPeso && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Veterinário / clínica (opcional)</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="medkit-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
                  <TextInput style={styles.input} placeholder="Nome do vet ou clínica" placeholderTextColor="#A4B0BE" value={vet} onChangeText={setVet} />
                </View>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Lote (opcional)</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="barcode-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
                  <TextInput style={styles.input} placeholder="Lote do produto" placeholderTextColor="#A4B0BE" value={lote} onChangeText={setLote} />
                </View>
              </View>
            </>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Observações (opcional)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Reação, dosagem, recomendações..."
              placeholderTextColor="#A4B0BE"
              value={obs}
              onChangeText={setObs}
              multiline
              numberOfLines={3}
            />
          </View>

          <TouchableOpacity style={styles.submitWrapper} activeOpacity={0.9} onPress={handleSubmit} disabled={isSubmitting}>
            <LinearGradient
              colors={isSubmitting ? ['#A4B0BE', '#A4B0BE'] : ['#FF6B81', '#FF4757']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitButton}
            >
              <Text style={styles.submitText}>{isSubmitting ? 'Salvando...' : editing ? 'Salvar alterações' : 'Adicionar à carteirinha'}</Text>
              {!isSubmitting && <Ionicons name="checkmark" size={22} color="#FFF" />}
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 150 }} />
        </View>
      </ScrollView>

      {/* Picker fora do ScrollView para não rolar junto no iOS */}
      {picker && (
        <View style={styles.pickerSheet}>
          <DateTimePicker
            value={(picker === 'aplicada' ? dateAplicada : proximaData) ?? new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onChangeDate}
            locale="pt-BR"
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.iosDoneBtn} onPress={() => setPicker(null)}>
              <Text style={styles.iosDoneText}>Concluir</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 70, paddingHorizontal: 24, paddingBottom: 30,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 10, opacity: 0.95 },
  headerBackText: { color: '#FFF', fontSize: 14, fontWeight: '700', marginLeft: 6 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF', marginBottom: 8, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  formContainer: { padding: 20, paddingTop: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#2F3542', marginBottom: 14 },

  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 44,
    borderRadius: 14, borderWidth: 1, borderColor: '#DFE4EA', backgroundColor: '#FFF',
  },
  typePillText: { fontWeight: '700', color: '#747D8C', fontSize: 14 },
  pillActive: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  pillTextActive: { color: '#FFF' },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: '#2F3542', marginBottom: 8, marginLeft: 4 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '500' },
  textarea: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#DFE4EA',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, minHeight: 90, textAlignVertical: 'top',
  },
  locationButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#DFE4EA', paddingHorizontal: 16, height: 56,
  },
  locationButtonText: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '600', marginLeft: 12 },

  pickerSheet: { backgroundColor: '#FFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DFE4EA', paddingBottom: 20 },
  iosDoneBtn: { alignSelf: 'flex-end', marginRight: 20, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: '#FF4757', borderRadius: 12 },
  iosDoneText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  submitWrapper: { marginTop: 14, shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8 },
  submitButton: { flexDirection: 'row', height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', gap: 8 },
  submitText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
});
