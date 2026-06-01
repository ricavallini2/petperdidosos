import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, TicketDetail } from '../lib/api';
import {
  TICKET_STATUS_LABEL,
  TICKET_PRIORITY_LABEL,
  TICKET_CATEGORY_LABEL,
} from './Chamados';
import { confirmDialog, toast } from '../lib/ui';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const ROLE_LABEL: Record<string, string> = {
  user: 'Usuário',
  assistant: 'Assistente IA',
  support: 'Suporte',
};

export function ChamadoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [savingTriage, setSavingTriage] = useState(false);
  const [triageOk, setTriageOk] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    api
      .ticketDetail(id)
      .then((d) => {
        setData(d);
        setStatus(d.ticket.status);
        setPriority(d.ticket.priority);
        setCategory(d.ticket.category ?? '');
        setNotes(d.ticket.admin_notes ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar o chamado'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza a conversa em segundo plano (ex.: quando o usuário responde),
  // sem sobrescrever os campos de triagem que o operador está editando.
  const refresh = useCallback(() => {
    if (!id) return;
    api
      .ticketDetail(id)
      .then(setData)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const saveTriage = async () => {
    if (!id) return;
    setSavingTriage(true);
    setTriageOk(false);
    try {
      await api.updateTicket(id, {
        status,
        priority,
        category: category || null,
        admin_notes: notes.trim() || null,
      });
      setTriageOk(true);
      toast.success('Triagem salva.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar a triagem');
    } finally {
      setSavingTriage(false);
    }
  };

  const sendReply = async () => {
    if (!id || !replyText.trim()) return;
    setReplying(true);
    try {
      await api.replyTicket(id, replyText.trim());
      setReplyText('');
      toast.success('Resposta enviada ao usuário.');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar a resposta');
    } finally {
      setReplying(false);
    }
  };

  const quickStatus = async (newStatus: 'closed' | 'in_progress') => {
    if (!id) return;
    const ok = await confirmDialog({
      title: newStatus === 'closed' ? 'Encerrar chamado' : 'Reabrir chamado',
      message: newStatus === 'closed' ? 'Encerrar este chamado?' : 'Reabrir este chamado?',
      confirmLabel: newStatus === 'closed' ? 'Encerrar' : 'Reabrir',
      danger: newStatus === 'closed',
    });
    if (!ok) return;
    setChangingStatus(true);
    try {
      await api.updateTicket(id, { status: newStatus });
      toast.success(newStatus === 'closed' ? 'Chamado encerrado.' : 'Chamado reaberto.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar o chamado');
    } finally {
      setChangingStatus(false);
    }
  };

  const suggest = async () => {
    if (!id) return;
    setSuggesting(true);
    try {
      const { suggestion } = await api.suggestTicketReply(id);
      setReplyText(suggestion);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar a sugestão');
    } finally {
      setSuggesting(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <p className="muted-text">Carregando…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <button className="link-btn" onClick={() => navigate('/chamados')}>
          ← Voltar para chamados
        </button>
        <div className="alert error">{error || 'Chamado não encontrado.'}</div>
      </div>
    );
  }

  const t = data.ticket;
  const u = data.user;
  const contato = [u?.email, u?.phone].filter(Boolean).join(' · ');

  return (
    <div className="page">
      <button className="link-btn" onClick={() => navigate('/chamados')}>
        ← Voltar para chamados
      </button>

      <div className="ticket-head">
        <h1>{t.subject}</h1>
        <span className={`badge tk-${t.status}`}>
          {TICKET_STATUS_LABEL[t.status] ?? t.status}
        </span>
        <div className="ticket-head-actions">
          {t.status === 'closed' ? (
            <button
              className="btn-mini btn-clear"
              disabled={changingStatus}
              onClick={() => quickStatus('in_progress')}
            >
              Reabrir chamado
            </button>
          ) : (
            <button
              className="btn-mini btn-no"
              disabled={changingStatus}
              onClick={() => quickStatus('closed')}
            >
              Encerrar chamado
            </button>
          )}
        </div>
      </div>
      <p className="page-desc">
        Aberto por <strong>{u?.full_name ?? '—'}</strong>
        {contato ? ` · ${contato}` : ''} · {fmtDateTime(t.created_at)}
      </p>

      {t.description && <div className="notice">{t.description}</div>}

      <section className="fin-section">
        <h2>Triagem</h2>
        <div className="filters">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(TICKET_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioridade
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(TICKET_PRIORITY_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoria
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— Sem categoria —</option>
              {Object.entries(TICKET_CATEGORY_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field-block">
          Notas internas (não visíveis ao usuário)
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setTriageOk(false);
            }}
            rows={3}
            placeholder="Anotações da equipe sobre este chamado…"
          />
        </label>
        <button className="btn-save" onClick={saveTriage} disabled={savingTriage}>
          {savingTriage ? 'Salvando…' : 'Salvar triagem'}
        </button>
        {triageOk && <span className="muted-text" style={{ marginLeft: 10 }}>Triagem salva.</span>}
      </section>

      <section className="fin-section">
        <h2>Conversa</h2>
        {data.messages.length === 0 ? (
          <p className="empty-state">Este chamado não tem conversa vinculada.</p>
        ) : (
          <div className="ticket-thread">
            {data.messages.map((m) => (
              <div key={m.id} className={`ticket-msg role-${m.role}`}>
                <div className="ticket-msg-head">
                  <span className="ticket-role">{ROLE_LABEL[m.role] ?? m.role}</span>
                  <span className="ticket-time">{fmtDateTime(m.created_at)}</span>
                </div>
                <div className="ticket-msg-body">{m.content}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="fin-section">
        <h2>Responder ao usuário</h2>
        <p className="muted-text" style={{ marginBottom: 8 }}>
          A resposta aparece para o usuário na Central de Ajuda do app, e ele recebe uma
          notificação.
        </p>
        <div className="reply-actions">
          <button
            className="btn-mini btn-clear"
            onClick={suggest}
            disabled={suggesting || replying}
          >
            {suggesting ? 'Gerando sugestão…' : 'Sugerir resposta com IA'}
          </button>
          <span className="muted-text">
            A IA analisa o chamado e a conversa e preenche um rascunho — revise antes de enviar.
          </span>
        </div>
        <textarea
          className="reply-box"
          placeholder="Escreva a resposta… ou gere uma sugestão com a IA acima."
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          rows={5}
        />
        <button
          className="btn-save"
          onClick={sendReply}
          disabled={replying || !replyText.trim()}
        >
          {replying ? 'Enviando…' : 'Enviar resposta'}
        </button>
      </section>
    </div>
  );
}
