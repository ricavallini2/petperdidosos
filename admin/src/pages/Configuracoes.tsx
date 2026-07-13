import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Configuracoes() {
  const [pixKey, setPixKey] = useState('');
  const [url, setUrl] = useState('');

  const [threshPct, setThreshPct] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [savedThresh, setSavedThresh] = useState<number | null>(null);
  const [savedRadius, setSavedRadius] = useState<number | null>(null);

  const [raRadiusKm, setRaRadiusKm] = useState('');
  const [raCooldownH, setRaCooldownH] = useState('');
  const [raReports, setRaReports] = useState('');

  const [loading, setLoading] = useState(true);
  const [savingDonation, setSavingDonation] = useState(false);
  const [savingMatch, setSavingMatch] = useState(false);
  const [savingRegion, setSavingRegion] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setPixKey(s.donationPixKey ?? '');
        setUrl(s.donationUrl ?? '');
        if (s.matchThreshold != null) {
          setSavedThresh(s.matchThreshold);
          setThreshPct(String(Number((s.matchThreshold * 100).toFixed(0))));
        }
        if (s.matchRadiusM != null) {
          setSavedRadius(s.matchRadiusM);
          setRadiusKm(String(Number((s.matchRadiusM / 1000).toFixed(1))));
        }
        if (s.regionAlertRadiusM != null) setRaRadiusKm(String(Number((s.regionAlertRadiusM / 1000).toFixed(2))));
        if (s.regionAlertCooldownH != null) setRaCooldownH(String(s.regionAlertCooldownH));
        if (s.regionAlertReportsToDeactivate != null) setRaReports(String(s.regionAlertReportsToDeactivate));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  const saveDonation = async () => {
    setError('');
    setOk('');
    const u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) {
      setError('O link de doação deve começar com http(s):// ou ficar vazio.');
      return;
    }
    setSavingDonation(true);
    try {
      const res = await api.updateSettings({ donationPixKey: pixKey.trim(), donationUrl: u });
      setPixKey(res.donationPixKey ?? '');
      setUrl(res.donationUrl ?? '');
      setOk('Configuração de doação atualizada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSavingDonation(false);
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

  const saveRegionAlert = async () => {
    setError('');
    setOk('');
    const km = Number(raRadiusKm.replace(',', '.'));
    const h = Number(raCooldownH.replace(',', '.'));
    const n = Number(raReports.replace(',', '.'));
    if (!Number.isFinite(km) || km < 0.5 || km > 200) {
      setError('O raio do alerta deve estar entre 0,5 e 200 km.');
      return;
    }
    if (!Number.isInteger(h) || h < 1 || h > 168) {
      setError('O intervalo entre alertas deve ser um número inteiro de horas entre 1 e 168.');
      return;
    }
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setError('As denúncias para desativar devem ser um número inteiro entre 1 e 100.');
      return;
    }
    setSavingRegion(true);
    try {
      const res = await api.updateSettings({
        regionAlertRadiusM: Math.round(km * 1000),
        regionAlertCooldownH: h,
        regionAlertReportsToDeactivate: n,
      });
      if (res.regionAlertRadiusM != null) setRaRadiusKm(String(Number((res.regionAlertRadiusM / 1000).toFixed(2))));
      if (res.regionAlertCooldownH != null) setRaCooldownH(String(res.regionAlertCooldownH));
      if (res.regionAlertReportsToDeactivate != null) setRaReports(String(res.regionAlertReportsToDeactivate));
      setOk('Alerta de região atualizado com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSavingRegion(false);
    }
  };

  return (
    <div className="page">
      <h1>Configurações</h1>
      <p className="page-desc">Parâmetros globais usados pelo app.</p>

      <section className="fin-section">
        <h2>Doação voluntária</h2>
        <p className="muted-text" style={{ marginBottom: 14 }}>
          Ao concluir um reencontro, o app oferece uma doação <strong>opcional</strong> para apoiar o
          projeto. O pagamento é feito diretamente pelo usuário (o app não intermedia). Deixe os
          campos em branco para não exibir o convite.
        </p>

        {loading ? (
          <p className="muted-text">Carregando…</p>
        ) : (
          <div className="setting-card">
            <label className="setting-field">
              Chave Pix
              <input
                type="text"
                value={pixKey}
                onChange={(e) => { setPixKey(e.target.value); setOk(''); }}
                disabled={savingDonation}
                placeholder="e-mail, telefone, CPF ou chave aleatória"
              />
            </label>
            <label className="setting-field">
              Link de doação (opcional)
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setOk(''); }}
                disabled={savingDonation}
                placeholder="https://..."
              />
            </label>
            <button className="btn-save" onClick={saveDonation} disabled={savingDonation}>
              {savingDonation ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
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

      <section className="fin-section">
        <h2>Alerta de região</h2>
        <p className="muted-text" style={{ marginBottom: 14 }}>
          Quando um tutor destaca um pet perdido, avisamos os buscadores próximos (push + no app).
          O <strong>raio</strong> define quem recebe; o <strong>intervalo</strong> limita quantas vezes
          o mesmo caso pode ser destacado; as <strong>denúncias</strong> desativam o alerta e o enviam
          para revisão do administrativo.
        </p>

        {loading ? (
          <p className="muted-text">Carregando…</p>
        ) : (
          <div className="setting-card">
            <label className="setting-field">
              Raio do alerta (km)
              <input
                type="number"
                min={0.5}
                max={200}
                step={0.5}
                value={raRadiusKm}
                onChange={(e) => { setRaRadiusKm(e.target.value); setOk(''); }}
                disabled={savingRegion}
              />
            </label>
            <label className="setting-field">
              Intervalo mínimo entre alertas (horas)
              <input
                type="number"
                min={1}
                max={168}
                step={1}
                value={raCooldownH}
                onChange={(e) => { setRaCooldownH(e.target.value); setOk(''); }}
                disabled={savingRegion}
              />
            </label>
            <label className="setting-field">
              Denúncias para desativar
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={raReports}
                onChange={(e) => { setRaReports(e.target.value); setOk(''); }}
                disabled={savingRegion}
              />
            </label>
            <button className="btn-save" onClick={saveRegionAlert} disabled={savingRegion}>
              {savingRegion ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        )}
      </section>

      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}
    </div>
  );
}
