import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, CasoRow, CasosFilters } from '../lib/api';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

export const TYPE_LABEL: Record<string, string> = {
  lost: 'Perdido',
  sighted: 'Visto',
  rescued: 'Resgatado',
};
export const SPECIES_LABEL: Record<string, string> = {
  cachorro: 'Cachorro',
  gato: 'Gato',
  passaro: 'Pássaro',
  outro: 'Outro',
};
export const PET_STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  pausado: 'Pausado',
  encontrado: 'Encontrado',
  cancelado: 'Cancelado',
};

const PAGE_SIZE = 25;

export function Casos() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<CasosFilters>({});
  const [applied, setApplied] = useState<CasosFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: CasoRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .casos({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar casos'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const set = (k: 'type' | 'species' | 'status' | 'q', value: string) =>
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
      <h1>Casos</h1>
      <p className="page-desc">
        Pets perdidos, vistos e resgatados. Clique em um caso para ver tudo: tutor,
        fotos, recompensa, chats e avistamentos.
      </p>

      <div className="filters">
        <label>
          Busca
          <input
            type="text"
            placeholder="Nome do pet, raça ou tutor"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Tipo
          <select value={draft.type ?? ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Espécie
          <select value={draft.species ?? ''} onChange={(e) => set('species', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(SPECIES_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(PET_STATUS_LABEL).map(([k, l]) => (
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
            <th>Pet</th>
            <th>Tipo</th>
            <th>Espécie / Raça</th>
            <th>Tutor</th>
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
                Nenhum caso encontrado.
              </td>
            </tr>
          ) : (
            rows.map((p) => (
              <tr
                key={p.id}
                className="row-clickable"
                onClick={() => navigate(`/casos/${p.id}`)}
              >
                <td>
                  <div className="user-cell">
                    {p.main_photo_url ? (
                      <img src={p.main_photo_url} alt="" className="avatar" />
                    ) : (
                      <span className="avatar avatar-empty">
                        {(p.name ?? '?').charAt(0)}
                      </span>
                    )}
                    <span className="user-name">{p.name}</span>
                  </div>
                </td>
                <td>
                  <span className={`badge type-${p.type}`}>
                    {TYPE_LABEL[p.type] ?? p.type}
                  </span>
                </td>
                <td>
                  {p.species ? SPECIES_LABEL[p.species] ?? p.species : '—'}
                  {p.breed && <div className="muted-text">{p.breed}</div>}
                </td>
                <td>{p.tutor.full_name ?? '—'}</td>
                <td>
                  <span className={`badge petst-${p.status}`}>
                    {PET_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </td>
                <td>{fmtDate(p.lost_date) !== '—' ? fmtDate(p.lost_date) : fmtDate(p.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} caso(s) — página {page + 1} de {totalPages}
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
