import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, AdminUserRow, AdminUsersFilters } from '../lib/api';
import { exportToCsv } from '../lib/csv';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

// Último acesso em tempo relativo — pra avaliar atividade, "há 3 dias" diz
// mais que uma data crua. A data exata fica no title (tooltip).
function lastSeen(iso: string | null): { text: string; title: string; stale: boolean } {
  if (!iso) return { text: 'Nunca entrou', title: 'Nunca fez login', stale: true };
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const title = d.toLocaleString('pt-BR');
  if (days <= 0) {
    const h = Math.floor((Date.now() - d.getTime()) / 3600000);
    return { text: h <= 0 ? 'Agora há pouco' : `Há ${h} h`, title, stale: false };
  }
  if (days === 1) return { text: 'Ontem', title, stale: false };
  if (days < 30) return { text: `Há ${days} dias`, title, stale: days > 14 };
  const months = Math.floor(days / 30);
  return { text: months === 1 ? 'Há 1 mês' : `Há ${months} meses`, title, stale: true };
}

const USER_STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  banned: 'Banido',
};

const PAGE_SIZE = 25;

export function Usuarios() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<AdminUsersFilters>({});
  const [applied, setApplied] = useState<AdminUsersFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: AdminUserRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .users({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar usuários'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const set = (k: 'q' | 'status' | 'admin', value: string) =>
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
      <div className="page-head-row">
        <div>
          <h1>Usuários</h1>
          <p className="page-desc">
            Contas cadastradas — busque, filtre e clique em uma linha para ver os detalhes.
          </p>
        </div>
        <button
          className="btn-mini btn-clear"
          disabled={rows.length === 0}
          onClick={() =>
            exportToCsv('usuarios', rows, [
              { header: 'Nome', value: (u) => u.full_name ?? '' },
              { header: 'E-mail', value: (u) => u.email ?? '' },
              { header: 'CPF', value: (u) => u.cpf ?? '' },
              { header: 'Telefone', value: (u) => u.phone ?? '' },
              { header: 'Status', value: (u) => u.status },
              { header: 'Resgates', value: (u) => u.rescues_count },
              {
                header: 'Último acesso',
                value: (u) =>
                  u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('pt-BR') : 'Nunca',
              },
              { header: 'Cadastro', value: (u) => new Date(u.created_at).toLocaleDateString('pt-BR') },
            ])
          }
        >
          Exportar CSV
        </button>
      </div>

      <div className="filters">
        <label>
          Busca
          <input
            type="text"
            placeholder="Nome, e-mail, CPF ou telefone"
            value={draft.q ?? ''}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </label>
        <label>
          Status
          <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todos</option>
            <option value="active">Ativo</option>
            <option value="blocked">Bloqueado</option>
            <option value="banned">Banido</option>
          </select>
        </label>
        <label>
          Perfil
          <select value={draft.admin ?? ''} onChange={(e) => set('admin', e.target.value)}>
            <option value="">Todos</option>
            <option value="true">Administrador</option>
            <option value="false">Comum</option>
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
            <th>Usuário</th>
            <th>Contato</th>
            <th>Status</th>
            <th className="num">Resgates</th>
            <th>Último acesso</th>
            <th>Cadastro</th>
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
                Nenhum usuário encontrado.
              </td>
            </tr>
          ) : (
            rows.map((u) => (
              <tr
                key={u.id}
                className="row-clickable"
                onClick={() => navigate(`/usuarios/${u.id}`)}
              >
                <td>
                  <div className="user-cell">
                    {u.photo_url ? (
                      <img src={u.photo_url} alt="" className="avatar" />
                    ) : (
                      <span className="avatar avatar-empty">
                        {(u.full_name ?? '?').charAt(0)}
                      </span>
                    )}
                    <div>
                      <div className="user-name">{u.full_name ?? '—'}</div>
                      {u.is_admin && <span className="tag-admin">Admin</span>}
                    </div>
                  </div>
                </td>
                <td>
                  <div>{u.email ?? '—'}</div>
                  <div className="muted-text">{u.phone ?? u.cpf ?? ''}</div>
                </td>
                <td>
                  <span className={`badge badge-${u.status}`}>
                    {USER_STATUS_LABEL[u.status] ?? u.status}
                  </span>
                </td>
                <td className="num">{u.rescues_count}</td>
                {(() => {
                  const s = lastSeen(u.last_sign_in_at);
                  return (
                    <td title={s.title} className={s.stale ? 'muted-text' : undefined}>
                      {s.text}
                    </td>
                  );
                })()}
                <td>{fmtDate(u.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} usuário(s) — página {page + 1} de {totalPages}
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
