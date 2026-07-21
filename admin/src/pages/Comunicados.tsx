import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { confirmDialog, toast } from '../lib/ui';

// Segmentos premium/free saíram: o app é 100% gratuito, então "free" era
// todo mundo e "premium" eram 2 contas de teste. Só resta um público real.
const AUDIENCE = 'all' as const;
const AUDIENCE_LABEL = 'Todos os usuários';

export function Comunicados() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setCount(null);
    api
      .broadcastPreview(AUDIENCE)
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));
  }, []);

  const send = async () => {
    if (!title.trim()) {
      toast.error('Informe o título da notificação.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Enviar comunicado',
      message: `Enviar “${title.trim()}” para ${count ?? '—'} usuário(s) (${AUDIENCE_LABEL.toLowerCase()})? Eles receberão a notificação no app.`,
      confirmLabel: 'Enviar agora',
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await api.broadcast(AUDIENCE, title.trim(), body.trim());
      toast.success(`Comunicado enviado para ${res.count} usuário(s).`);
      setTitle('');
      setBody('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar o comunicado');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <h1>Comunicados</h1>
      <p className="page-desc">
        Envie uma notificação para os usuários. Ela aparece na central de notificações do app.
      </p>

      <div className="broadcast-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Nova notificação</h3>
          </div>

          <label className="field-block">
            Título
            <input
              type="text"
              value={title}
              maxLength={120}
              placeholder="Ex.: Nova função no app!"
              onChange={(e) => setTitle(e.target.value)}
              style={{
                padding: '11px 13px',
                border: '1px solid var(--border)',
                borderRadius: 12,
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 14,
              }}
            />
          </label>

          <label className="field-block">
            Mensagem (opcional)
            <textarea
              value={body}
              maxLength={500}
              rows={4}
              placeholder="Texto da notificação…"
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          <button className="btn-save" onClick={send} disabled={sending}>
            {sending ? 'Enviando…' : `Enviar para ${count ?? '…'} usuário(s)`}
          </button>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Pré-visualização</h3>
            <span className="panel-sub">como aparece no app</span>
          </div>
          <div className="notif-preview">
            <div className="notif-preview-icon">🔔</div>
            <div className="notif-preview-body">
              <div className="notif-preview-title">{title.trim() || 'Título da notificação'}</div>
              <div className="notif-preview-text">
                {body.trim() || 'A mensagem aparece aqui para o usuário.'}
              </div>
            </div>
          </div>
          <p className="muted-text" style={{ marginTop: 16 }}>
            Destino: <strong>{AUDIENCE_LABEL}</strong>
            <br />
            Alcance estimado: <strong>{count ?? '…'}</strong> usuário(s).
          </p>
        </div>
      </div>
    </div>
  );
}
