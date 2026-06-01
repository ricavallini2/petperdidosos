import { useEffect, useState } from 'react';
import { api, Analytics } from '../lib/api';
import { AreaChart, StackedBars, DistBars } from '../components/Charts';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n: number) => BRL.format(n);

// "2026-05-30" → "30/05" ; "2026-05" → "mai/26"
const dayShort = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthShort = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

const TYPE_LABEL: Record<string, string> = {
  lost: 'Perdidos',
  sighted: 'Vistos',
  rescued: 'Resgatados',
};
const STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativos',
  pausado: 'Pausados',
  encontrado: 'Encontrados',
  cancelado: 'Cancelados',
};
const SPECIES_LABEL: Record<string, string> = {
  cachorro: 'Cachorros',
  gato: 'Gatos',
  passaro: 'Pássaros',
  outro: 'Outros',
};

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {sub && <span className="panel-sub">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function toSlices(map: Record<string, number>, labels: Record<string, string>, colors: string[]) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({
      label: labels[k] ?? k,
      value: v,
      color: colors[i % colors.length],
    }));
}

export function Analises() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .analytics()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar análises'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page">
        <h1>Análises</h1>
        <p className="page-desc">Tendências e distribuições da plataforma.</p>
        <div className="panel-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="panel" key={i}>
              <div className="skeleton skeleton-row" style={{ width: '40%' }} />
              <div className="skeleton" style={{ height: 150, marginTop: 12 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <h1>Análises</h1>
        <div className="alert error">{error || 'Sem dados.'}</div>
      </div>
    );
  }

  const signupTotal = data.signups.reduce((s, d) => s + d.count, 0);
  const revenueTotal = data.revenue.reduce((s, d) => s + d.total, 0);
  const ACCENT = ['var(--accent)', 'var(--blue)', 'var(--green)', 'var(--amber)', 'var(--muted-2)'];

  return (
    <div className="page">
      <h1>Análises</h1>
      <p className="page-desc">Tendências e distribuições da plataforma.</p>

      <div className="panel-grid">
        <Panel title="Novos usuários" sub={`${signupTotal} nos últimos 30 dias`}>
          <AreaChart
            data={data.signups.map((d) => ({ label: dayShort(d.day), value: d.count }))}
            color="var(--accent)"
          />
        </Panel>

        <Panel title="Receita por mês" sub={`${brl(revenueTotal)} em 6 meses`}>
          <StackedBars
            data={data.revenue.map((r) => ({
              label: monthShort(r.month),
              fee: r.fee,
              premium: r.premium,
            }))}
            series={[
              { key: 'fee', label: 'Taxas', color: 'var(--green)' },
              { key: 'premium', label: 'Premium', color: 'var(--blue)' },
            ]}
            formatValue={(n) => brl(n)}
          />
        </Panel>

        <Panel title="Novos casos por dia" sub="Últimos 14 dias, por tipo">
          <StackedBars
            data={data.cases.map((c) => ({
              label: dayShort(c.day),
              lost: c.lost,
              sighted: c.sighted,
              rescued: c.rescued,
            }))}
            series={[
              { key: 'lost', label: 'Perdidos', color: 'var(--accent)' },
              { key: 'sighted', label: 'Vistos', color: 'var(--amber)' },
              { key: 'rescued', label: 'Resgatados', color: 'var(--green)' },
            ]}
          />
        </Panel>

        <Panel title="Conversão Premium" sub={`${data.premiumFunnel.conversion}% dos usuários`}>
          <div className="funnel">
            <div className="funnel-big">{data.premiumFunnel.conversion}%</div>
            <div className="funnel-detail">
              <div>
                <strong>{data.premiumFunnel.premium}</strong> assinantes
              </div>
              <div className="muted-text">de {data.premiumFunnel.total} usuários</div>
            </div>
          </div>
          <DistBars
            data={[
              { label: 'Premium', value: data.premiumFunnel.premium, color: 'var(--blue)' },
              {
                label: 'Free',
                value: data.premiumFunnel.total - data.premiumFunnel.premium,
                color: 'var(--muted-2)',
              },
            ]}
          />
        </Panel>

        <Panel title="Casos por tipo">
          <DistBars data={toSlices(data.casesByType, TYPE_LABEL, ACCENT)} />
        </Panel>

        <Panel title="Casos por status">
          <DistBars data={toSlices(data.casesByStatus, STATUS_LABEL, ACCENT)} />
        </Panel>

        <Panel title="Casos por espécie">
          <DistBars data={toSlices(data.casesBySpecies, SPECIES_LABEL, ACCENT)} />
        </Panel>

        <Panel title="Top resgatadores" sub="Quem mais ajudou a encontrar pets">
          {data.topFinders.length === 0 ? (
            <p className="muted-text">Nenhum resgate ainda.</p>
          ) : (
            <div className="ranking">
              {data.topFinders.map((f, i) => (
                <div className="ranking-row" key={i}>
                  <span className="ranking-pos">{i + 1}</span>
                  <span className="ranking-name">{f.name}</span>
                  <span className="ranking-val">{f.rescues}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
