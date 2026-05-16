import { useEffect, useState } from 'react';
import { api, AdminOverview } from '../lib/api';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function Dashboard() {
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

  return (
    <div className="page">
      <h1>Visão geral</h1>
      <p className="page-desc">Resumo de usuários, assinaturas, chamados e financeiro.</p>

      {error && <div className="alert error">{error}</div>}

      <div className="card-grid">
        <div className="stat-card">
          <span className="stat-label">Usuários</span>
          <span className="stat-value">{num(data?.users)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Usuários ativos (24h)</span>
          <span className="stat-value">{num(data?.activeUsers24h)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Assinantes Premium</span>
          <span className="stat-value">{num(data?.premiumActive)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Premium vitalícios</span>
          <span className="stat-value">{num(data?.premiumLifetime)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Recompensas ativas</span>
          <span className="stat-value">{brl(data?.activeRewardsTotal)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Chamados abertos</span>
          <span className="stat-value">{num(data?.openTickets)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Receita do mês</span>
          <span className="stat-value">{brl(data?.revenueMonth)}</span>
        </div>
      </div>

      {!loading && data?.openTickets == null && (
        <div className="notice">
          A contagem de chamados abertos ficará disponível quando o módulo de
          <code>Chamados</code> for implementado.
        </div>
      )}
    </div>
  );
}
