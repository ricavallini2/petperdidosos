import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Configuracoes() {
  const [percent, setPercent] = useState('');
  const [savedRate, setSavedRate] = useState<number | null>(null);

  const [threshPct, setThreshPct] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [savedThresh, setSavedThresh] = useState<number | null>(null);
  const [savedRadius, setSavedRadius] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingFee, setSavingFee] = useState(false);
  const [savingMatch, setSavingMatch] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSavedRate(s.feeRate);
        setPercent(String(Number((s.feeRate * 100).toFixed(2))));
        if (s.matchThreshold != null) {
          setSavedThresh(s.matchThreshold);
          setThreshPct(String(Number((s.matchThreshold * 100).toFixed(0))));
        }
        if (s.matchRadiusM != null) {
          setSavedRadius(s.matchRadiusM);
          setRadiusKm(String(Number((s.matchRadiusM / 1000).toFixed(1))));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  const saveFee = async () => {
    setError('');
    setOk('');
    const pct = Number(percent.replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError('Informe uma porcentagem entre 0 e 100.');
      return;
    }
    setSavingFee(true);
    try {
      const res = await api.updateSettings({ feeRate: pct / 100 });
      setSavedRate(res.feeRate);
      setPercent(String(Number((res.feeRate * 100).toFixed(2))));
      setOk('Taxa atualizada com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSavingFee(false);
    }
  };

  const saveMatch = async () => {
    setError('');
    setOk('');
    const t = Number(threshPct.replace(',', '.'));
    const km = Number(radiusKm.replace(',', '.'));
    if (!Number.isFinite(t) || t < 0 || t > 100) {
      setError('O limiar deve ser uma porcentagem entre 0 e 100.');
      return;
    }
    if (!Number.isFinite(km) || km <= 0 || km > 500) {
      setError('O raio deve estar entre 0,1 e 500 km.');
      return;
    }
    setSavingMatch(true);
    try {
      const res = await api.updateSettings({ matchThreshold: t / 100, matchRadiusM: Math.round(km * 1000) });
      if (res.matchThreshold != null) {
        setSavedThresh(res.matchThreshold);
        setThreshPct(String(Number((res.matchThreshold * 100).toFixed(0))));
      }
      if (res.matchRadiusM != null) {
        setSavedRadius(res.matchRadiusM);
        setRadiusKm(String(Number((res.matchRadiusM / 1000).toFixed(1))));
      }
      setOk('Reconhecimento facial atualizado com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSavingMatch(false);
    }
  };

  return (
    <div className="page">
      <h1>Configurações</h1>
      <p className="page-desc">Parâmetros globais usados pelo app.</p>

      <section className="fin-section">
        <h2>Taxa administrativa</h2>
        <p className="muted-text" style={{ marginBottom: 14 }}>
          Percentual cobrado sobre cada recompensa. O app usa este valor ao calcular
          a taxa na criação e no aumento de recompensas.
        </p>

        {loading ? (
          <p className="muted-text">Carregando…</p>
        ) : (
          <>
            <div className="setting-card">
              <label className="setting-field">
                Taxa (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={percent}
                  onChange={(e) => { setPercent(e.target.value); setOk(''); }}
                  disabled={savingFee}
                />
              </label>
              <button className="btn-save" onClick={saveFee} disabled={savingFee}>
                {savingFee ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            {savedRate != null && (
              <p className="muted-text" style={{ marginTop: 10 }}>
                Valor atualmente aplicado:{' '}
                <strong>{Number((savedRate * 100).toFixed(2)).toLocaleString('pt-BR')}%</strong>
              </p>
            )}
          </>
        )}
      </section>

      <section className="fin-section">
        <h2>Reconhecimento facial</h2>
        <p className="muted-text" style={{ marginBottom: 14 }}>
          Usado quando alguém publica um pet visto/resgatado e verifica se há um pet
          perdido parecido na região. O <strong>limiar</strong> é a similaridade mínima
          para um match; o <strong>raio</strong> limita a distância da busca.
        </p>

        {loading ? (
          <p className="muted-text">Carregando…</p>
        ) : (
          <>
            <div className="setting-card">
              <label className="setting-field">
                Limiar de match (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={threshPct}
                  onChange={(e) => { setThreshPct(e.target.value); setOk(''); }}
                  disabled={savingMatch}
                />
              </label>
              <label className="setting-field">
                Raio de busca (km)
                <input
                  type="number"
                  min={0.1}
                  max={500}
                  step={0.5}
                  value={radiusKm}
                  onChange={(e) => { setRadiusKm(e.target.value); setOk(''); }}
                  disabled={savingMatch}
                />
              </label>
              <button className="btn-save" onClick={saveMatch} disabled={savingMatch}>
                {savingMatch ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            {savedThresh != null && savedRadius != null && (
              <p className="muted-text" style={{ marginTop: 10 }}>
                Em uso: limiar <strong>{Number((savedThresh * 100).toFixed(0))}%</strong> · raio{' '}
                <strong>{Number((savedRadius / 1000).toFixed(1))} km</strong>
              </p>
            )}
          </>
        )}
      </section>

      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}
    </div>
  );
}
