import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, CasoDetail } from '../lib/api';
import { SPECIES_LABEL } from './Casos';
import { DONATION_STATUS_LABEL } from './Doacoes';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const SEX_LABEL: Record<string, string> = {
  macho: 'Macho',
  femea: 'Fêmea',
  desconhecido: '—',
};
const AGE_LABEL: Record<string, string> = {
  filhote: 'Filhote',
  adulto: 'Adulto',
  idoso: 'Idoso',
  desconhecido: '—',
};
const SIZE_LABEL: Record<string, string> = {
  pequeno: 'Pequeno',
  medio: 'Médio',
  grande: 'Grande',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value stat-value-sm">{value}</span>
    </div>
  );
}

export function DoacaoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CasoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    api
      .casoDetail(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar a doação'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (newStatus: string, action: string) => {
    if (!id || !data) return;
    if (!window.confirm(`${action} a doação de ${data.pet.name}?`)) return;
    setChanging(true);
    try {
      await api.setCasoStatus(id, newStatus);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao alterar o status');
    } finally {
      setChanging(false);
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
        <button className="link-btn" onClick={() => navigate('/doacoes')}>
          ← Voltar para doações
        </button>
        <div className="alert error">{error || 'Doação não encontrada.'}</div>
      </div>
    );
  }

  const p = data.pet;
  const t = data.tutor;
  const a = data.adopter;

  return (
    <div className="page">
      <button className="link-btn" onClick={() => navigate('/doacoes')}>
        ← Voltar para doações
      </button>

      <div className="detail-header">
        {p.main_photo_url ? (
          <img src={p.main_photo_url} alt="" className="avatar avatar-lg" />
        ) : (
          <span className="avatar avatar-lg avatar-empty">
            {(p.name ?? '?').charAt(0)}
          </span>
        )}
        <div className="detail-header-info">
          <h1>{p.name}</h1>
          <div className="detail-badges">
            <span className="badge type-donation">Doação</span>
            <span className={`badge dn-${p.status}`}>
              {DONATION_STATUS_LABEL[p.status] ?? p.status}
            </span>
            {p.species && (
              <span className="badge badge-pet">
                {SPECIES_LABEL[p.species] ?? p.species}
              </span>
            )}
          </div>
        </div>
        <div className="detail-actions">
          {p.status === 'ativo' && (
            <button
              className="btn-mini btn-clear"
              disabled={changing}
              onClick={() => changeStatus('pausado', 'Pausar')}
            >
              Pausar
            </button>
          )}
          {p.status !== 'ativo' && p.status !== 'cancelado' && (
            <button
              className="btn-mini btn-clear"
              disabled={changing}
              onClick={() => changeStatus('ativo', 'Reativar')}
            >
              Reativar
            </button>
          )}
          {p.status !== 'encontrado' && p.status !== 'cancelado' && (
            <button
              className="btn-mini btn-ok"
              disabled={changing}
              onClick={() => changeStatus('encontrado', 'Marcar como adotado')}
            >
              Adotado
            </button>
          )}
          {p.status !== 'cancelado' && (
            <button
              className="btn-mini btn-no"
              disabled={changing}
              onClick={() => changeStatus('cancelado', 'Cancelar')}
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="card-grid">
        <Stat label="Doador" value={t?.full_name ?? '—'} />
        <Stat
          label="Contato do doador"
          value={[t?.email, t?.phone].filter(Boolean).join(' · ') || '—'}
        />
        <Stat label="Adotante" value={a?.full_name ?? '— (em aberto)'} />
        <Stat
          label="Contato do adotante"
          value={a ? [a.email, a.phone].filter(Boolean).join(' · ') || '—' : '—'}
        />
        <Stat label="Raça" value={p.breed ?? '—'} />
        <Stat label="Cor" value={p.color ?? '—'} />
        <Stat label="Porte" value={p.size ? SIZE_LABEL[p.size] ?? p.size : '—'} />
        <Stat label="Sexo" value={p.sex ? SEX_LABEL[p.sex] ?? p.sex : '—'} />
        <Stat
          label="Faixa etária"
          value={p.age_group ? AGE_LABEL[p.age_group] ?? p.age_group : '—'}
        />
        <Stat label="Cadastrado em" value={fmtDate(p.created_at)} />
      </div>

      {p.description && (
        <div className="notice">
          <strong>Descrição:</strong> {p.description}
        </div>
      )}
      {p.extra_info && (
        <div className="notice" style={{ marginTop: 8 }}>
          <strong>Informações adicionais:</strong> {p.extra_info}
        </div>
      )}

      <section className="fin-section">
        <h2>Adoção</h2>
        <div className="card-grid">
          <Stat
            label="Doador confirma responsabilidade"
            value={p.consent_responsibility ? 'Sim' : '—'}
          />
          <Stat
            label="Buscou pelo dono antes"
            value={p.consent_searched_owner ? 'Sim' : '—'}
          />
        </div>
        {p.adoption_rules && (
          <div className="notice" style={{ marginTop: 12 }}>
            <strong>Regras de adoção:</strong>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{p.adoption_rules}</div>
          </div>
        )}
        {a && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn-mini btn-clear"
              onClick={() => navigate(`/usuarios/${a.id}`)}
            >
              Ver perfil do adotante
            </button>
          </div>
        )}
      </section>

      {data.photos.length > 0 && (
        <section className="fin-section">
          <h2>
            Fotos adicionais <span className="count-pill">{data.photos.length}</span>
          </h2>
          <div className="photo-grid">
            {data.photos.map((ph) => (
              <a key={ph.id} href={ph.photo_url} target="_blank" rel="noreferrer">
                <img src={ph.photo_url} alt="" className="photo-thumb" />
              </a>
            ))}
          </div>
        </section>
      )}

      {data.chats.length > 0 && (
        <section className="fin-section">
          <h2>
            Conversas de interesse{' '}
            <span className="count-pill">{data.chats.length}</span>
          </h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Interessado</th>
                <th>Status</th>
                <th>Aberto em</th>
                <th>Encerrado em</th>
              </tr>
            </thead>
            <tbody>
              {data.chats.map((c) => (
                <tr key={c.id}>
                  <td>{c.finderName ?? '—'}</td>
                  <td>{c.status === 'open' ? 'Aberto' : 'Encerrado'}</td>
                  <td>{fmtDateTime(c.created_at)}</td>
                  <td>{c.closed_at ? fmtDateTime(c.closed_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
