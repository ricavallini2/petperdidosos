import { useCallback, useEffect, useState } from 'react';
import { api, AdminAccount, AdminUserRow } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { confirmDialog, toast } from '../lib/ui';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

function AddAdminPanel({ onAdded, existing }: { onAdded: () => void; existing: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<AdminUserRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const search = async () => {
    if (!term.trim()) return;
    setSearching(true);
    setResults(null);
    try {
      const page = await api.users({ q: term.trim(), limit: 8 });
      setResults(page.rows);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const add = async (u: AdminUserRow) => {
    const ok = await confirmDialog({
      title: 'Promover a administrador',
      message: `Conceder acesso de administrador a ${u.full_name ?? 'este usuário'}? Ele poderá gerenciar todo o painel.`,
      confirmLabel: 'Promover',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await api.addAdmin(u.id);
      toast.success('Administrador adicionado.');
      setOpen(false);
      setTerm('');
      setResults(null);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao promover');
    } finally {
      setBusyId(null);
    }
  };

  if (!open) {
    return (
      <button className="btn-save" onClick={() => setOpen(true)}>
        Adicionar administrador
      </button>
    );
  }

  return (
    <div className="grant-panel">
      <div className="grant-panel-head">
        <strong>Adicionar administrador</strong>
        <button className="link-btn" onClick={() => setOpen(false)}>
          Fechar
        </button>
      </div>
      <div className="grant-search">
        <input
          type="text"
          placeholder="Buscar usuário por nome…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className="btn-mini btn-apply" onClick={search} disabled={searching}>
          {searching ? 'Buscando…' : 'Buscar'}
        </button>
      </div>
      {results &&
        (results.length === 0 ? (
          <p className="muted-text" style={{ marginTop: 10 }}>
            Nenhum usuário encontrado.
          </p>
        ) : (
          <div className="grant-results">
            {results.map((u) => (
              <div key={u.id} className="grant-result">
                <span>
                  <span className="user-name">{u.full_name ?? '—'}</span>{' '}
                  <span className="muted-text">{u.email ?? ''}</span>
                </span>
                {existing.has(u.id) ? (
                  <span className="muted-text">já é admin</span>
                ) : (
                  <button
                    className="btn-mini btn-apply"
                    disabled={busyId === u.id}
                    onClick={() => add(u)}
                  >
                    Promover
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

export function Administradores() {
  const { admin } = useAuth();
  const [rows, setRows] = useState<AdminAccount[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    api
      .admins()
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (a: AdminAccount) => {
    const ok = await confirmDialog({
      title: 'Revogar acesso',
      message: `Remover o acesso de administrador de ${a.full_name ?? a.email ?? 'este usuário'}?`,
      confirmLabel: 'Revogar',
      danger: true,
    });
    if (!ok) return;
    setBusyId(a.id);
    try {
      await api.removeAdmin(a.id);
      toast.success('Acesso revogado.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao revogar');
    } finally {
      setBusyId(null);
    }
  };

  const existing = new Set((rows ?? []).map((a) => a.id));

  return (
    <div className="page">
      <h1>Administradores</h1>
      <p className="page-desc">
        Quem tem acesso ao painel. Promova usuários de confiança e revogue quando necessário.
      </p>

      {error && <div className="alert error">{error}</div>}

      <AddAdminPanel onAdded={load} existing={existing} />

      <section className="fin-section">
        <h2>
          Administradores ativos{' '}
          {rows && <span className="count-pill">{rows.length}</span>}
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Administrador</th>
              <th>E-mail</th>
              <th>Desde</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows == null ? (
              <tr>
                <td colSpan={4} className="muted-text">Carregando…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">Nenhum administrador.</td>
              </tr>
            ) : (
              rows.map((a) => {
                const isMe = a.id === admin?.id;
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="user-cell">
                        {a.photo_url ? (
                          <img src={a.photo_url} alt="" className="avatar" />
                        ) : (
                          <span className="avatar avatar-empty">
                            {(a.full_name ?? a.email ?? '?').charAt(0)}
                          </span>
                        )}
                        <div>
                          <div className="user-name">{a.full_name ?? '—'}</div>
                          {isMe && <span className="tag-admin">você</span>}
                        </div>
                      </div>
                    </td>
                    <td>{a.email ?? '—'}</td>
                    <td>{fmtDate(a.created_at)}</td>
                    <td>
                      {isMe ? (
                        <span className="muted-text">—</span>
                      ) : (
                        <button
                          className="btn-mini btn-no"
                          disabled={busyId === a.id}
                          onClick={() => revoke(a)}
                        >
                          Revogar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
