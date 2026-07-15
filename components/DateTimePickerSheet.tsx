import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  value: Date;
  mode?: 'date' | 'time' | 'datetime';
  title?: string;
  maximumDate?: Date;
  minimumDate?: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
};

/**
 * Bottom sheet de data/hora para iOS.
 * No iOS o DateTimePicker é inline (não abre diálogo como no Android) e o onChange
 * dispara a cada giro do spinner — por isso o valor fica em estado temporário e só
 * é aplicado no "Confirmar". No Android este componente não renderiza nada
 * (o fluxo nativo de 2 passos date→time continua intacto nas telas).
 */
export default function DateTimePickerSheet({
  visible,
  value,
  mode = 'date',
  title,
  maximumDate,
  minimumDate,
  onConfirm,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const [tempDate, setTempDate] = useState<Date>(value);

  // Re-sincroniza o valor temporário sempre que o sheet abre
  useEffect(() => {
    if (visible) setTempDate(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (Platform.OS !== 'ios') return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onCancel} hitSlop={10}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{title ?? ''}</Text>
            <TouchableOpacity onPress={() => onConfirm(tempDate)} hitSlop={10}>
              <Text style={styles.confirmText}>Confirmar</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={tempDate}
            mode={mode}
            display="spinner"
            locale="pt-BR"
            is24Hour
            themeVariant="light"
            textColor="#2F3542"
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            onChange={(_event, selected) => { if (selected) setTempDate(selected); }}
            style={styles.picker}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(47,53,66,0.45)' },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F2F6',
  },
  title: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#2F3542', marginHorizontal: 8 },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#747D8C' },
  confirmText: { fontSize: 15, fontWeight: '800', color: '#FF4757' },
  picker: { alignSelf: 'center', width: '100%', height: 216 },
});
