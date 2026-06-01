import { useCallback, useEffect, useState } from 'react';
import {
  api,
  AdminUserRow,
  SubscriptionRow,
  SubscriptionsFilters,
  SubscriptionsSummary,
} from '../lib/api';
import { confirmDialog, toast } from '../lib/ui';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n: number) => BRL.format(n);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativa',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};
const PLAN_LABEL: Record<string, string> = {
  monthly: 'Mensal',
  lifetime: 'Vitalício',
};
const PAGE_SIZE = 25;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function GrantPanel({ onGranted }: { onGranted: () => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<AdminUserRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [plan, setPlan] = useState<'monthly' | 'lifetime'>('monthly');
  const [granting, setGranting] = useState(false);

  const reset = () => {
    setOpen(false);
    setTerm('');
    setResults(null);
    setSelected(null);
    setPlan('monthly');
  };

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

  const grant = async () => {
    if (!selected) return;
    const ok = await confirmDialog({
      title: 'Conceder premium',
      message: `Conceder Premium ${PLAN_LABEL[plan]} para ${selected.full_name ?? 'este usuário'}?`,
      confirmLabel: 'Conceder',
    });
    if (!ok) return;
    setGranting(true);
    try {
      await api.grantPremium(selected.id, plan);
      toast.success('Premium concedido com sucesso.');
      reset();
      onGranted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conceder premium');
    } finally {
      setGranting(false);
    }
  };

  if (!open) {
    return (
      <button className="btn-save" onClick={() => setOpen(true)}>
        Conceder premium
      </button>
    );
  }

  return (
    <div className="grant-panel">
      <div className="grant-panel-head">
        <strong>Conceder premium (cortesia)</strong>
        <button className="link-btn" onClick={reset}>
          Fechar
        </button>
      </div>

      {!selected ? (
        <>
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
                  <button key={u.id} className="grant-result" onClick={() => setSelected(u)}>
                    <span className="user-name">{u.full_name ?? '—'}</span>
                    <span className="muted-text">{u.email ?? ''}</span>
                  </button>
                ))}
              </div>
            ))}
        </>
      ) : (
        <div className="grant-confirm">
          <div>
            Usuário: <strong>{selected.full_name ?? '—'}</strong>{' '}
            <button className="link-btn" onClick={() => setSelected(null)}>
              trocar
            </button>
          </div>
          <div className="grant-plans">
            <label>
              <input
                type="radio"
                checked={plan === 'monthly'}
                onChange={() => setPlan('monthly')}
              />
              Mensal (30 dias)
            </label>
            <label>
              <input
                type="radio"
                checked={plan === 'lifetime'}
                onChange={() => setPlan('lifetime')}
              />
              Vitalício
            </label>
          </div>
          <button className="btn-save" onClick={grant} disabled={granting}>
            {granting ? 'Concedendo…' : 'Conceder premium'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Assinaturas() {
  const [summary, setSummary] = useState<SubscriptionsSummary | null>(null);
  const [draft, setDraft] = useState<SubscriptionsFilters>({});
  const [applied, setApplied] = useState<SubscriptionsFilters>({});
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: SubscriptionRow[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadSummary = useCallback(() => {
    api
      .subscriptionsSummary()
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .subscriptions({ ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar assinaturas'))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const set = (k: 'status' | 'plan' | 'q', value: string) =>
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

  const reloadAll = () => {
    loadSummary();
    setApplied((a) => ({ ...a }));
  };

  const cancel = async (s: SubscriptionRow) => {
    const ok = await confirmDialog({
      title: 'Cancelar assinatura',
      message: `Cancelar a assinatura de ${s.user.full_name ?? 'este usuário'}? O Premium será revogado.`,
      confirmLabel: 'Cancelar assinatura',
      cancelLabel: 'Voltar',
      danger: true,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await api.cancelSubscription(s.id);
      toast.success('Assinatura cancelada.');
      reloadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar a assinatura');
    } finally {
      setBusyId(null);
    }
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  return (
    <div className="page">
      <h1>Assinaturas</h1>
      <p className="page-desc">Planos Premium ativos, receita recorrente e cortesias.</p>

      <div className="card-grid">
        <Stat label="Assinantes ativos" value={summary ? String(summary.activeTotal) : '…'} />
        <Stat label="Mensais" value={summary ? String(summary.activeMonthly) : '…'} />
        <Stat label="Vitalícios" value={summary ? String(summary.activeLifetime) : '…'} />
        <Stat
          label="Receita recorrente (MRR)"
          value={summary ? brl(summary.mrr) : '…'}
        />
        <Stat
          label="Receita premium total"
          value={summary ? brl(summary.revenueTotal) : '…'}
        />
        <Stat
          label="Vencendo em 7 dias"
          value={summary ? String(summary.expiringSoon) : '…'}
          sub={summary ? `${summary.cancelled} cancelada(s) no total` : undefined}
        />
      </div>

      <GrantPanel onGranted={reloadAll} />

      <section className="fin-section">
        <h2>Assinaturas</h2>
        <div className="filters">
          <label>
            Busca
            <input
              type="text"
              placeholder="Nome do usuário"
              value={draft.q ?? ''}
              onChange={(e) => set('q', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </label>
          <label>
            Status
            <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
              <option value="">Todos</option>
              <option value="active">Ativa</option>
              <option value="cancelled">Cancelada</option>
              <option value="expired">Expirada</option>
            </select>
          </label>
          <label>
            Plano
            <select value={draft.plan ?? ''} onChange={(e) => set('plan', e.target.value)}>
              <option value="">Todos</option>
              <option value="monthly">Mensal</option>
              <option value="lifetime">Vitalício</option>
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
              <th>Plano</th>
              <th className="num">Valor</th>
              <th>Status</th>
              <th>Início</th>
              <th>Expira</th>
              <th>Ações</th>
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
                  Nenhuma assinatura encontrada.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.user.full_name ?? '—'}</td>
                  <td>{PLAN_LABEL[s.plan_type] ?? s.plan_type}</td>
                  <td className="num">{s.amount > 0 ? brl(s.amount) : 'Cortesia'}</td>
                  <td>
                    <span className={`badge sub-${s.status}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </td>
                  <td>{fmtDate(s.starts_at)}</td>
                  <td>{s.expires_at ? fmtDate(s.expires_at) : 'Vitalício'}</td>
                  <td>
                    {s.status === 'active' ? (
                      <button
                        className="btn-mini btn-no"
                        disabled={busyId === s.id}
                        onClick={() => cancel(s)}
                      >
                        Cancelar
                      </button>
                    ) : (
                      <span className="muted-text">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="pagination">
          <span className="muted-text">
            {total} assinatura(s) — página {page + 1} de {totalPages}
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
      </section>
    </div>
  );
}
