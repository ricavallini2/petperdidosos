import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ReportRow, ReportsFilters } from '../lib/api';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const REPORT_STATUS_LABEL: Record<string, string> = {
  pending: 'Aberta',
  reviewing: 'Em análise',
  dismissed: 'Indeferida',
  actioned: 'Ação aplicada',
};
const PAGE_SIZE = 25;

export function Denuncias() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ReportsFilters>({});
  const [applied, setApplied] = useState<ReportsFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: ReportRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .reports({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar denúncias'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const set = (k: 'status' | 'q', value: string) =>
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

  return (
    <div className="page">
      <h1>Denúncias</h1>
      <p className="page-desc">
        Relatos de abuso, fraude e conteúdo impróprio enviados pelos usuários. Clique para
        ver o contexto completo e decidir.
      </p>

      <div className="filters">
        <label>
          Busca
          <input
            type="text"
            placeholder="Denunciante, denunciado ou motivo"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Status
          <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(REPORT_STATUS_LABEL).map(([k, l]) => (
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
            <th>Motivo</th>
            <th>Denunciante</th>
            <th>Denunciado</th>
            <th>Contexto</th>
            <th>Status</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="muted-text">
                Carregando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-state">
                Nenhuma denúncia encontrada.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.id}
                className="row-clickable"
                onClick={() => navigate(`/denuncias/${r.id}`)}
              >
                <td>
                  <span className="user-name">{r.reason}</span>
                </td>
                <td>{r.reporter.full_name ?? '—'}</td>
                <td>{r.reported.full_name ?? '—'}</td>
                <td>
                  {r.pet ? `Caso: ${r.pet.name ?? '—'}` : r.chat_id ? 'Chat' : <span className="muted-text">—</span>}
                </td>
                <td>
                  <span className={`badge rep-${r.status}`}>
                    {REPORT_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td>{fmtDateTime(r.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} denúncia(s) — página {page + 1} de {totalPages}
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
