import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ReportDetail, ReportProfile } from '../lib/api';
import { REPORT_STATUS_LABEL } from './Denuncias';
import { TYPE_LABEL, PET_STATUS_LABEL } from './Casos';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const USER_STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  banned: 'Banido',
};

function PartyCard({
  title,
  user,
  onView,
  highlight,
}: {
  title: string;
  user: ReportProfile | null;
  onView: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className="stat-card"
      style={highlight ? { borderColor: 'var(--accent)', borderWidth: 2 } : undefined}
    >
      <span className="stat-label">{title}</span>
      {user ? (
        <>
          <div className="user-cell" style={{ marginTop: 4 }}>
            {user.photo_url ? (
              <img src={user.photo_url} alt="" className="avatar" />
            ) : (
              <span className="avatar avatar-empty">
                {(user.full_name ?? '?').charAt(0)}
              </span>
            )}
            <div>
              <div className="user-name">{user.full_name ?? '—'}</div>
              <div className="muted-text">{user.email ?? ''}</div>
            </div>
          </div>
          <div className="detail-badges" style={{ marginTop: 6 }}>
            <span className={`badge badge-${user.status}`}>
              {USER_STATUS_LABEL[user.status] ?? user.status}
            </span>
            {user.is_admin && <span className="badge badge-pending">Admin</span>}
          </div>
          <button className="btn-mini btn-clear" style={{ marginTop: 10 }} onClick={onView}>
            Ver perfil
          </button>
        </>
      ) : (
        <span className="muted-text">—</span>
      )}
    </div>
  );
}

export function DenunciaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    api
      .reportDetail(id)
      .then((d) => {
        setData(d);
        setStatus(d.report.status);
        setNotes(d.report.admin_notes ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar denúncia'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!id) return;
    setSaving(true);
    setSavedOk(false);
    try {
      await api.updateReport(id, { status, admin_notes: notes.trim() || null });
      setSavedOk(true);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <p className="muted-text">Carregando…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <button className="link-btn" onClick={() => navigate('/denuncias')}>
          ← Voltar para denúncias
        </button>
        <div className="alert error">{error || 'Denúncia não encontrada.'}</div>
      </div>
    );
  }

  const r = data.report;

  return (
    <div className="page">
      <button className="link-btn" onClick={() => navigate('/denuncias')}>
        ← Voltar para denúncias
      </button>

      <div className="ticket-head">
        <h1>{r.reason}</h1>
        <span className={`badge rep-${r.status}`}>
          {REPORT_STATUS_LABEL[r.status] ?? r.status}
        </span>
      </div>
      <p className="page-desc">Aberta em {fmtDateTime(r.created_at)}</p>

      <div className="card-grid">
        <PartyCard
          title="Denunciante"
          user={data.reporter}
          onView={() => navigate(`/usuarios/${r.reporter_id}`)}
        />
        <PartyCard
          title="Denunciado"
          user={data.reported}
          onView={() => navigate(`/usuarios/${r.reported_id}`)}
          highlight
        />
      </div>

      {data.pet && (
        <section className="fin-section">
          <h2>Caso ligado</h2>
          <div
            className="stat-card row-clickable"
            onClick={() => navigate(`/casos/${data.pet!.id}`)}
          >
            <div className="user-cell">
              {data.pet.main_photo_url ? (
                <img src={data.pet.main_photo_url} alt="" className="avatar" />
              ) : (
                <span className="avatar avatar-empty">
                  {(data.pet.name ?? '?').charAt(0)}
                </span>
              )}
              <div>
                <div className="user-name">{data.pet.name}</div>
                <div className="detail-badges" style={{ marginTop: 4 }}>
                  <span className={`badge type-${data.pet.type}`}>
                    {TYPE_LABEL[data.pet.type] ?? data.pet.type}
                  </span>
                  <span className={`badge petst-${data.pet.status}`}>
                    {PET_STATUS_LABEL[data.pet.status] ?? data.pet.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {data.messages.length > 0 && (
        <section className="fin-section">
          <h2>
            Mensagens do chat <span className="count-pill">{data.messages.length}</span>
          </h2>
          <div className="ticket-thread">
            {data.messages.map((m) => {
              const isReporter = m.sender_id === r.reporter_id;
              const isReported = m.sender_id === r.reported_id;
              const role = isReported
                ? 'role-user'
                : isReporter
                  ? 'role-support'
                  : 'role-assistant';
              const label = isReported
                ? 'Denunciado'
                : isReporter
                  ? 'Denunciante'
                  : 'Outro';
              return (
                <div key={m.id} className={`ticket-msg ${role}`}>
                  <div className="ticket-msg-head">
                    <span className="ticket-role">{label}</span>
                    <span className="ticket-time">{fmtDateTime(m.created_at)}</span>
                  </div>
                  {m.content && <div className="ticket-msg-body">{m.content}</div>}
                  {m.photo_url && (
                    <a href={m.photo_url} target="_blank" rel="noreferrer">
                      <img
                        src={m.photo_url}
                        alt=""
                        className="photo-thumb"
                        style={{ marginTop: 6, width: 120, height: 120 }}
                      />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="fin-section">
        <h2>Triagem</h2>
        <div className="filters">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(REPORT_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field-block">
          Notas internas (não visíveis ao usuário)
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSavedOk(false);
            }}
            rows={3}
            placeholder="O que foi feito? (ex.: usuário denunciado bloqueado, caso pausado…)"
          />
        </label>
        <button className="btn-save" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar triagem'}
        </button>
        {savedOk && (
          <span className="muted-text" style={{ marginLeft: 10 }}>
            Triagem salva.
          </span>
        )}
      </section>
    </div>
  );
}
