import React from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RegionAlertButton } from './RegionAlertButton';
import { SharePetButton } from './SharePetButton';

// Card de alerta do usuário. Usado no Perfil (alertas ativos, com ações) e na
// tela de Histórico de alertas (finalizados, só leitura + toque pra ficha).

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  ativo:       { label: 'Ativo',       color: '#FF4757', bg: '#FFF0F1' },
  pausado:     { label: 'Pausado',     color: '#FFA502', bg: '#FFF6E5' },
  encontrado:  { label: 'Encontrado',  color: '#2ED573', bg: '#E8F8F5' },
  cancelado:   { label: 'Cancelado',   color: '#747D8C', bg: '#F1F2F6' },
  doado:       { label: 'Doado',       color: '#3B82F6', bg: '#EFF6FF' },
};

// Faixa de tipo no topo do card (perdido / visto / resgatado / doação).
const TYPE_BADGE: Record<string, { label: string; verb: string; color: string; bg: string; icon: any }> = {
  lost:     { label: 'PET PERDIDO',   verb: 'Perdido',   color: '#FF4757', bg: '#FFF0F1', icon: 'megaphone' },
  sighted:  { label: 'PET VISTO',     verb: 'Visto',     color: '#F79F1F', bg: '#FFF6E5', icon: 'eye' },
  rescued:  { label: 'PET RESGATADO', verb: 'Resgatado', color: '#20BF6B', bg: '#E8F8F5', icon: 'alert-circle' },
  donation: { label: 'PET DOANDO',    verb: 'Em doação', color: '#3B82F6', bg: '#EFF6FF', icon: 'gift' },
};

// Tempo decorrido compacto: "hoje", "há 1 dia", "há 5 dias", "há 2 meses".
export function elapsedShort(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) {
    const h = Math.floor(ms / 3600000);
    if (h <= 0) return 'há pouco';
    return `há ${h} h`;
  }
  if (days === 1) return 'há 1 dia';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}

export function PetCard({ pet, onConfirm, onFindOwner, onCancel, onEdit, onPress, onDonate, onConcludeDonation }: { pet: any; onConfirm?: () => void; onFindOwner?: () => void; onCancel?: () => void; onEdit?: () => void; onPress?: () => void; onDonate?: () => void; onConcludeDonation?: () => void }) {
  const status = STATUS_MAP[pet.status] ?? STATUS_MAP.ativo;
  const tmeta = TYPE_BADGE[pet.type ?? 'lost'] ?? TYPE_BADGE.lost;
  const photo = pet.main_photo_url ?? pet.photo_url;
  const sizeText = pet.size === 'pequeno' ? 'Pequeno' : pet.size === 'medio' ? 'Médio' : pet.size === 'grande' ? 'Grande' : null;
  const sexText = pet.sex === 'macho' ? 'Macho' : pet.sex === 'femea' ? 'Fêmea' : null;
  const ageText = pet.age_group === 'filhote' ? 'Filhote' : pet.age_group === 'adulto' ? 'Adulto' : pet.age_group === 'idoso' ? 'Idoso' : null;
  const subtitle = [pet.breed, pet.color, sizeText, sexText, ageText].filter(Boolean).join(' · ');
  const isActive = pet.status === 'ativo';
  const elapsed = elapsedShort(pet.lost_date);
  const timeLabel = elapsed ? `${tmeta.verb} ${elapsed}` : null;
  const petType = pet.type ?? 'lost';

  const CardWrap: any = onPress ? TouchableOpacity : View;

  return (
    <CardWrap style={[styles.petCardV2, { borderLeftWidth: 4, borderLeftColor: tmeta.color }]} {...(onPress ? { onPress, activeOpacity: 0.85 } : {})}>
      {/* Data de cadastro no topo */}
      {!!pet.created_at && (
        <View style={styles.cardDateRow}>
          <Ionicons name="calendar-outline" size={12} color="#A4B0BE" />
          <Text style={styles.cardDateText}>
            Cadastrado em {new Date(pet.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}

      {/* Faixa do topo: tipo (esquerda) + status (direita) */}
      <View style={styles.cardRibbon}>
        <View style={[styles.typePill, { backgroundColor: tmeta.bg }]}>
          <Ionicons name={tmeta.icon} size={12} color={tmeta.color} />
          <Text style={[styles.typePillText, { color: tmeta.color }]}>{tmeta.label}</Text>
        </View>
        <View style={[styles.statusDotBadge, { backgroundColor: status.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusDotText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.petCardTop}>
        <Image source={{ uri: photo }} style={styles.petCardImg} />

        <View style={styles.petCardInfo}>
          <Text style={styles.petCardName} numberOfLines={1}>{pet.name}</Text>

          {subtitle ? (
            <Text style={styles.petCardSubtitle} numberOfLines={2}>{subtitle}</Text>
          ) : null}

          <View style={styles.metaList}>
            {timeLabel && (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={14} color="#747D8C" />
                <Text style={styles.metaText}>{timeLabel}</Text>
              </View>
            )}
            {pet.reward?.amount > 0 && (
              <View style={styles.metaItem}>
                <Ionicons name="gift" size={14} color="#FFA502" />
                <Text style={[styles.metaText, { color: '#FFA502', fontWeight: '800' }]}>
                  R$ {Number(pet.reward.amount).toFixed(2).replace('.', ',')}
                </Text>
              </View>
            )}
            {/* Info específica do tipo */}
            {petType === 'sighted' && (
              <View style={styles.metaItem}>
                <Ionicons name={pet.allow_contact === false ? 'chatbubble-ellipses-outline' : 'chatbubbles-outline'} size={14} color={pet.allow_contact === false ? '#A4B0BE' : '#3498DB'} />
                <Text style={[styles.metaText, pet.allow_contact === false ? { color: '#A4B0BE' } : { color: '#3498DB' }]}>
                  {pet.allow_contact === false ? 'Contato desativado' : 'Contato permitido'}
                </Text>
              </View>
            )}
            {petType === 'rescued' && (
              <View style={styles.metaItem}>
                <Ionicons name={pet.is_with_finder ? 'home' : 'home-outline'} size={14} color="#20BF6B" />
                <Text style={[styles.metaText, { color: '#20BF6B' }]}>
                  {pet.is_with_finder ? 'Está com você' : 'Não está com você'}
                </Text>
              </View>
            )}
            {petType === 'donation' && (
              <View style={styles.metaItem}>
                <Ionicons name="gift" size={14} color="#3B82F6" />
                <Text style={[styles.metaText, { color: '#3B82F6' }]}>Disponível para adoção</Text>
              </View>
            )}
            {pet.open_chats_count > 0 && (
              <View style={styles.metaItem}>
                <Ionicons name="chatbubbles" size={14} color="#3498DB" />
                <Text style={[styles.metaText, { color: '#3498DB', fontWeight: '700' }]}>
                  {pet.open_chats_count} {pet.open_chats_count === 1 ? 'conversa ativa' : 'conversas ativas'}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {isActive && (
        <>
          <View style={styles.cardDivider} />
          <View style={styles.cardActions}>
            {/* Linha 1: ações secundárias — editar · alertar região (perdido) · compartilhar */}
            <View style={styles.cardActionsIcons}>
              {onEdit && (
                <TouchableOpacity style={styles.actionIconBtn} onPress={onEdit}>
                  <Ionicons name="create-outline" size={20} color="#FF4757" />
                </TouchableOpacity>
              )}
              {petType === 'lost' && <RegionAlertButton petId={pet.id} compact style={styles.actionIconBtn} />}
              <SharePetButton pet={pet} label="" iconSize={20} style={styles.actionIconBtn} />
            </View>
            {/* Linha 2: ação principal (larga) + excluir */}
            <View style={styles.cardActionsMain}>
              {onConfirm && (
                <TouchableOpacity style={styles.actionPrimary} onPress={onConfirm}>
                  <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                  <Text style={styles.actionPrimaryText}>Confirmar resgate</Text>
                </TouchableOpacity>
              )}
              {onFindOwner && (
                <TouchableOpacity style={styles.actionPrimary} onPress={onFindOwner}>
                  <Ionicons name="search" size={18} color="#FFF" />
                  <Text style={styles.actionPrimaryText}>Procurar tutor</Text>
                </TouchableOpacity>
              )}
              {onDonate && (
                <TouchableOpacity style={[styles.actionPrimary, { backgroundColor: '#3B82F6', shadowColor: '#3B82F6' }]} onPress={onDonate}>
                  <Ionicons name="gift" size={18} color="#FFF" />
                  <Text style={styles.actionPrimaryText}>Doar este pet</Text>
                </TouchableOpacity>
              )}
              {onConcludeDonation && (
                <TouchableOpacity style={[styles.actionPrimary, { backgroundColor: '#3B82F6', shadowColor: '#3B82F6' }]} onPress={onConcludeDonation}>
                  <Ionicons name="checkmark-done" size={18} color="#FFF" />
                  <Text style={styles.actionPrimaryText}>Doado em outro local</Text>
                </TouchableOpacity>
              )}
              {onCancel && (
                <TouchableOpacity style={[styles.actionIconBtn, styles.actionIconBtnDanger]} onPress={onCancel}>
                  <Ionicons name="trash-outline" size={18} color="#FF4757" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}

      {/* Pet finalizado — dica de toque pra abrir a ficha */}
      {!isActive && onPress && (
        <>
          <View style={styles.cardDivider} />
          <View style={styles.caseHint}>
            <Ionicons name="document-text-outline" size={15} color="#FF4757" />
            <Text style={styles.caseHintText}>Ver ficha completa do caso</Text>
            <Ionicons name="chevron-forward" size={16} color="#FF4757" />
          </View>
        </>
      )}
    </CardWrap>
  );
}

const styles = StyleSheet.create({
  // PetCard v2 — layout aprimorado
  petCardV2: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardDateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F2F4F6' },
  cardDateText: { fontSize: 11.5, color: '#A4B0BE', fontWeight: '700' },
  cardRibbon: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  typePillText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  petCardTop: { flexDirection: 'row', gap: 14 },
  petCardImg: { width: 84, height: 84, borderRadius: 16, backgroundColor: '#DFE4EA' },
  petCardInfo: { flex: 1, justifyContent: 'flex-start' },
  petCardName: { fontSize: 18, fontWeight: '900', color: '#2F3542', letterSpacing: -0.3 },
  statusDotBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotText: { fontSize: 11, fontWeight: '800' },
  petCardSubtitle: { fontSize: 13, color: '#747D8C', fontWeight: '600', marginTop: 4 },
  metaList: { marginTop: 10, gap: 5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: '#57606F', fontWeight: '600' },

  cardDivider: { height: 1, backgroundColor: '#F1F2F6', marginVertical: 14 },
  cardActions: { gap: 8 },
  cardActionsIcons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  cardActionsMain: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#2ED573',
    shadowColor: '#2ED573',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  actionPrimaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  actionIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFF0F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionIconBtnDanger: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#FFE5E9',
  },
  caseHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  caseHintText: {
    color: '#FF4757',
    fontWeight: '800',
    fontSize: 13,
  },
});
