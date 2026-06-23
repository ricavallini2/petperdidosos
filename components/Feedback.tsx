// Sistema de feedback padronizado do app.
//
// - toast.success / .error / .info / .warning  -> banner que desce do topo e
//   some sozinho (substitui os Alert simples de uma mensagem).
// - showConfirm({...})  -> card central customizado com botões Cancelar/Confirmar
//   (substitui os Alert.alert com botões).
//
// API imperativa (singleton) para poder ser chamada de qualquer lugar, igual ao
// Alert.alert. Basta montar <FeedbackHost /> uma vez na raiz (app/_layout.tsx).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Modal, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type ToastType = 'success' | 'error' | 'info' | 'warning';

type ToastOptions = {
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  icon?: IconName;
  onConfirm?: () => void;
  onCancel?: () => void;
};

export type ActionSheetOption = {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  primary?: boolean;
  onPress?: () => void;
};

type ActionSheetOptions = {
  title: string;
  message?: string;
  icon?: IconName;
  options: ActionSheetOption[];
  cancelText?: string;
  onCancel?: () => void;
};

// ---- API imperativa (singleton) ---------------------------------------------
let _showToast: ((o: ToastOptions) => void) | null = null;
let _showConfirm: ((o: ConfirmOptions) => void) | null = null;
let _showActionSheet: ((o: ActionSheetOptions) => void) | null = null;

export const toast = {
  success: (message: string, title?: string) => _showToast?.({ type: 'success', message, title }),
  error:   (message: string, title?: string) => _showToast?.({ type: 'error',   message, title }),
  info:    (message: string, title?: string) => _showToast?.({ type: 'info',    message, title }),
  warning: (message: string, title?: string) => _showToast?.({ type: 'warning', message, title }),
  show:    (o: ToastOptions) => _showToast?.(o),
};

/** Confirmação com botões. Use onConfirm/onCancel para as ações. */
export const showConfirm = (o: ConfirmOptions) => _showConfirm?.(o);

/** Menu de opções (action sheet) com o mesmo visual do card de confirmação. */
export const showActionSheet = (o: ActionSheetOptions) => _showActionSheet?.(o);

// ---- Meta visual por tipo ---------------------------------------------------
const META: Record<ToastType, { icon: IconName; color: string; bg: string }> = {
  success: { icon: 'checkmark-circle',  color: '#2ED573', bg: '#EAFBF1' },
  error:   { icon: 'alert-circle',      color: '#FF4757', bg: '#FFECEE' },
  warning: { icon: 'warning',           color: '#FFA502', bg: '#FFF6E5' },
  info:    { icon: 'information-circle', color: '#3498DB', bg: '#EAF4FC' },
};

// =============================================================================
export function FeedbackHost() {
  const insets = useSafeAreaInsets();

  // ---- Toast -----------------------------------------------------------------
  const [toastData, setToastData] = useState<ToastOptions | null>(null);
  const toastY = useRef(new Animated.Value(-220)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    Animated.parallel([
      Animated.timing(toastY, { toValue: -220, duration: 220, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToastData(null));
  }, [toastY, toastOpacity]);

  const showToast = useCallback((o: ToastOptions) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToastData(o);
    toastY.setValue(-220);
    toastOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(toastY, { toValue: 0, useNativeDriver: true, tension: 70, friction: 11 }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    const ms = o.duration ?? (o.type === 'error' ? 3600 : 2700);
    hideTimer.current = setTimeout(hideToast, ms);
  }, [toastY, toastOpacity, hideToast]);

  // ---- Confirm ---------------------------------------------------------------
  const [confirmData, setConfirmData] = useState<ConfirmOptions | null>(null);

  // ---- Action sheet ----------------------------------------------------------
  const [sheetData, setSheetData] = useState<ActionSheetOptions | null>(null);

  // Registra a API imperativa enquanto o host estiver montado
  useEffect(() => {
    _showToast = showToast;
    _showConfirm = (o) => setConfirmData(o);
    _showActionSheet = (o) => setSheetData(o);
    return () => { _showToast = null; _showConfirm = null; _showActionSheet = null; };
  }, [showToast]);

  // Ação a rodar DEPOIS que o Modal nativo fechar de fato. No iOS, navegar
  // (router.push) enquanto o Modal ainda anima o dismiss deixa o container do
  // Modal órfão capturando todos os toques (tela "travada", só fechar o app).
  // Por isso, no iOS a ação roda no onDismiss do Modal (com fallback por timeout);
  // no Android, que fecha o Modal de forma síncrona, mantemos o atual (60ms).
  const pendingRun = useRef<(() => void) | null>(null);
  const runPending = useCallback(() => {
    const fn = pendingRun.current;
    pendingRun.current = null;
    // Roda no PRÓXIMO tick: tira a ação (navegação OU reabrir outro showConfirm) de
    // dentro do ciclo de dismiss do Modal nativo — evita reapresentar/navegar durante
    // o dismiss (a mesma classe do freeze), inclusive no caso de confirm aninhado.
    if (fn) setTimeout(fn, 0);
  }, []);

  const closeConfirm = (run?: () => void) => {
    if (Platform.OS === 'ios') {
      pendingRun.current = run ?? null;
      setConfirmData(null);
      if (run) setTimeout(runPending, 450); // fallback caso onDismiss não dispare
    } else {
      setConfirmData(null);
      if (run) setTimeout(run, 60);
    }
  };

  const closeSheet = (run?: () => void) => {
    if (Platform.OS === 'ios') {
      pendingRun.current = run ?? null;
      setSheetData(null);
      if (run) setTimeout(runPending, 450);
    } else {
      setSheetData(null);
      if (run) setTimeout(run, 60);
    }
  };

  const meta = toastData ? META[toastData.type] : null;
  const cMeta = confirmData ? (confirmData.destructive ? META.error : META.info) : null;

  return (
    <>
      {/* ---- Toast: overlay absoluto (SEM Modal) p/ não criar uma 2ª camada de
           apresentação nativa que ficaria órfã ao navegar e travaria o iOS.
           box-none deixa os toques passarem; só o toast em si é tocável. ---- */}
      {toastData && meta && (
        <View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, styles.toastRoot, { paddingTop: insets.top + 10 }]}
        >
          <Animated.View
            style={[
              styles.toast,
              { opacity: toastOpacity, transform: [{ translateY: toastY }] },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={hideToast}
              style={styles.toastInner}
            >
              <View style={[styles.toastIcon, { backgroundColor: meta.bg }]}>
                <Ionicons name={meta.icon} size={22} color={meta.color} />
              </View>
              <View style={styles.toastTextWrap}>
                {!!toastData.title && (
                  <Text style={styles.toastTitle} numberOfLines={1}>{toastData.title}</Text>
                )}
                <Text
                  style={[styles.toastMessage, !toastData.title && styles.toastMessageSolo]}
                  numberOfLines={4}
                >
                  {toastData.message}
                </Text>
              </View>
            </TouchableOpacity>
            <View style={[styles.toastAccent, { backgroundColor: meta.color }]} />
          </Animated.View>
        </View>
      )}

      {/* ---- Confirmação ---- */}
      <Modal
        visible={!!confirmData}
        transparent
        animationType="fade"
        statusBarTranslucent
        onDismiss={Platform.OS === 'ios' ? runPending : undefined}
        onRequestClose={() => closeConfirm(confirmData?.onCancel)}
      >
        {confirmData && cMeta && (
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmCard}>
              <View style={[styles.confirmIconWrap, { backgroundColor: cMeta.bg }]}>
                <Ionicons
                  name={confirmData.icon ?? (confirmData.destructive ? 'alert-circle' : 'help-circle')}
                  size={32}
                  color={cMeta.color}
                />
              </View>
              <Text style={styles.confirmTitle}>{confirmData.title}</Text>
              {!!confirmData.message && (
                <Text style={styles.confirmMessage}>{confirmData.message}</Text>
              )}
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnCancel]}
                  onPress={() => closeConfirm(confirmData.onCancel)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.confirmBtnCancelText}>
                    {confirmData.cancelText ?? 'Cancelar'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnConfirm]}
                  onPress={() => closeConfirm(confirmData.onConfirm)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.confirmBtnConfirmText}>
                    {confirmData.confirmText ?? 'Confirmar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>

      {/* ---- Action sheet (menu de opções) ---- */}
      <Modal
        visible={!!sheetData}
        transparent
        animationType="fade"
        statusBarTranslucent
        onDismiss={Platform.OS === 'ios' ? runPending : undefined}
        onRequestClose={() => closeSheet(sheetData?.onCancel)}
      >
        {sheetData && (
          <TouchableOpacity
            style={styles.confirmOverlay}
            activeOpacity={1}
            onPress={() => closeSheet(sheetData.onCancel)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.confirmCard}>
              {!!sheetData.icon && (
                <View style={[styles.confirmIconWrap, { backgroundColor: META.info.bg }]}>
                  <Ionicons name={sheetData.icon} size={32} color={META.info.color} />
                </View>
              )}
              <Text style={styles.confirmTitle}>{sheetData.title}</Text>
              {!!sheetData.message && (
                <Text style={styles.confirmMessage}>{sheetData.message}</Text>
              )}
              <View style={styles.sheetOptions}>
                {sheetData.options.map((opt, i) => (
                  <TouchableOpacity
                    key={`${opt.label}-${i}`}
                    style={[
                      styles.sheetBtn,
                      opt.primary && styles.sheetBtnPrimary,
                      opt.destructive && styles.sheetBtnDestructive,
                    ]}
                    activeOpacity={0.85}
                    onPress={() => closeSheet(opt.onPress)}
                  >
                    {!!opt.icon && (
                      <Ionicons
                        name={opt.icon}
                        size={19}
                        color={opt.primary ? '#FFF' : opt.destructive ? '#FF4757' : '#2F3542'}
                      />
                    )}
                    <Text
                      style={[
                        styles.sheetBtnText,
                        opt.primary && styles.sheetBtnTextPrimary,
                        opt.destructive && styles.sheetBtnTextDestructive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnCancel, styles.sheetCancel]}
                activeOpacity={0.8}
                onPress={() => closeSheet(sheetData.onCancel)}
              >
                <Text style={styles.confirmBtnCancelText}>
                  {sheetData.cancelText ?? 'Cancelar'}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ---- Toast ----
  toastRoot: {
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFF',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  toastInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  toastAccent: {
    width: 5,
  },
  toastIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toastTextWrap: {
    flex: 1,
  },
  toastTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2F3542',
    marginBottom: 2,
  },
  toastMessage: {
    fontSize: 13,
    fontWeight: '500',
    color: '#57606F',
    lineHeight: 18,
  },
  toastMessageSolo: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2F3542',
  },

  // ---- Confirm ----
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 14,
  },
  confirmIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#2F3542',
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    fontWeight: '500',
    color: '#747D8C',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
    alignSelf: 'stretch',
  },
  confirmBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnCancel: {
    backgroundColor: '#F1F2F6',
  },
  confirmBtnCancelText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#747D8C',
  },
  confirmBtnConfirm: {
    backgroundColor: '#FF4757',
  },
  confirmBtnConfirmText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFF',
  },

  // ---- Action sheet ----
  sheetOptions: {
    alignSelf: 'stretch',
    marginTop: 20,
    gap: 10,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F1F2F6',
    paddingHorizontal: 14,
  },
  sheetBtnPrimary: {
    backgroundColor: '#FF4757',
  },
  sheetBtnDestructive: {
    backgroundColor: '#FFECEE',
  },
  sheetBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2F3542',
  },
  sheetBtnTextPrimary: {
    color: '#FFF',
  },
  sheetBtnTextDestructive: {
    color: '#FF4757',
  },
  sheetCancel: {
    alignSelf: 'stretch',
    marginTop: 10,
  },
});
