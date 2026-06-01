import { useCallback, useEffect, useState } from 'react';
import { api, FinanceSummary, LedgerFilters, LedgerPage, LedgerRow, Withdrawal } from '../lib/api';
import { confirmDialog, toast } from '../lib/ui';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n: number) => BRL.format(n);
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const TX_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Concluído',
  failed: 'Falhou',
};

const MOVEMENT_LABEL: Record<string, string> = {
  reward_offered: 'Recompensa ofertada',
  reward_increase: 'Aumento de recompensa',
  reward_transferred: 'Recompensa transferida',
  withdraw: 'Saque PIX',
  reward_refund: 'Estorno de recompensa',
  app_fee: 'Taxa do app',
  premium: 'Assinatura premium',
};
const REWARD_MOVEMENTS = [
  'reward_offered',
  'reward_increase',
  'reward_transferred',
  'withdraw',
  'reward_refund',
];
// Movimentos que representam dinheiro entrando na plataforma (verde no extrato).
const INFLOW = new Set(['reward_offered', 'reward_increase', 'app_fee', 'premium']);

const PAGE_SIZE = 25;

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{TX_STATUS_LABEL[status] ?? status}</span>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function KpiCards({ summary }: { summary: FinanceSummary | null }) {
  const v = (n: number | undefined) => (summary ? brl(n ?? 0) : '…');
  return (
    <div className="card-grid">
      <Stat label="Receita do app (taxas)" value={v(summary?.feeRevenueTotal)} />
      <Stat label="Receita premium" value={v(summary?.premiumRevenueTotal)} />
      <Stat label="Em garantia (escrow)" value={v(summary?.escrowHeld)} />
      <Stat label="Pago a buscadores" value={v(summary?.paidToFinders)} />
      <Stat label="Reembolsado a tutores" value={v(summary?.refundedToTutors)} />
      <Stat label="Saldo em carteiras" value={v(summary?.walletsTotal)} />
      <Stat
        label="Saques pendentes"
        value={summary ? brl(summary.withdrawPending.total) : '…'}
        sub={summary ? `${summary.withdrawPending.count} solicitação(ões)` : undefined}
      />
      <Stat
        label="Saques concluídos"
        value={summary ? brl(summary.withdrawCompleted.total) : '…'}
        sub={summary ? `${summary.withdrawCompleted.count} pago(s)` : undefined}
      />
    </div>
  );
}

function WithdrawalsSection({ onSettled }: { onSettled: () => void }) {
  const [list, setList] = useState<Withdrawal[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    api
      .withdrawals()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar saques'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const settle = async (w: Withdrawal, action: 'paid' | 'rejected') => {
    const who = w.user?.full_name ?? 'usuário';
    const valor = brl(Math.abs(w.amount));
    const ok = await confirmDialog({
      title: action === 'paid' ? 'Confirmar pagamento' : 'Recusar saque',
      message:
        action === 'paid'
          ? `Marcar como PAGO o saque de ${valor} de ${who}?`
          : `Recusar o saque de ${valor} de ${who}? O valor será devolvido à carteira do usuário.`,
      confirmLabel: action === 'paid' ? 'Marcar pago' : 'Recusar',
      danger: action === 'rejected',
    });
    if (!ok) return;

    setBusyId(w.id);
    try {
      await api.settleWithdrawal(w.id, action);
      toast.success(action === 'paid' ? 'Saque marcado como pago.' : 'Saque recusado e devolvido.');
      load();
      onSettled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao processar o saque');
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = (list ?? []).filter((w) => w.status === 'pending').length;

  return (
    <section className="fin-section">
      <h2>
        Saques
        {pendingCount > 0 && <span className="count-pill">{pendingCount} pendente(s)</span>}
      </h2>

      {error && <div className="alert error">{error}</div>}

      {list == null ? (
        <p className="muted-text">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="empty-state">Nenhum saque solicitado até o momento.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Usuário</th>
              <th>Chave PIX</th>
              <th className="num">Valor</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id}>
                <td>{fmtDateTime(w.created_at)}</td>
                <td>{w.user?.full_name ?? '—'}</td>
                <td className="mono">{w.user?.pix_key ?? '—'}</td>
                <td className="num">{brl(Math.abs(w.amount))}</td>
                <td>
                  <StatusBadge status={w.status} />
                </td>
                <td>
                  {w.status === 'pending' ? (
                    <div className="row-actions">
                      <button
                        className="btn-mini btn-ok"
                        disabled={busyId === w.id}
                        onClick={() => settle(w, 'paid')}
                      >
                        Pagar
                      </button>
                      <button
                        className="btn-mini btn-no"
                        disabled={busyId === w.id}
                        onClick={() => settle(w, 'rejected')}
                      >
                        Recusar
                      </button>
                    </div>
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type FilterKey = 'movement' | 'status' | 'from' | 'to' | 'user';

function LedgerView({ group }: { group: 'rewards' | 'fees' | 'premium' }) {
  const [draft, setDraft] = useState<Partial<LedgerFilters>>({});
  const [applied, setApplied] = useState<Partial<LedgerFilters>>({});
  const [caseName, setCaseName] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<LedgerPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .financeLedger({ ...applied, group, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar extrato'))
      .finally(() => setLoading(false));
  }, [group, applied, page]);

  const set = (k: FilterKey, value: string) =>
    setDraft((d) => ({ ...d, [k]: value || undefined }));

  const applyFilters = () => {
    setPage(0);
    setApplied((a) => ({ ...draft, petId: a.petId }));
  };
  const clearFilters = () => {
    setDraft({});
    setApplied({});
    setCaseName('');
    setPage(0);
  };
  const filterByCase = (petId: string, name: string) => {
    setCaseName(name);
    setPage(0);
    setApplied((a) => ({ ...a, petId }));
  };
  const clearCase = () => {
    setCaseName('');
    setPage(0);
    setApplied((a) => ({ ...a, petId: undefined }));
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];
  const showFee = group === 'rewards';
  const colCount = showFee ? 8 : 7;

  return (
    <>
      <div className="filters">
        {group === 'rewards' && (
          <>
            <label>
              Movimento
              <select value={draft.movement ?? ''} onChange={(e) => set('movement', e.target.value)}>
                <option value="">Todos</option>
                {REWARD_MOVEMENTS.map((m) => (
                  <option key={m} value={m}>
                    {MOVEMENT_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(TX_STATUS_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          De
          <input type="date" value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </label>
        <label>
          Usuário
          <input
            type="text"
            placeholder="Nome do usuário"
            value={draft.user ?? ''}
            onChange={(e) => set('user', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
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

      {caseName && (
        <div className="case-chip">
          Caso: <strong>{caseName}</strong>
          <button onClick={clearCase} aria-label="Remover filtro de caso">
            ✕
          </button>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Usuário</th>
            <th>Movimento</th>
            <th>Caso</th>
            <th className="num">Valor</th>
            {showFee && <th className="num">Taxa</th>}
            <th>Status</th>
            <th>Descrição</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colCount} className="muted-text">
                Carregando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="empty-state">
                Nenhum lançamento encontrado.
              </td>
            </tr>
          ) : (
            rows.map((r: LedgerRow) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.created_at)}</td>
                <td>{r.user?.full_name ?? '—'}</td>
                <td>{MOVEMENT_LABEL[r.movement] ?? r.movement}</td>
                <td>
                  {r.pet ? (
                    group === 'rewards' ? (
                      <button
                        className="link-btn"
                        onClick={() => filterByCase(r.pet!.id, r.pet!.name)}
                      >
                        {r.pet.name}
                      </button>
                    ) : (
                      r.pet.name
                    )
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
                <td className={`num ${INFLOW.has(r.movement) ? 'amount-pos' : 'amount-neg'}`}>
                  {brl(r.amount)}
                </td>
                {showFee && (
                  <td className="num">{r.fee != null && r.fee > 0 ? brl(r.fee) : '—'}</td>
                )}
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="desc-cell">{r.description ?? '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pagination">
        <span className="muted-text">
          {total} lançamento(s) — página {page + 1} de {totalPages}
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
    </>
  );
}

function ExtratoSection() {
  const [tab, setTab] = useState<'rewards' | 'fees' | 'premium'>('rewards');
  return (
    <section className="fin-section">
      <h2>Extrato</h2>
      <div className="tabs">
        <button
          className={'tab' + (tab === 'rewards' ? ' active' : '')}
          onClick={() => setTab('rewards')}
        >
          Recompensas e Saques
        </button>
        <button
          className={'tab' + (tab === 'fees' ? ' active' : '')}
          onClick={() => setTab('fees')}
        >
          Taxas
        </button>
        <button
          className={'tab' + (tab === 'premium' ? ' active' : '')}
          onClick={() => setTab('premium')}
        >
          Premium
        </button>
      </div>
      <LedgerView key={tab} group={tab} />
    </section>
  );
}

export function Financeiro() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');

  const loadSummary = useCallback(() => {
    setSummaryError('');
    api
      .financeSummary()
      .then(setSummary)
      .catch((e) =>
        setSummaryError(e instanceof Error ? e.message : 'Falha ao carregar o resumo')
      );
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  return (
    <div className="page">
      <h1>Financeiro</h1>
      <p className="page-desc">
        Resumo, extrato e controle de saques — cada movimento ligado ao seu caso.
      </p>

      {summaryError && <div className="alert error">{summaryError}</div>}
      <KpiCards summary={summary} />

      <WithdrawalsSection onSettled={loadSummary} />
      <ExtratoSection />
    </div>
  );
}
