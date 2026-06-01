import { useEffect, useRef, useState } from 'react';
import {
  DialogRequest,
  ToastItem,
  setDialogListener,
  subscribeToasts,
} from '../lib/ui';

const TOAST_TTL = 4200;

function ToastStack() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, TOAST_TTL);
    });
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="toast-stack">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          <span className="toast-dot" />
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDialogListener((d) => {
      setReq(d);
      setValue(d.defaultValue ?? '');
    });
    return () => setDialogListener(null);
  }, []);

  useEffect(() => {
    if (req?.prompt) setTimeout(() => inputRef.current?.focus(), 50);
  }, [req]);

  if (!req) return null;

  const close = (result: boolean | string | null) => {
    req.resolve(result);
    setReq(null);
  };
  const onConfirm = () => close(req.prompt ? value : true);
  const onCancel = () => close(req.prompt ? null : false);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{req.title}</h3>
        {req.message && <p className="dialog-msg">{req.message}</p>}
        {req.prompt && (
          <label className="dialog-field">
            {req.promptLabel}
            <input
              ref={inputRef}
              value={value}
              placeholder={req.promptPlaceholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirm();
                if (e.key === 'Escape') onCancel();
              }}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button className="btn-mini btn-clear" onClick={onCancel}>
            {req.cancelLabel}
          </button>
          <button
            className={`btn-mini ${req.danger ? 'btn-no' : 'btn-apply'}`}
            onClick={onConfirm}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UiHost() {
  return (
    <>
      <ToastStack />
      <DialogHost />
    </>
  );
}
