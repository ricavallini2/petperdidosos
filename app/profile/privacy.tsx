import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Switch, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { getUserSettings, updateUserSettings, deleteAccount, listBlockedUsers, unblockUser, BlockedUser } from '../../services/api';
import { toast, showConfirm } from '../../components/Feedback';

const PRIVACY_POLICY_URL = 'https://api.imestredigital.cloud/privacidade';
const TERMS_URL = 'https://api.imestredigital.cloud/termos';

export default function PrivacyScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showOnMap, setShowOnMap] = useState(true);
  const [showProfilePhoto, setShowProfilePhoto] = useState(true);

  // Alterar senha
  const [pwModal, setPwModal] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const newPwRef = useRef<TextInput>(null);
  const confirmPwRef = useRef<TextInput>(null);

  const [busy, setBusy] = useState(false);

  // Usuários bloqueados (App Store Guideline 1.2 — precisa dar para desfazer)
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);

  useEffect(() => {
    if (!user) return;
    listBlockedUsers()
      .then(setBlocked)
      .catch(() => {})
      .finally(() => setLoadingBlocks(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const s = await getUserSettings(user.id);
        if (s) {
          setShowOnMap(!!s.show_on_map);
          setShowProfilePhoto(s.show_profile_photo !== false);
        }
      } catch {
        // mantém padrões
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const persist = async (patch: Parameters<typeof updateUserSettings>[1]) => {
    if (!user) return;
    try {
      setSaving(true);
      await updateUserSettings(user.id, patch);
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  // ---- Alterar senha -------------------------------------------------------
  const openPwModal = () => { setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwModal(true); };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    if (!currentPw) return toast.warning('Informe sua senha atual.');
    if (newPw.length < 6) return toast.warning('A nova senha precisa ter ao menos 6 caracteres.');
    if (newPw !== confirmPw) return toast.warning('A confirmação não confere com a nova senha.');
    if (newPw === currentPw) return toast.warning('A nova senha deve ser diferente da atual.');

    try {
      setPwSaving(true);
      // Reautentica para confirmar a identidade antes de trocar a senha.
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPw });
      if (signErr) { toast.error('Senha atual incorreta.', 'Não foi possível alterar'); return; }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { toast.error(error.message, 'Não foi possível alterar'); return; }
      setPwModal(false);
      toast.success('Sua senha foi alterada com sucesso.', 'Senha atualizada');
    } catch (e: any) {
      toast.error(e?.message ?? 'Tente novamente.', 'Erro');
    } finally {
      setPwSaving(false);
    }
  };

  // ---- Sair de todos os dispositivos --------------------------------------
  const handleSignOutEverywhere = () => {
    showConfirm({
      title: 'Sair de todos os dispositivos',
      message: 'Sua sessão será encerrada em todos os aparelhos. Você precisará entrar novamente.',
      icon: 'log-out-outline',
      confirmText: 'Sair de tudo',
      onConfirm: async () => {
        try {
          setBusy(true);
          await supabase.auth.signOut({ scope: 'global' });
          router.replace('/login');
        } catch (e: any) {
          toast.error(e?.message ?? 'Tente novamente.', 'Erro');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  // ---- Excluir conta -------------------------------------------------------
  const handleDeleteAccount = () => {
    showConfirm({
      title: 'Excluir minha conta',
      message: 'Esta ação é permanente. Seus alertas, conversas e dados serão apagados e não poderão ser recuperados. Tem certeza?',
      icon: 'trash',
      destructive: true,
      confirmText: 'Excluir conta',
      onConfirm: () => {
        // Segunda confirmação — evita exclusão acidental.
        showConfirm({
          title: 'Confirmar exclusão',
          message: 'Toque em “Excluir definitivamente” para apagar sua conta agora.',
          icon: 'warning',
          destructive: true,
          confirmText: 'Excluir definitivamente',
          onConfirm: async () => {
            try {
              setBusy(true);
              await deleteAccount();
              await supabase.auth.signOut().catch(() => {});
              toast.success('Sua conta foi excluída.', 'Conta excluída');
              router.replace('/login');
            } catch (e: any) {
              toast.error(e?.message ?? 'Tente novamente.', 'Não foi possível excluir');
            } finally {
              setBusy(false);
            }
          },
        });
      },
    });
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#FF6B81', '#FF4757']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacidade e Segurança</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
        {/* PRIVACIDADE */}
        <Text style={styles.sectionTitle}>Privacidade</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Ionicons name="eye-outline" size={20} color="#FF4757" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Aparecer como buscador no mapa</Text>
                <Text style={styles.rowSub}>Outros usuários veem seu ícone próximo</Text>
              </View>
            </View>
            <Switch
              value={showOnMap}
              onValueChange={(v) => { setShowOnMap(v); persist({ show_on_map: v }); }}
              trackColor={{ false: '#DFE4EA', true: '#FF4757' }} thumbColor="#FFF"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Ionicons name="person-circle-outline" size={20} color="#FF4757" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Mostrar minha foto de perfil</Text>
                <Text style={styles.rowSub}>Se desligado, outros veem uma imagem padrão</Text>
              </View>
            </View>
            <Switch
              value={showProfilePhoto}
              onValueChange={(v) => { setShowProfilePhoto(v); persist({ show_profile_photo: v }); }}
              trackColor={{ false: '#DFE4EA', true: '#FF4757' }} thumbColor="#FFF"
            />
          </View>
        </View>

        {/* SEGURANÇA */}
        <Text style={styles.sectionTitle}>Segurança</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.actionRow} onPress={openPwModal} activeOpacity={0.7}>
            <View style={styles.rowLabel}>
              <Ionicons name="key-outline" size={20} color="#FF4757" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Alterar senha</Text>
                <Text style={styles.rowSub}>Atualize sua senha de acesso</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#C7CDD4" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.actionRow} onPress={handleSignOutEverywhere} activeOpacity={0.7} disabled={busy}>
            <View style={styles.rowLabel}>
              <Ionicons name="phone-portrait-outline" size={20} color="#FF4757" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Sair de todos os dispositivos</Text>
                <Text style={styles.rowSub}>Encerra a sessão em todos os aparelhos</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#C7CDD4" />
          </TouchableOpacity>
        </View>

        {/* CONTA E DADOS */}
        <Text style={styles.sectionTitle}>Conta e dados</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.actionRow} onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => toast.error('Não foi possível abrir o link.'))} activeOpacity={0.7}>
            <View style={styles.rowLabel}>
              <Ionicons name="document-text-outline" size={20} color="#FF4757" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Política de Privacidade</Text>
                <Text style={styles.rowSub}>Como tratamos seus dados (LGPD)</Text>
              </View>
            </View>
            <Ionicons name="open-outline" size={18} color="#C7CDD4" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionRow} onPress={() => Linking.openURL(TERMS_URL).catch(() => toast.error('Não foi possível abrir o link.'))} activeOpacity={0.7}>
            <View style={styles.rowLabel}>
              <Ionicons name="reader-outline" size={20} color="#FF4757" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Termos de Uso</Text>
                <Text style={styles.rowSub}>Regras de uso do aplicativo</Text>
              </View>
            </View>
            <Ionicons name="open-outline" size={18} color="#C7CDD4" />
          </TouchableOpacity>
        </View>

        {/* USUÁRIOS BLOQUEADOS */}
        <Text style={styles.sectionTitle}>Usuários bloqueados</Text>
        <View style={styles.card}>
          {loadingBlocks ? (
            <View style={{ padding: 18 }}><ActivityIndicator color="#FF4757" /></View>
          ) : blocked.length === 0 ? (
            <View style={styles.blockEmpty}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#A4B0BE" />
              <Text style={styles.blockEmptyText}>
                Você não bloqueou ninguém. Para bloquear alguém, abra a conversa e toque no perfil da pessoa.
              </Text>
            </View>
          ) : (
            blocked.map((b) => (
              <View key={b.blocked_id} style={styles.actionRow}>
                <View style={styles.rowLabel}>
                  <Ionicons name="ban-outline" size={20} color="#747D8C" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{b.blocked?.full_name ?? 'Usuário'}</Text>
                    <Text style={styles.rowSub}>Não pode te enviar mensagens</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.unblockBtn}
                  activeOpacity={0.85}
                  onPress={async () => {
                    try {
                      await unblockUser(b.blocked_id);
                      setBlocked((prev) => prev.filter((x) => x.blocked_id !== b.blocked_id));
                      toast.success('Usuário desbloqueado.');
                    } catch (e: any) {
                      toast.error(e?.message ?? 'Não foi possível desbloquear.');
                    }
                  }}
                >
                  <Text style={styles.unblockText}>Desbloquear</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* ZONA DE RISCO */}
        <Text style={[styles.sectionTitle, { color: '#FF4757' }]}>Zona de risco</Text>
        <TouchableOpacity style={styles.dangerBtn} onPress={handleDeleteAccount} activeOpacity={0.85} disabled={busy}>
          <Ionicons name="trash-outline" size={20} color="#FF4757" />
          <View style={{ flex: 1 }}>
            <Text style={styles.dangerTitle}>Excluir minha conta</Text>
            <Text style={styles.dangerSub}>Apaga permanentemente seus dados</Text>
          </View>
          {busy ? <ActivityIndicator color="#FF4757" /> : <Ionicons name="chevron-forward" size={20} color="#FF4757" />}
        </TouchableOpacity>

        {saving && (
          <View style={{ marginTop: 18, alignItems: 'center' }}>
            <ActivityIndicator color="#FF4757" />
            <Text style={{ color: '#747D8C', marginTop: 6, fontSize: 12 }}>Salvando…</Text>
          </View>
        )}
      </ScrollView>

      {/* Modal: Alterar senha */}
      <Modal visible={pwModal} transparent animationType="fade" onRequestClose={() => setPwModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Alterar senha</Text>
              <TouchableOpacity onPress={() => setPwModal(false)}>
                <Ionicons name="close" size={24} color="#2F3542" />
              </TouchableOpacity>
            </View>

            <View style={styles.pwInput}>
              <Ionicons name="lock-closed-outline" size={18} color="#A4B0BE" />
              <TextInput
                style={styles.pwField} placeholder="Senha atual" placeholderTextColor="#A4B0BE"
                secureTextEntry autoCapitalize="none" value={currentPw} onChangeText={setCurrentPw}
                returnKeyType="next" onSubmitEditing={() => newPwRef.current?.focus()}
              />
            </View>
            <View style={styles.pwInput}>
              <Ionicons name="key-outline" size={18} color="#A4B0BE" />
              <TextInput
                ref={newPwRef} style={styles.pwField} placeholder="Nova senha (mín. 6)" placeholderTextColor="#A4B0BE"
                secureTextEntry autoCapitalize="none" value={newPw} onChangeText={setNewPw}
                returnKeyType="next" onSubmitEditing={() => confirmPwRef.current?.focus()}
              />
            </View>
            <View style={styles.pwInput}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#A4B0BE" />
              <TextInput
                ref={confirmPwRef} style={styles.pwField} placeholder="Confirmar nova senha" placeholderTextColor="#A4B0BE"
                secureTextEntry autoCapitalize="none" value={confirmPw} onChangeText={setConfirmPw}
                returnKeyType="go" onSubmitEditing={handleChangePassword}
              />
            </View>

            <TouchableOpacity style={styles.modalConfirm} onPress={handleChangePassword} disabled={pwSaving} activeOpacity={0.9}>
              {pwSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Salvar nova senha</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F2F6' },
  header: {
    paddingTop: 54, paddingHorizontal: 16, paddingBottom: 18,
    flexDirection: 'row', alignItems: 'center',
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },

  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#747D8C', marginTop: 22, marginBottom: 10, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15 },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 15, color: '#2F3542', fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#A4B0BE', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#F1F2F6' },

  // Usuários bloqueados
  blockEmpty: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 16 },
  blockEmptyText: { flex: 1, fontSize: 13, color: '#A4B0BE', fontWeight: '600', lineHeight: 18 },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#FFF0F1',
  },
  unblockText: { fontSize: 13, fontWeight: '800', color: '#FF4757' },

  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF0F1', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#FFD6DB',
  },
  dangerTitle: { fontSize: 15, fontWeight: '800', color: '#FF4757' },
  dangerSub: { fontSize: 12, color: '#E2818B', marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 22, padding: 22 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 19, fontWeight: '900', color: '#2F3542' },
  pwInput: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F7F8FA', borderRadius: 14, borderWidth: 1, borderColor: '#EAEDF0',
    paddingHorizontal: 14, height: 52, marginBottom: 12,
  },
  pwField: { flex: 1, fontSize: 15, color: '#2F3542', fontWeight: '500' },
  modalConfirm: {
    height: 52, borderRadius: 14, backgroundColor: '#FF4757', justifyContent: 'center', alignItems: 'center', marginTop: 4,
  },
  modalConfirmText: { color: '#FFF', fontSize: 15.5, fontWeight: '800' },
});
