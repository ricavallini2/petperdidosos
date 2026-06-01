import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, SightingRow, SightingsFilters } from '../lib/api';
import { confirmDialog, toast } from '../lib/ui';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const PAGE_SIZE = 25;

function ConfirmedBadge({ value }: { value: boolean | null }) {
  if (value === true) return <span className="badge badge-completed">Confirmado</span>;
  if (value === false) return <span className="badge badge-failed">Não é o pet</span>;
  return <span className="badge badge-pending">Pendente</span>;
}

export function Avistamentos() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<SightingsFilters>({});
  const [applied, setApplied] = useState<SightingsFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: SightingRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .sightings({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar avistamentos'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: 'q' | 'confirmed', value: string) =>
    setDraft((d) => ({
      ...d,
      [k]: value || undefined,
    }));
  const applyFilters = () => {
    setPage(0);
    setApplied(draft);
  };
  const clearFilters = () => {
    setDraft({});
    setApplied({});
    setPage(0);
  };

  const remove = async (s: SightingRow) => {
    const ok = await confirmDialog({
      title: 'Excluir avistamento',
      message: `Excluir o avistamento de ${s.finder.full_name ?? 'um buscador'}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await api.deleteSighting(s.id);
      toast.success('Avistamento excluído.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir');
    } finally {
      setBusyId(null);
    }
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  return (
    <div className="page">
      <h1>Avistamentos</h1>
      <p className="page-desc">
        Quando alguém reporta ter visto um pet perdido, vira um avistamento. A IA pontua a
        similaridade; o tutor confirma se é o pet dele.
      </p>

      <div className="filters">
        <label>
          Busca
          <input
            type="text"
            placeholder="Pet, buscador ou mensagem"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Confirmação
          <select
            value={draft.confirmed ?? ''}
            onChange={(e) => set('confirmed', e.target.value)}
          >
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="yes">Confirmado</option>
            <option value="no">Não é o pet</option>
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
            <th>Pet (caso)</th>
            <th>Avistador</th>
            <th className="num">Score IA</th>
            <th>Tutor confirmou</th>
            <th>Foto</th>
            <th>Mensagem</th>
            <th>Local</th>
            <th>Data</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={9} className="muted-text">
                Carregando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="empty-state">
                Nenhum avistamento encontrado.
              </td>
            </tr>
          ) : (
            rows.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.pet ? (
                    <button className="link-btn" onClick={() => navigate(`/casos/${s.pet!.id}`)}>
                      {s.pet.name ?? '(pet sem nome)'}
                    </button>
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
                <td>
                  <button
                    className="link-btn"
                    onClick={() => navigate(`/usuarios/${s.finder.id}`)}
                  >
                    {s.finder.full_name ?? '—'}
                  </button>
                </td>
                <td className="num">
                  {s.ai_match_score != null
                    ? `${Math.round(s.ai_match_score * 100)}%`
                    : '—'}
                </td>
                <td>
                  <ConfirmedBadge value={s.confirmed_by_tutor} />
                </td>
                <td>
                  {s.photo_url ? (
                    <a href={s.photo_url} target="_blank" rel="noreferrer">
                      <img
                        src={s.photo_url}
                        alt=""
                        className="photo-thumb"
                        style={{ width: 56, height: 56, borderRadius: 8 }}
                      />
                    </a>
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
                <td className="desc-cell">{s.message ?? '—'}</td>
                <td>
                  <a
                    className="link-btn"
                    href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    abrir mapa
                  </a>
                </td>
                <td>{fmtDateTime(s.created_at)}</td>
                <td>
                  <button
                    className="btn-mini btn-no"
                    disabled={busyId === s.id}
                    onClick={() => remove(s)}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} avistamento(s) — página {page + 1} de {totalPages}
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
