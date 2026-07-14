import React, { useCallback, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, SectionList, RefreshControl,
  ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { getTransactions, getUserProfile, requestWithdraw, Transaction } from '../../services/api';
import { toast } from '../../components/Feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const PET_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ativo:      { label: 'Em busca',  color: '#FF4757', bg: '#FFF0F1' },
  encontrado: { label: 'Encontrado', color: '#2ED573', bg: '#E8F8F5' },
  cancelado:  { label: 'Cancelado', color: '#747D8C', bg: '#F1F2F6' },
};

const TX_META: Record<Transaction['type'], { label: string; icon: any; color: string }> = {
  deposit:         { label: 'Depósito',           icon: 'arrow-down-circle', color: '#2ED573' },
  escrow_hold:     { label: 'Recompensa ofertada', icon: 'lock-closed',       color: '#FFA502' },
  escrow_release:  { label: 'Recompensa paga',         icon: 'checkmark-circle', color: '#2ED573' },
  reward_received: { label: 'Recompensa recebida',icon: 'gift',              color: '#2ED573' },
  withdraw:        { label: 'Saque PIX',          icon: 'cash-outline',      color: '#FF4757' },
  refund:          { label: 'Reembolso',          icon: 'return-up-back',    color: '#3498DB' },
  fee:             { label: 'Taxa do app',        icon: 'pricetag-outline',  color: '#747D8C' },
};

export default function WalletScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const insets = useSafeAreaInsets();
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [p, t] = await Promise.all([getUserProfile(user.id), getTransactions(user.id)]);
      setProfile(p);
      setTxs(t);
    } catch (e) {
      console.warn('Erro ao carregar carteira', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const balance = Number(profile?.wallet_balance ?? 0);

  const totalReceived = txs
    .filter((t) => t.type === 'reward_received' && t.status === 'completed')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  // reward_ids já encerrados (liberados ou reembolsados)
  const closedRewardIds = new Set(
    txs
      .filter((t) => t.type === 'escrow_release' || t.type === 'refund')
      .map((t) => t.reward_id)
      .filter(Boolean)
  );

  // Saldo reservado: escrow_holds cujo reward ainda está ativo
  // escrow_hold é gravado com status 'pending', por isso não filtramos por status
  // Saldo reservado: soma da oferta (amount - fee_amount) dos holds ainda ativos
  const escrowActive = txs
    .filter(
      (t) =>
        t.type === 'escrow_hold' &&
        t.status !== 'failed' &&
        (!t.reward_id || !closedRewardIds.has(t.reward_id))
    )
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)) - Number(t.fee_amount), 0);

  // Taxa total paga: fee_amount gravado em cada escrow_hold + fee explícito de cancelamento
  const totalFeesPaid = txs
    .filter((t) => t.type === 'escrow_hold' && t.status !== 'failed')
    .reduce((sum, t) => sum + Number(t.fee_amount), 0)
    +
    txs
    .filter((t) => t.type === 'fee' && t.status === 'completed')
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  const handleWithdraw = async () => {
    const value = Number(withdrawAmount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      return toast.warning('Informe um valor válido.');
    }
    if (value > balance) {
      return toast.warning('Valor maior que o saldo disponível.');
    }
    if (!profile?.pix_key) {
      return toast.warning('Cadastre uma chave PIX no perfil antes de sacar.');
    }
    try {
      setIsWithdrawing(true);
      await requestWithdraw(user!.id, value);
      setShowWithdraw(false);
      setWithdrawAmount('');
      await load();
      toast.success('O processamento leva até 1 dia útil.', 'Saque solicitado!');
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao solicitar saque.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  // ─── Extrato principal: exclui transações de taxa ───────────────────────────
  const mainTxs = txs.filter((t) => t.type !== 'fee');

  // ─── Extrato de taxas: taxa implícita de cada escrow_hold + fee explícito ──
  type FeeRow = { id: string; description: string; amount: number; created_at: string; pet_id?: string };
  const feeRows: FeeRow[] = [
    ...txs
      .filter((t) => t.type === 'escrow_hold' && Number(t.fee_amount) > 0)
      .map((t) => {
        const petName = t.pets?.name ?? 'Pet';
        const isInc   = (t.description ?? '').startsWith('Aumento');
        return {
          id:          `fee_${t.id}`,
          description: `${isInc ? 'Taxa do aumento' : 'Taxa da oferta'} - Caso ${petName}`,
          amount:      Number(t.fee_amount),
          created_at:  t.created_at,
          pet_id:      t.pet_id,
        };
      }),
    ...txs
      .filter((t) => t.type === 'fee')
      .map((t) => ({
        id:          t.id,
        description: t.description ?? 'Taxa do app',
        amount:      Math.abs(Number(t.amount)),
        created_at:  t.created_at,
        pet_id:      t.pet_id,
      })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const totalFeesDisplay = feeRows.reduce((s, r) => s + r.amount, 0);

  // ─── Agrupamento por caso (pet_id) — apenas transações do extrato principal ─
  type TxSection = { petId: string | null; petName: string; petPhoto?: string; petStatus?: string; data: Transaction[] };
  const sections: TxSection[] = (() => {
    const map = new Map<string, TxSection>();
    for (const t of mainTxs) {
      const key = t.pet_id ?? '__geral__';
      if (!map.has(key)) {
        const pet = t.pets;
        map.set(key, {
          petId:     t.pet_id ?? null,
          petName:   pet?.name ?? (t.pet_id ? 'Pet' : 'Geral'),
          petPhoto:  pet?.main_photo_url,
          petStatus: pet?.status,
          data:      [],
        });
      } else if (!map.get(key)!.petStatus && t.pets?.status) {
        // garante que o status é preenchido mesmo que o primeiro tx não tenha
        map.get(key)!.petStatus = t.pets.status;
      }
      map.get(key)!.data.push(t);
    }
    return [...map.values()].sort(
      (a, b) =>
        new Date(b.data[0].created_at).getTime() - new Date(a.data[0].created_at).getTime()
    );
  })();

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF4757" />
      </View>
    );
  }

  const renderTxItem = ({ item, section }: { item: Transaction; section: TxSection }) => {
    const isTappable = !!item.pet_id;
    const RowWrapper = isTappable ? TouchableOpacity : View;

    const isEscrow   = item.type === 'escrow_hold';
    const isIncrease = isEscrow && (item.description ?? '').startsWith('Aumento');

    // escrow_hold mostra só o valor da oferta (sem taxa) e como positivo (reservado)
    const feeAmount   = Number(item.fee_amount ?? 0);
    const offerAmount = isEscrow ? Math.abs(Number(item.amount)) - feeAmount : 0;

    // Para escrow_hold de aumento, visual diferente do inicial
    const meta = isIncrease
      ? { label: 'Aumento de recompensa', icon: 'add-circle' as const, color: '#E67E22' }
      : TX_META[item.type];

    // Valor e cor exibidos
    const isCredit      = isEscrow ? true : Number(item.amount) > 0;
    const displayAmount = isEscrow ? offerAmount : Math.abs(Number(item.amount));
    const amountColor   = isEscrow ? meta.color : (isCredit ? '#2ED573' : '#FF4757');
    const amountPrefix  = isEscrow ? (isIncrease ? '+' : '') : (isCredit ? '+' : '−');

    // Descrição em texto apenas para não-escrow
    const showDesc = !!item.description && !isEscrow;

    return (
      <RowWrapper
        style={styles.txRow}
        {...(isTappable ? { onPress: () => router.push(`/pet/case/${item.pet_id}` as any), activeOpacity: 0.75 } : {})}
      >
        <View style={[styles.txIcon, { backgroundColor: meta.color + '20' }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.txTitle}>{meta.label}</Text>
          {showDesc && (
            <Text style={styles.txDescription} numberOfLines={2}>{item.description}</Text>
          )}
          <Text style={styles.txDate}>{format(new Date(item.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.txAmount, { color: amountColor }]}>
            {amountPrefix}R$ {displayAmount.toFixed(2).replace('.', ',')}
          </Text>
          {item.status !== 'completed' && (
            <Text style={[styles.txStatus, { color: item.status === 'pending' ? '#FFA502' : '#FF4757' }]}>
              {item.status === 'pending' ? 'Reservado' : 'Falhou'}
            </Text>
          )}
        </View>
      </RowWrapper>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#FF6B81', '#FF4757']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 10 }]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Carteira</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ paddingBottom: 0 }}
        ListHeaderComponent={
          <>
            <View style={{ padding: 20, gap: 12 }}>
              {/* Card principal — saldo disponível */}
              <LinearGradient
                colors={['#FF6B81', '#FF4757']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.balanceCard}
              >
                <Text style={styles.balanceLabel}>Saldo disponível</Text>
                <Text style={styles.balanceValue}>R$ {balance.toFixed(2).replace('.', ',')}</Text>
                <View style={styles.balanceFooter}>
                  <View>
                    <Text style={styles.balanceSubLabel}>Recompensas recebidas</Text>
                    <Text style={styles.balanceSubValue}>R$ {totalReceived.toFixed(2).replace('.', ',')}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.withdrawBtn, balance <= 0 && { opacity: 0.5 }]}
                    onPress={() => setShowWithdraw(true)}
                    disabled={balance <= 0}
                  >
                    <Ionicons name="cash-outline" size={18} color="#FF4757" />
                    <Text style={styles.withdrawBtnText}>Sacar via PIX</Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>

              {/* Mini-cards: escrow ativo + taxa total */}
              <View style={styles.miniCardsRow}>
                <View style={styles.miniCard}>
                  <View style={styles.miniCardIcon}>
                    <Ionicons name="lock-closed" size={18} color="#FFA502" />
                  </View>
                  <Text style={styles.miniCardLabel}>Saldo reservado</Text>
                  <Text style={styles.miniCardValue}>R$ {escrowActive.toFixed(2).replace('.', ',')}</Text>
                  <Text style={styles.miniCardSub}>Em recompensas ativas</Text>
                </View>
                <View style={[styles.miniCard, { borderLeftWidth: 1, borderLeftColor: '#F1F2F6' }]}>
                  <View style={[styles.miniCardIcon, { backgroundColor: '#F1F2F6' }]}>
                    <Ionicons name="pricetag-outline" size={18} color="#747D8C" />
                  </View>
                  <Text style={styles.miniCardLabel}>Taxa total paga</Text>
                  <Text style={[styles.miniCardValue, { color: '#747D8C' }]}>R$ {totalFeesPaid.toFixed(2).replace('.', ',')}</Text>
                  <Text style={styles.miniCardSub}>Para o app</Text>
                </View>
              </View>

              {!profile?.pix_key && (
                <TouchableOpacity style={styles.alertBox} onPress={() => router.push('/profile/edit')}>
                  <Ionicons name="alert-circle" size={20} color="#FFA502" />
                  <Text style={styles.alertText}>
                    Cadastre uma chave PIX para poder sacar recompensas.
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color="#FFA502" />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sectionTitle}>Extrato</Text>
            {txs.length === 0 && (
              <View style={styles.emptyBox}>
                <Ionicons name="receipt-outline" size={40} color="#DFE4EA" />
                <Text style={styles.emptyText}>Nenhuma movimentação ainda</Text>
              </View>
            )}
          </>
        }
        renderSectionHeader={({ section }) => {
          const statusMeta = PET_STATUS_META[section.petStatus ?? ''];
          return (
            <TouchableOpacity
              style={styles.caseHeader}
              activeOpacity={section.petId ? 0.75 : 1}
              onPress={section.petId ? () => router.push(`/pet/case/${section.petId}` as any) : undefined}
            >
              {section.petPhoto ? (
                <Image source={{ uri: section.petPhoto }} style={styles.caseHeaderAvatar} />
              ) : (
                <View style={[styles.caseHeaderAvatar, { backgroundColor: '#DFE4EA', justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="paw" size={16} color="#A4B0BE" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.caseHeaderName}>{section.petName}</Text>
                {statusMeta && (
                  <View style={[styles.caseStatusBadge, { backgroundColor: statusMeta.bg }]}>
                    <View style={[styles.caseStatusDot, { backgroundColor: statusMeta.color }]} />
                    <Text style={[styles.caseStatusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                  </View>
                )}
              </View>
              {section.petId && (
                <View style={styles.caseHeaderChip}>
                  <Text style={styles.caseHeaderChipText}>Ver caso</Text>
                  <Ionicons name="arrow-forward" size={10} color="#FF4757" />
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        renderItem={renderTxItem}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        SectionSeparatorComponent={() => <View style={{ height: 4 }} />}
        ListFooterComponent={
          <View style={{ paddingBottom: 100 }}>
            {/* ── Extrato de Taxas ── */}
            <View style={styles.feeHeader}>
              <View style={styles.feeHeaderLeft}>
                <Ionicons name="pricetag" size={16} color="#747D8C" />
                <Text style={styles.feeSectionTitle}>Taxas do app</Text>
              </View>
              <Text style={styles.feeTotalText}>Total: R$ {totalFeesDisplay.toFixed(2).replace('.', ',')}</Text>
            </View>

            {feeRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>Nenhuma taxa ainda</Text>
              </View>
            ) : (
              feeRows.map((fee, idx) => (
                <View key={fee.id}>
                  <View style={styles.txRow}>
                    <View style={[styles.txIcon, { backgroundColor: '#747D8C18' }]}>
                      <Ionicons name="pricetag-outline" size={20} color="#747D8C" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txTitle}>Taxa do app</Text>
                      <Text style={styles.txDescription} numberOfLines={1}>{fee.description}</Text>
                      <Text style={styles.txDate}>{format(new Date(fee.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</Text>
                    </View>
                    <Text style={[styles.txAmount, { color: '#747D8C' }]}>
                      R$ {fee.amount.toFixed(2).replace('.', ',')}
                    </Text>
                  </View>
                  {idx < feeRows.length - 1 && <View style={{ height: 8 }} />}
                </View>
              ))
            )}
          </View>
        }
      />

      {/* Modal de saque */}
      <Modal visible={showWithdraw} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Sacar via PIX</Text>
            <Text style={styles.modalSub}>
              Disponível: <Text style={{ fontWeight: '800', color: '#2ED573' }}>R$ {balance.toFixed(2).replace('.', ',')}</Text>
            </Text>
            <Text style={styles.modalLabel}>Chave PIX cadastrada</Text>
            <Text style={styles.modalPix}>{profile?.pix_key ?? 'Nenhuma'}</Text>

            <Text style={styles.modalLabel}>Valor</Text>
            <View style={styles.amountWrapper}>
              <Text style={styles.currencySymbol}>R$</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="0,00"
                placeholderTextColor="#A4B0BE"
                keyboardType="numeric"
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {[25, 50, 100, balance].map((v, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.quickPill}
                  onPress={() => setWithdrawAmount(String(v.toFixed(2)).replace('.', ','))}
                >
                  <Text style={styles.quickPillText}>
                    {i === 3 ? 'Tudo' : `R$ ${v}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.confirmBtn} onPress={handleWithdraw} disabled={isWithdrawing}>
              <Text style={styles.confirmBtnText}>{isWithdrawing ? 'Processando...' : 'Confirmar saque'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowWithdraw(false)} style={{ alignItems: 'center', paddingTop: 10 }}>
              <Text style={{ color: '#747D8C', fontWeight: '600' }}>Cancelar</Text>
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
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8, zIndex: 10,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },

  balanceCard: { padding: 24, borderRadius: 24, shadowColor: '#FF4757', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 8 },
  balanceLabel: { color: '#FFE5E9', fontSize: 14, fontWeight: '600' },
  balanceValue: { color: '#FFF', fontSize: 42, fontWeight: '900', marginTop: 6, letterSpacing: -1 },
  balanceFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 },
  balanceSubLabel: { color: '#FFE5E9', fontSize: 12 },
  balanceSubValue: { color: '#FFF', fontSize: 16, fontWeight: '800', marginTop: 2 },
  withdrawBtn: {
    backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
  },
  withdrawBtnText: { color: '#FF4757', fontWeight: '800', fontSize: 14 },

  alertBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
    backgroundColor: '#FFF6E5', padding: 14, borderRadius: 14,
  },
  alertText: { flex: 1, color: '#FFA502', fontWeight: '700', fontSize: 13 },

  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase', marginLeft: 24, marginBottom: 10, marginTop: 4 },
  emptyBox: { alignItems: 'center', padding: 40, gap: 10 },
  emptyText: { color: '#747D8C', fontSize: 14 },

  txRow: {
    backgroundColor: '#FFF', marginHorizontal: 20, padding: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  txIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  txTitle: { fontSize: 15, fontWeight: '800', color: '#2F3542' },
  txDescription: { fontSize: 12, color: '#747D8C', marginTop: 2 },
  txDate: { fontSize: 11, color: '#A4B0BE', marginTop: 4 },
  txAmount: { fontSize: 15, fontWeight: '900' },
  txStatus: { fontSize: 10, fontWeight: '700', marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 24, padding: 24 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#2F3542', marginBottom: 4 },
  modalSub: { fontSize: 14, color: '#747D8C', marginBottom: 18 },
  modalLabel: { fontSize: 12, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  modalPix: { fontSize: 14, color: '#2F3542', fontWeight: '700', backgroundColor: '#F1F2F6', padding: 12, borderRadius: 12 },
  amountWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F2F6', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  currencySymbol: { fontSize: 24, fontWeight: '900', color: '#2ED573', marginRight: 10 },
  amountInput: { flex: 1, fontSize: 26, fontWeight: '900', color: '#2F3542' },
  quickPill: { flex: 1, backgroundColor: '#F1F2F6', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  quickPillText: { fontSize: 13, fontWeight: '700', color: '#2F3542' },
  confirmBtn: { backgroundColor: '#FF4757', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: '900' },

  // Mini-cards de resumo
  miniCardsRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  miniCard: {
    flex: 1,
    padding: 16,
    gap: 4,
  },
  miniCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF6E5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  miniCardLabel: { fontSize: 12, color: '#747D8C', fontWeight: '700' },
  miniCardValue: { fontSize: 20, fontWeight: '900', color: '#FFA502' },
  miniCardSub: { fontSize: 11, color: '#A4B0BE', fontWeight: '500' },

  // Cabeçalho do extrato de taxas
  feeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E8ECEF',
  },
  feeHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  feeSectionTitle: { fontSize: 13, fontWeight: '800', color: '#747D8C', textTransform: 'uppercase' },
  feeTotalText: { fontSize: 13, fontWeight: '700', color: '#747D8C' },

  // Cabeçalho de seção (por caso/pet)
  caseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  caseHeaderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#DFE4EA',
  },
  caseHeaderName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2F3542',
  },
  caseStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
  },
  caseStatusDot: { width: 6, height: 6, borderRadius: 3 },
  caseStatusText: { fontSize: 11, fontWeight: '700' },
  caseHeaderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF0F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  caseHeaderChipText: { fontSize: 11, fontWeight: '800', color: '#FF4757' },

});
