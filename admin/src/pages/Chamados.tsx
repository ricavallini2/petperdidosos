import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, AdminTicketRow, AdminTicketsFilters } from '../lib/api';
import { confirmDialog, toast } from '../lib/ui';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const TICKET_STATUS_LABEL: Record<string, string> = {
  pending: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
  closed: 'Fechado',
};
export const TICKET_PRIORITY_LABEL: Record<string, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};
export const TICKET_CATEGORY_LABEL: Record<string, string> = {
  financeiro: 'Financeiro',
  conta: 'Conta',
  caso: 'Caso/Pet',
  denuncia: 'Denúncia',
  bug: 'Bug',
  duvida: 'Dúvida',
  outros: 'Outros',
};
const PAGE_SIZE = 25;

export function Chamados() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<AdminTicketsFilters>({});
  const [applied, setApplied] = useState<AdminTicketsFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: AdminTicketRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .tickets({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar chamados'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const set = (k: 'status' | 'priority' | 'category' | 'q', value: string) =>
    setDraft((d) => ({ ...d, [k]: value || undefined }));
  const applyFilters = () => {
    setPage(0);
    setApplied(draft);
  };
  const clearFilters = () => {
    setDraft({});
    setApplied({});
    setPage(0);
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => setSel(new Set()), [data]);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));

  const applyBulk = async (status: string, label: string) => {
    const ids = [...sel];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: 'Ação em massa',
      message: `${label} ${ids.length} chamado(s) selecionado(s)?`,
      confirmLabel: label,
      danger: status === 'closed',
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const res = await api.bulkTickets(ids, status);
      toast.success(`${res.count} chamado(s) atualizados.`);
      setApplied((a) => ({ ...a }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na ação em massa');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Chamados</h1>
      <p className="page-desc">
        Tickets de suporte abertos pelos usuários. Clique em um chamado para ver e responder.
      </p>

      <div className="filters">
        <label>
          Busca
          <input
            type="text"
            placeholder="Assunto ou usuário"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Status
          <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TICKET_STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prioridade
          <select value={draft.priority ?? ''} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(TICKET_PRIORITY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select value={draft.category ?? ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(TICKET_CATEGORY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-actions">
          <button className="btn-mini btn-apply" onClick={applyFilters}>
            Filtrar
          </button>
          <button className="btn-mini btn-clear" onClick={clearFilters}>
            Limpar
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th className="check-cell">
              <input
                type="checkbox"
                checked={rows.length > 0 && sel.size === rows.length}
                onChange={toggleAll}
              />
            </th>
            <th>Assunto</th>
            <th>Usuário</th>
            <th>Categoria</th>
            <th>Prioridade</th>
            <th>Status</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="muted-text">
                Carregando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-state">
                Nenhum chamado encontrado.
              </td>
            </tr>
          ) : (
            rows.map((t) => (
              <tr
                key={t.id}
                className="row-clickable"
                onClick={() => navigate(`/chamados/${t.id}`)}
              >
                <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                </td>
                <td>
                  <span className="user-name">{t.subject}</span>
                </td>
                <td>{t.user.full_name ?? '—'}</td>
                <td>
                  {t.category ? (
                    TICKET_CATEGORY_LABEL[t.category] ?? t.category
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
                <td>
                  <span className={`badge prio-${t.priority}`}>
                    {TICKET_PRIORITY_LABEL[t.priority] ?? t.priority}
                  </span>
                </td>
                <td>
                  <span className={`badge tk-${t.status}`}>
                    {TICKET_STATUS_LABEL[t.status] ?? t.status}
                  </span>
                </td>
                <td>{fmtDateTime(t.updated_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {sel.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{sel.size} selecionado(s)</span>
          <div className="bulk-spacer" />
          <button className="btn-mini btn-clear" disabled={bulkBusy} onClick={() => applyBulk('in_progress', 'Marcar em andamento')}>
            Em andamento
          </button>
          <button className="btn-mini btn-ok" disabled={bulkBusy} onClick={() => applyBulk('resolved', 'Resolver')}>
            Resolver
          </button>
          <button className="btn-mini btn-no" disabled={bulkBusy} onClick={() => applyBulk('closed', 'Encerrar')}>
            Encerrar
          </button>
          <button className="btn-mini btn-clear" onClick={() => setSel(new Set())}>
            Limpar seleção
          </button>
        </div>
      )}

      <div className="pagination">
        <span className="muted-text">
          {total} chamado(s) — página {page + 1} de {totalPages}
        </span>
        <div className="row-actions">
          <button
            className="btn-mini btn-clear"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Anterior
          </button>
          <button
            className="btn-mini btn-clear"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
