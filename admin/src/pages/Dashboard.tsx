import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, AdminOverview } from '../lib/api';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .overview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  const num = (v: number | null | undefined) =>
    loading ? '…' : v == null ? '—' : v.toLocaleString('pt-BR');
  const brl = (v: number | null | undefined) =>
    loading ? '…' : v == null ? '—' : BRL.format(v);

  // Itens que precisam de atenção do admin (só os com pendência > 0)
  const actions = data
    ? [
        {
          key: 'withdraw',
          count: data.withdrawPendingCount,
          label: 'Saques a processar',
          detail: BRL.format(data.withdrawPendingTotal),
          to: '/financeiro',
        },
        {
          key: 'reports',
          count: data.openReports,
          label: 'Denúncias abertas',
          detail: 'Moderar',
          to: '/denuncias',
        },
        {
          key: 'tickets',
          count: data.openTickets ?? 0,
          label: 'Chamados abertos',
          detail: 'Responder',
          to: '/chamados',
        },
        {
          key: 'sightings',
          count: data.sightingsPending,
          label: 'Avistamentos pendentes',
          detail: 'Revisar',
          to: '/avistamentos',
        },
      ].filter((a) => a.count > 0)
    : [];

  return (
    <div className="page">
      <h1>Visão geral</h1>
      <p className="page-desc">
        Panorama operacional do PetPerdidoSOS — pessoas, casos, atendimento e receita.
      </p>

      {error && <div className="alert error">{error}</div>}

      {actions.length > 0 && (
        <section className="fin-section" style={{ marginTop: 0 }}>
          <h2>Precisa da sua atenção</h2>
          <div className="action-grid">
            {actions.map((a) => (
              <button key={a.key} className="action-card" onClick={() => navigate(a.to)}>
                <span className="action-count">{a.count}</span>
                <span className="action-info">
                  <span className="action-label">{a.label}</span>
                  <span className="action-detail">{a.detail}</span>
                </span>
                <span className="action-arrow">→</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="fin-section">
        <h2>Comunidade</h2>
        <div className="card-grid">
          <Card label="Usuários" value={num(data?.users)} />
          <Card label="Ativos (últimas 24h)" value={num(data?.activeUsers24h)} />
          <Card
            label="Assinantes Premium"
            value={num(data?.premiumActive)}
            sub={
              data?.premiumLifetime != null
                ? `${data.premiumLifetime} vitalício(s)`
                : undefined
            }
          />
        </div>
      </section>

      <section className="fin-section">
        <h2>Operação</h2>
        <div className="card-grid">
          <Card label="Casos ativos" value={num(data?.activeCases)} />
          <Card label="Resolvidos no mês" value={num(data?.resolvedThisMonth)} />
          <Card label="Doações ativas" value={num(data?.activeDonations)} />
          <Card label="Adoções no mês" value={num(data?.adoptionsThisMonth)} />
        </div>
      </section>

      <section className="fin-section">
        <h2>Atendimento</h2>
        <div className="card-grid">
          <Card label="Avistamentos pendentes" value={num(data?.sightingsPending)} />
          <Card label="Denúncias abertas" value={num(data?.openReports)} />
          <Card label="Chamados abertos" value={num(data?.openTickets)} />
        </div>
      </section>

      <section className="fin-section">
        <h2>Receita</h2>
        <div className="card-grid">
          <Card label="Receita do mês" value={brl(data?.revenueMonth)} />
          <Card label="Recompensas em garantia" value={brl(data?.activeRewardsTotal)} />
        </div>
      </section>
    </div>
  );
}
