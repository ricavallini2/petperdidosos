import { useCallback, useEffect, useState } from 'react';
import { api, AppReleaseState } from '../lib/api';
import { confirmDialog, toast } from '../lib/ui';

const fmtBytes = (n: number | null) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function Atualizacoes() {
  const [state, setState] = useState<AppReleaseState | null>(null);
  const [loadErr, setLoadErr] = useState('');

  const [apkUrl, setApkUrl] = useState('');
  const [versionName, setVersionName] = useState('');
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notifying, setNotifying] = useState(false);

  const load = useCallback(() => {
    setLoadErr('');
    api
      .appRelease()
      .then(setState)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = state?.manifest;

  const publish = async () => {
    if (!/^https:\/\/expo\.dev\/artifacts\//.test(apkUrl.trim())) {
      toast.error('O link deve ser um artefato do EAS (https://expo.dev/artifacts/…).');
      return;
    }
    const ok = await confirmDialog({
      title: 'Publicar atualização',
      message: `O APK será baixado do EAS, a versão lida automaticamente de dentro dele e disponibilizada para os usuários${mandatory ? ' como atualização OBRIGATÓRIA' : ''}. Continuar?`,
      confirmLabel: 'Publicar',
    });
    if (!ok) return;

    setPublishing(true);
    try {
      const res = await api.publishRelease({
        apkUrl: apkUrl.trim(),
        versionName: versionName.trim() || undefined,
        notes: notes.trim(),
        mandatory,
      });
      toast.success(
        `Versão ${res.manifest.versionName} (build ${res.manifest.version}) publicada!`
      );
      setApkUrl('');
      setNotes('');
      setVersionName('');
      setMandatory(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao publicar');
    } finally {
      setPublishing(false);
    }
  };

  const notify = async () => {
    const ok = await confirmDialog({
      title: 'Avisar usuários',
      message: 'Enviar uma notificação a todos os usuários avisando da nova versão?',
      confirmLabel: 'Notificar',
    });
    if (!ok) return;
    setNotifying(true);
    try {
      const res = await api.notifyRelease();
      toast.success(`Notificação enviada para ${res.count} usuário(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao notificar');
    } finally {
      setNotifying(false);
    }
  };

  return (
    <div className="page">
      <h1>Atualizações do App</h1>
      <p className="page-desc">
        Publique uma nova versão do APK direto do painel — o servidor baixa o artefato do
        EAS e atualiza o manifesto. Sem SSH.
      </p>

      {loadErr && <div className="alert error">{loadErr}</div>}

      <div className="release-grid">
        {/* Versão publicada */}
        <div className="panel">
          <div className="panel-head">
            <h3>Versão publicada</h3>
            {current?.mandatory && <span className="badge rep-pending">Obrigatória</span>}
          </div>
          {!state ? (
            <p className="muted-text">Carregando…</p>
          ) : !current ? (
            <p className="empty-state">Nenhuma versão publicada ainda.</p>
          ) : (
            <>
              <div className="release-version">
                <span className="release-name">{current.versionName}</span>
                <span className="release-code">build {current.version}</span>
              </div>
              <div className="card-grid" style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="stat-card">
                  <span className="stat-label">Tamanho do APK</span>
                  <span className="stat-value stat-value-sm">{fmtBytes(state.apkSize)}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Publicado em</span>
                  <span className="stat-value stat-value-sm">{fmtDateTime(state.apkUpdatedAt)}</span>
                </div>
              </div>
              {current.notes && (
                <div className="notice" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
                  {current.notes}
                </div>
              )}
              <button
                className="btn-mini btn-clear"
                style={{ marginTop: 14 }}
                onClick={notify}
                disabled={notifying}
              >
                {notifying ? 'Enviando…' : 'Avisar usuários sobre esta versão'}
              </button>
            </>
          )}
        </div>

        {/* Publicar nova versão */}
        <div className="panel">
          <div className="panel-head">
            <h3>Publicar nova versão</h3>
          </div>

          <label className="field-block">
            Link do APK (artefato do EAS)
            <input
              type="text"
              value={apkUrl}
              placeholder="https://expo.dev/artifacts/eas/…"
              onChange={(e) => setApkUrl(e.target.value)}
              className="release-input"
            />
          </label>

          <label className="field-block">
            Nome da versão (opcional)
            <input
              type="text"
              value={versionName}
              placeholder="lido do APK (ex.: 1.0.2)"
              onChange={(e) => setVersionName(e.target.value)}
              className="release-input"
            />
          </label>

          <div className="notice" style={{ marginBottom: 12 }}>
            ✅ A <strong>versão (build)</strong> é lida automaticamente de dentro do APK
            (<code>extra.appBuild</code>) — você não precisa digitar. O app só oferece a
            atualização para quem tem um build <strong>menor</strong> que o do APK
            publicado.
          </div>

          <label className="field-block">
            Novidades (uma por linha)
            <textarea
              value={notes}
              rows={4}
              placeholder={'Correções de estabilidade\nNovo filtro no mapa'}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          <label className="release-toggle">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
            />
            Atualização obrigatória (o app exige atualizar antes de continuar)
          </label>

          <button className="btn-save" onClick={publish} disabled={publishing}>
            {publishing ? 'Baixando e publicando…' : 'Publicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
