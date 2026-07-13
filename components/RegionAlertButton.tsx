import React, { useState } from 'react';
import { Modal, StyleSheet, View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { sendRegionAlert } from '../services/api';
import { toast } from './Feedback';

// Botão do tutor: destaca o pet perdido para buscadores da região (push + banner).
// Rate-limit: 1x por período (definido no admin) — o backend responde 429.
export function RegionAlertButton({ petId }: { petId: string }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [addToTimeline, setAddToTimeline] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await sendRegionAlert(petId, { comment: comment.trim() || undefined, addToTimeline });
      const km = Math.round((r.radius_m ?? 10000) / 1000);
      setOpen(false);
      setComment('');
      setAddToTimeline(false);
      toast.success(`Buscadores num raio de ${km} km foram avisados.`, 'Alerta enviado! 📣');
    } catch (e: any) {
      if (e?.status === 429) {
        let extra = '';
        if (e?.nextAvailableAt) {
          const diffH = Math.max(1, Math.ceil((new Date(e.nextAvailableAt).getTime() - Date.now()) / 3600000));
          extra = ` Tente novamente em ~${diffH}h.`;
        }
        toast.warning(`Você já alertou a região recentemente.${extra}`);
        setOpen(false);
      } else {
        toast.error(e?.message ?? 'Não foi possível enviar o alerta.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.trigger} activeOpacity={0.9} onPress={() => setOpen(true)}>
        <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.triggerBg}>
          <Ionicons name="megaphone" size={20} color="#FFF" />
          <Text style={styles.triggerText}>Alertar buscadores da região</Text>
        </LinearGradient>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.iconWrap}>
              <Ionicons name="megaphone" size={26} color="#FF4757" />
            </View>
            <Text style={styles.title}>Alertar a região</Text>
            <Text style={styles.desc}>
              Enviamos um aviso (push + no app) para buscadores próximos. Disponível
              1x por dia. Você pode incluir uma novidade.
            </Text>

            <Text style={styles.label}>Recado (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: visto perto da praça hoje de manhã..."
              placeholderTextColor="#A4B0BE"
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            <TouchableOpacity style={styles.toggleRow} activeOpacity={0.8} onPress={() => setAddToTimeline((v) => !v)}>
              <View style={[styles.checkbox, addToTimeline && styles.checkboxOn]}>
                {addToTimeline && <Ionicons name="checkmark" size={15} color="#FFF" />}
              </View>
              <Text style={styles.toggleText}>Adicionar este recado à linha do tempo do caso</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.confirmBtn} activeOpacity={0.9} onPress={submit} disabled={sending}>
              <LinearGradient
                colors={sending ? ['#A4B0BE', '#A4B0BE'] : ['#FF6B81', '#FF4757']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmBg}
              >
                {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
                <Text style={styles.confirmText}>{sending ? 'Enviando...' : 'Enviar alerta'}</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setOpen(false)} style={styles.cancel} disabled={sending}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { marginTop: 8 },
  triggerBg: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 54, borderRadius: 18,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
  },
  triggerText: { color: '#FFF', fontSize: 15.5, fontWeight: '800' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#FFF', borderRadius: 24, padding: 22, alignItems: 'center' },
  iconWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF0F1', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '900', color: '#2F3542', marginBottom: 6 },
  desc: { fontSize: 13.5, color: '#747D8C', textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '800', color: '#2F3542', marginBottom: 8 },
  input: {
    alignSelf: 'stretch', backgroundColor: '#F1F2F6', borderRadius: 14, padding: 14, minHeight: 80,
    fontSize: 15, color: '#2F3542', textAlignVertical: 'top',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', marginTop: 14 },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#CBD5E1',
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF',
  },
  checkboxOn: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  toggleText: { flex: 1, fontSize: 13.5, color: '#2F3542', fontWeight: '600', lineHeight: 18 },

  confirmBtn: { alignSelf: 'stretch', marginTop: 20 },
  confirmBg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 18 },
  confirmText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  cancel: { marginTop: 12, padding: 6 },
  cancelText: { color: '#747D8C', fontSize: 14, fontWeight: '700' },
});
