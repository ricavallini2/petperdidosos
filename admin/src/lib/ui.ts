// Sistema de UI imperativo (toasts + diálogos) — sem dependências externas.
// Permite chamar toast.success(...) e await confirmDialog(...) de qualquer
// lugar, sem prop drilling. O <UiHost/> (montado no Layout) escuta e renderiza.

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  prompt: boolean;
  promptLabel?: string;
  promptPlaceholder?: string;
  defaultValue?: string;
  resolve: (value: boolean | string | null) => void;
}

let seq = 0;
const toastListeners = new Set<(t: ToastItem) => void>();
let dialogListener: ((d: DialogRequest) => void) | null = null;

function emitToast(kind: ToastKind, message: string) {
  const item: ToastItem = { id: ++seq, kind, message };
  toastListeners.forEach((l) => l(item));
}

export const toast = {
  success: (message: string) => emitToast('success', message),
  error: (message: string) => emitToast('error', message),
  info: (message: string) => emitToast('info', message),
};

export function subscribeToasts(fn: (t: ToastItem) => void): () => void {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

export function setDialogListener(fn: ((d: DialogRequest) => void) | null) {
  dialogListener = fn;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Diálogo de confirmação. Resolve com true (confirmou) ou false (cancelou).
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dialogListener) return resolve(false);
    dialogListener({
      id: ++seq,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirmar',
      cancelLabel: opts.cancelLabel ?? 'Cancelar',
      danger: opts.danger ?? false,
      prompt: false,
      resolve: (v) => resolve(v === true),
    });
  });
}

interface PromptOptions {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
}

// Diálogo com campo de texto. Resolve com a string ou null (cancelou).
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!dialogListener) return resolve(null);
    dialogListener({
      id: ++seq,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirmar',
      cancelLabel: 'Cancelar',
      danger: opts.danger ?? false,
      prompt: true,
      promptLabel: opts.label,
      promptPlaceholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    });
  });
}
