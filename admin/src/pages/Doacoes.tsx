import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, DoacaoRow, DoacoesFilters } from '../lib/api';
import { SPECIES_LABEL } from './Casos';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

export const DONATION_STATUS_LABEL: Record<string, string> = {
  ativo: 'Disponível',
  pausado: 'Pausado',
  encontrado: 'Adotado',
  cancelado: 'Cancelado',
};
const SEX_LABEL: Record<string, string> = {
  macho: 'Macho',
  femea: 'Fêmea',
  desconhecido: '—',
};
const AGE_LABEL: Record<string, string> = {
  filhote: 'Filhote',
  adulto: 'Adulto',
  idoso: 'Idoso',
  desconhecido: '—',
};
const PAGE_SIZE = 25;

export function Doacoes() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DoacoesFilters>({});
  const [applied, setApplied] = useState<DoacoesFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: DoacaoRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .donations({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar doações'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const set = (k: 'status' | 'species' | 'q', value: string) =>
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
      <h1>Doações</h1>
      <p className="page-desc">
        Pets disponíveis para adoção. Acompanhe quem doou, quem adotou e o estágio de cada
        caso.
      </p>

      <div className="filters">
        <label>
          Busca
          <input
            type="text"
            placeholder="Pet, raça, doador ou adotante"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Status
          <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(DONATION_STATUS_LABEL).map(([k, l]) => (
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
            <th>Espécie / Raça</th>
            <th>Sexo / Idade</th>
            <th>Status</th>
            <th>Adotante</th>
            <th>Cadastrado</th>
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
                Nenhum pet em doação encontrado.
              </td>
            </tr>
          ) : (
            rows.map((p) => (
              <tr
                key={p.id}
                className="row-clickable"
                onClick={() => navigate(`/doacoes/${p.id}`)}
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
                    <div>
                      <div className="user-name">{p.name}</div>
                      <div className="muted-text">{p.tutor.full_name ?? '—'}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {p.species ? SPECIES_LABEL[p.species] ?? p.species : '—'}
                  {p.breed && <div className="muted-text">{p.breed}</div>}
                </td>
                <td>
                  {p.sex ? SEX_LABEL[p.sex] ?? p.sex : '—'}
                  {p.age_group && (
                    <div className="muted-text">{AGE_LABEL[p.age_group] ?? p.age_group}</div>
                  )}
                </td>
                <td>
                  <span className={`badge dn-${p.status}`}>
                    {DONATION_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </td>
                <td>
                  {p.adopter?.full_name ?? <span className="muted-text">—</span>}
                </td>
                <td>{fmtDate(p.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} doação(ões) — página {page + 1} de {totalPages}
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
