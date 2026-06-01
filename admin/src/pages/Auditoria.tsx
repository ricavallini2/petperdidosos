import { useCallback, useEffect, useState } from 'react';
import { api, AuditRow, AuditFilters } from '../lib/api';
import { exportToCsv } from '../lib/csv';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

// Rótulos legíveis para as ações registradas
const ACTION_LABEL: Record<string, string> = {
  'user.active': 'Reativou usuário',
  'user.blocked': 'Bloqueou usuário',
  'user.banned': 'Baniu usuário',
  'subscription.cancel': 'Cancelou assinatura',
  'subscription.grant': 'Concedeu premium',
  'pet.status': 'Alterou status de caso',
  'pet.bulk': 'Casos em massa',
  'ticket.update': 'Atualizou chamado',
  'ticket.reply': 'Respondeu chamado',
  'ticket.bulk': 'Chamados em massa',
  'report.update': 'Atualizou denúncia',
  'report.bulk': 'Denúncias em massa',
  'sighting.delete': 'Excluiu avistamento',
  'withdraw.paid': 'Pagou saque',
  'withdraw.rejected': 'Recusou saque',
  'broadcast.send': 'Enviou comunicado',
};

const PAGE_SIZE = 50;

export function Auditoria() {
  const [draft, setDraft] = useState<AuditFilters>({});
  const [applied, setApplied] = useState<AuditFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: AuditRow[]; total: number } | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auditActions().then((r) => setActions(r.actions)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .audit({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar o log'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: 'action' | 'q' | 'from' | 'to', value: string) =>
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

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportCsv = () =>
    exportToCsv('auditoria', rows, [
      { header: 'Data', value: (r) => fmtDateTime(r.created_at) },
      { header: 'Admin', value: (r) => r.admin_email ?? '' },
      { header: 'Ação', value: (r) => ACTION_LABEL[r.action] ?? r.action },
      { header: 'Alvo', value: (r) => `${r.target_type ?? ''} ${r.target_id ?? ''}`.trim() },
      { header: 'Detalhe', value: (r) => (r.detail ? JSON.stringify(r.detail) : '') },
    ]);

  return (
    <div className="page">
      <div className="page-head-row">
        <div>
          <h1>Log de auditoria</h1>
          <p className="page-desc">Histórico de todas as ações administrativas.</p>
        </div>
        <button className="btn-mini btn-clear" onClick={exportCsv} disabled={rows.length === 0}>
          Exportar CSV
        </button>
      </div>

      <div className="filters">
        <label>
          Admin
          <input
            type="text"
            placeholder="E-mail do admin"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Ação
          <select value={draft.action ?? ''} onChange={(e) => set('action', e.target.value)}>
            <option value="">Todas</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <label>
          De
          <input type="date" value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} />
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
            <th>Data</th>
            <th>Admin</th>
            <th>Ação</th>
            <th>Alvo</th>
            <th>Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="muted-text">Carregando…</td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-state">Nenhuma ação registrada.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDateTime(r.created_at)}</td>
                <td>{r.admin_email ?? '—'}</td>
                <td>
                  <span className="badge badge-pet">{ACTION_LABEL[r.action] ?? r.action}</span>
                </td>
                <td className="muted-text">
                  {r.target_type ? `${r.target_type}` : '—'}
                  {r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ''}
                </td>
                <td className="desc-cell mono" style={{ fontSize: 11 }}>
                  {r.detail ? JSON.stringify(r.detail) : '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} registro(s) — página {page + 1} de {totalPages}
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
