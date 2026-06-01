// Gráficos em SVG puro — sem dependências externas. Usam currentColor e as
// variáveis de tema, então se adaptam ao dark mode automaticamente.

interface AreaPoint {
  label: string;
  value: number;
}

// Gráfico de linha/área para uma série temporal.
export function AreaChart({
  data,
  height = 160,
  color = 'var(--accent)',
  formatValue = (n: number) => String(n),
}: {
  data: AreaPoint[];
  height?: number;
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const W = 600;
  const H = height;
  const pad = { t: 12, r: 12, b: 22, l: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const x = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.value)}`).join(' ');
  const area = `${line} L ${x(n - 1)} ${pad.t + innerH} L ${x(0)} ${pad.t + innerH} Z`;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ color }} role="img">
      {[0.5, 1].map((f) => (
        <line
          key={f}
          x1={pad.l}
          x2={W - pad.r}
          y1={pad.t + innerH - f * innerH}
          y2={pad.t + innerH - f * innerH}
          className="chart-grid"
        />
      ))}
      <text x={pad.l} y={pad.t + 4} className="chart-axis" textAnchor="end" dx={-4}>
        {formatValue(max)}
      </text>
      {total > 0 && (
        <>
          <path d={area} fill="currentColor" opacity={0.12} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" />
          {data.map((d, i) => (
            <circle key={i} cx={x(i)} cy={y(d.value)} r={n > 40 ? 0 : 2.5} fill="currentColor">
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </circle>
          ))}
        </>
      )}
      {total === 0 && (
        <text x={W / 2} y={H / 2} className="chart-empty" textAnchor="middle">
          sem dados no período
        </text>
      )}
      <text x={pad.l} y={H - 4} className="chart-axis">
        {data[0]?.label}
      </text>
      <text x={W - pad.r} y={H - 4} className="chart-axis" textAnchor="end">
        {data[n - 1]?.label}
      </text>
    </svg>
  );
}

interface StackSeries {
  key: string;
  color: string;
  label: string;
}

// Gráfico de barras empilhadas para séries categóricas no tempo.
export function StackedBars({
  data,
  series,
  height = 180,
  formatValue = (n: number) => String(n),
}: {
  data: Array<{ label: string; [key: string]: string | number }>;
  series: StackSeries[];
  height?: number;
  formatValue?: (n: number) => string;
}) {
  const W = 600;
  const H = height;
  const pad = { t: 12, r: 12, b: 24, l: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const num = (d: { [key: string]: string | number }, k: string) => Number(d[k] || 0);
  const totals = data.map((d) => series.reduce((s, sr) => s + num(d, sr.key), 0));
  const max = Math.max(1, ...totals);
  const n = data.length;
  const slot = innerW / n;
  const barW = Math.min(slot * 0.62, 30);
  const grand = totals.reduce((s, t) => s + t, 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad.l}
            x2={W - pad.r}
            y1={pad.t + innerH - f * innerH}
            y2={pad.t + innerH - f * innerH}
            className="chart-grid"
          />
        ))}
        <text x={pad.l} y={pad.t + 4} className="chart-axis" textAnchor="end" dx={-4}>
          {formatValue(max)}
        </text>
        {grand === 0 && (
          <text x={W / 2} y={H / 2} className="chart-empty" textAnchor="middle">
            sem dados no período
          </text>
        )}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={i}>
              {series.map((sr) => {
                const v = num(d, sr.key);
                if (v <= 0) return null;
                const h = (v / max) * innerH;
                const yTop = pad.t + innerH - acc - h;
                acc += h;
                return (
                  <rect
                    key={sr.key}
                    x={cx - barW / 2}
                    y={yTop}
                    width={barW}
                    height={h}
                    rx={2}
                    fill={sr.color}
                  >
                    <title>{`${d.label} · ${sr.label}: ${formatValue(v)}`}</title>
                  </rect>
                );
              })}
              {(n <= 16 || i % 2 === 0) && (
                <text x={cx} y={H - 6} className="chart-axis" textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((sr) => (
          <span key={sr.key} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: sr.color }} />
            {sr.label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Slice {
  label: string;
  value: number;
  color: string;
}

// Barras horizontais para distribuições (categoria → contagem).
export function DistBars({ data }: { data: Slice[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="muted-text">Sem dados.</p>;
  return (
    <div className="dist">
      {data.map((d) => (
        <div key={d.label} className="dist-row">
          <span className="dist-label">{d.label}</span>
          <span className="dist-track">
            <span
              className="dist-fill"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color }}
            />
          </span>
          <span className="dist-value">{d.value}</span>
        </div>
      ))}
    </div>
  );
}
