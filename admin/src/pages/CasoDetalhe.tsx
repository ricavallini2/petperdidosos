import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, CasoDetail } from '../lib/api';
import { TYPE_LABEL, SPECIES_LABEL, PET_STATUS_LABEL } from './Casos';
import { confirmDialog, toast } from '../lib/ui';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n: number) => BRL.format(n);
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
const REWARD_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  locked: 'Bloqueada',
  paid: 'Paga',
  refunded: 'Reembolsada',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value stat-value-sm">{value}</span>
    </div>
  );
}

export function CasoDetalhe() {
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
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar o caso'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (newStatus: string, action: string) => {
    if (!id || !data) return;
    const ok = await confirmDialog({
      title: `${action} caso`,
      message: `${action} o caso de ${data.pet.name}?`,
      confirmLabel: action,
      danger: newStatus === 'cancelado',
    });
    if (!ok) return;
    setChanging(true);
    try {
      await api.setCasoStatus(id, newStatus);
      toast.success('Status atualizado.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao alterar o status');
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
        <button className="link-btn" onClick={() => navigate('/casos')}>
          ← Voltar para casos
        </button>
        <div className="alert error">{error || 'Caso não encontrado.'}</div>
      </div>
    );
  }

  const p = data.pet;
  const t = data.tutor;
  const activeReward = data.rewards.find(
    (r) => r.status === 'pending' || r.status === 'locked'
  );

  return (
    <div className="page">
      <button className="link-btn" onClick={() => navigate('/casos')}>
        ← Voltar para casos
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
            <span className={`badge type-${p.type}`}>
              {TYPE_LABEL[p.type] ?? p.type}
            </span>
            <span className={`badge petst-${p.status}`}>
              {PET_STATUS_LABEL[p.status] ?? p.status}
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
              onClick={() => changeStatus('encontrado', 'Marcar como encontrado')}
            >
              Encontrado
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
        <Stat label="Tutor" value={t?.full_name ?? '—'} />
        <Stat
          label="Contato do tutor"
          value={[t?.email, t?.phone].filter(Boolean).join(' · ') || '—'}
        />
        <Stat label="Raça" value={p.breed ?? '—'} />
        <Stat label="Cor" value={p.color ?? '—'} />
        <Stat label="Porte" value={p.size ? SIZE_LABEL[p.size] ?? p.size : '—'} />
        <Stat label="Sexo" value={p.sex ? SEX_LABEL[p.sex] ?? p.sex : '—'} />
        <Stat
          label="Faixa etária"
          value={p.age_group ? AGE_LABEL[p.age_group] ?? p.age_group : '—'}
        />
        <Stat label="Data do desaparecimento" value={fmtDate(p.lost_date)} />
        <Stat label="Cadastrado em" value={fmtDate(p.created_at)} />
        <Stat
          label="Recompensa ativa"
          value={activeReward ? brl(Number(activeReward.amount)) : '—'}
        />
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

      <section className="fin-section">
        <h2>
          Recompensas <span className="count-pill">{data.rewards.length}</span>
        </h2>
        {data.rewards.length === 0 ? (
          <p className="empty-state">Sem recompensa registrada.</p>
        ) : (
          <table className="data-table">
            <thead>
              {/* Sem coluna "Taxa": o app não cobra comissão — fee_amount é
                  sempre 0 nas recompensas novas. */}
              <tr>
                <th className="num">Valor anunciado</th>
                <th>Status</th>
                <th>Criada em</th>
                <th>Resolução</th>
              </tr>
            </thead>
            <tbody>
              {data.rewards.map((r) => (
                <tr key={r.id}>
                  <td className="num">{brl(Number(r.amount))}</td>
                  <td>
                    <span className={`badge rwd-${r.status}`}>
                      {REWARD_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>{fmtDate(r.created_at)}</td>
                  <td>
                    {r.paid_at
                      ? `Paga em ${fmtDate(r.paid_at)}`
                      : r.refunded_at
                        ? `Reembolsada em ${fmtDate(r.refunded_at)}`
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fin-section">
        <h2>
          Chats <span className="count-pill">{data.chats.length}</span>
        </h2>
        {data.chats.length === 0 ? (
          <p className="empty-state">Nenhum chat com buscadores.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Buscador</th>
                <th>Status</th>
                <th>Desfecho</th>
                <th>Aberto em</th>
                <th>Encerrado em</th>
              </tr>
            </thead>
            <tbody>
              {data.chats.map((c) => (
                <tr key={c.id}>
                  <td>{c.finderName ?? '—'}</td>
                  <td>{c.status === 'open' ? 'Aberto' : 'Encerrado'}</td>
                  <td>
                    {c.found === true
                      ? 'Encontrou'
                      : c.found === false
                        ? 'Não encontrou'
                        : '—'}
                  </td>
                  <td>{fmtDateTime(c.created_at)}</td>
                  <td>{c.closed_at ? fmtDateTime(c.closed_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fin-section">
        <h2>
          Avistamentos <span className="count-pill">{data.sightings.length}</span>
        </h2>
        {data.sightings.length === 0 ? (
          <p className="empty-state">Nenhum avistamento registrado.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Quem avistou</th>
                <th className="num">Score IA</th>
                <th>Confirmado</th>
                <th>Data</th>
                <th>Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {data.sightings.map((s) => (
                <tr key={s.id}>
                  <td>{s.finderName ?? '—'}</td>
                  <td className="num">
                    {s.ai_match_score != null
                      ? `${Math.round(Number(s.ai_match_score) * 100)}%`
                      : '—'}
                  </td>
                  <td>
                    {s.confirmed_by_tutor === true
                      ? 'Sim'
                      : s.confirmed_by_tutor === false
                        ? 'Não'
                        : '—'}
                  </td>
                  <td>{fmtDateTime(s.created_at)}</td>
                  <td className="desc-cell">{s.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
