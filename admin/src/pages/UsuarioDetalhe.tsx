import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, UserDetail } from '../lib/api';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n: number) => BRL.format(n);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const USER_STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  banned: 'Banido',
};
const TX_TYPE_LABEL: Record<string, string> = {
  deposit: 'Depósito',
  escrow_hold: 'Recompensa (escrow)',
  escrow_release: 'Liberação de garantia',
  reward_received: 'Recompensa recebida',
  withdraw: 'Saque PIX',
  refund: 'Estorno',
  fee: 'Taxa do app',
};
const PET_STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  pausado: 'Pausado',
  encontrado: 'Encontrado',
  cancelado: 'Cancelado',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value stat-value-sm">{value}</span>
    </div>
  );
}

export function UsuarioDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    api
      .userDetail(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar o usuário'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (status: 'active' | 'blocked' | 'banned') => {
    if (!id || !data) return;
    const nome = data.profile.full_name ?? 'este usuário';
    let reason: string | undefined;
    if (status === 'active') {
      if (!window.confirm(`Reativar o acesso de ${nome}?`)) return;
    } else {
      const verbo = status === 'blocked' ? 'BLOQUEAR' : 'BANIR';
      const r = window.prompt(
        `Motivo para ${verbo} ${nome}.\nO usuário não conseguirá mais acessar o app.`
      );
      if (r === null) return;
      reason = r;
    }
    setBusy(true);
    try {
      await api.setUserStatus(id, status, reason);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao alterar o status');
    } finally {
      setBusy(false);
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
        <button className="link-btn" onClick={() => navigate('/usuarios')}>
          ← Voltar para usuários
        </button>
        <div className="alert error">{error || 'Usuário não encontrado.'}</div>
      </div>
    );
  }

  const p = data.profile;

  return (
    <div className="page">
      <button className="link-btn" onClick={() => navigate('/usuarios')}>
        ← Voltar para usuários
      </button>

      <div className="detail-header">
        {p.photo_url ? (
          <img src={p.photo_url} alt="" className="avatar avatar-lg" />
        ) : (
          <span className="avatar avatar-lg avatar-empty">
            {(p.full_name ?? '?').charAt(0)}
          </span>
        )}
        <div className="detail-header-info">
          <h1>{p.full_name ?? '—'}</h1>
          <div className="muted-text">{p.email ?? 'sem e-mail'}</div>
          <div className="detail-badges">
            <span className={`badge badge-${p.status}`}>
              {USER_STATUS_LABEL[p.status] ?? p.status}
            </span>
            {p.is_premium && <span className="badge badge-completed">Premium</span>}
            {p.is_admin && <span className="badge badge-pending">Administrador</span>}
          </div>
        </div>
        {!p.is_admin && (
          <div className="detail-actions">
            {p.status === 'active' ? (
              <>
                <button
                  className="btn-mini btn-no"
                  disabled={busy}
                  onClick={() => changeStatus('blocked')}
                >
                  Bloquear
                </button>
                <button
                  className="btn-mini btn-no"
                  disabled={busy}
                  onClick={() => changeStatus('banned')}
                >
                  Banir
                </button>
              </>
            ) : (
              <button
                className="btn-mini btn-ok"
                disabled={busy}
                onClick={() => changeStatus('active')}
              >
                Reativar acesso
              </button>
            )}
          </div>
        )}
      </div>

      {p.status !== 'active' && (
        <div className="alert">
          {USER_STATUS_LABEL[p.status]} em {fmtDate(p.status_changed_at)}
          {p.status_reason ? ` — motivo: ${p.status_reason}` : ''}
        </div>
      )}

      <div className="card-grid">
        <Stat label="CPF" value={p.cpf ?? '—'} />
        <Stat label="Telefone" value={p.phone ?? '—'} />
        <Stat label="Chave PIX" value={p.pix_key ?? '—'} />
        <Stat label="Carteira" value={brl(p.wallet_balance)} />
        <Stat label="Avaliação" value={p.rating ? `${p.rating} ★` : '—'} />
        <Stat label="Resgates" value={String(p.rescues_count)} />
        <Stat
          label="Plano"
          value={
            p.is_premium
              ? p.premium_expires_at
                ? `Premium até ${fmtDate(p.premium_expires_at)}`
                : 'Premium vitalício'
              : 'Free'
          }
        />
        <Stat label="Membro desde" value={fmtDate(p.created_at)} />
      </div>
      {p.bio && (
        <p className="page-desc" style={{ marginTop: 4 }}>
          {p.bio}
        </p>
      )}

      <section className="fin-section">
        <h2>
          Casos como tutor <span className="count-pill">{data.petsAsTutor.length}</span>
        </h2>
        {data.petsAsTutor.length === 0 ? (
          <p className="empty-state">Nenhum pet cadastrado.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Pet</th>
                <th>Status</th>
                <th>Cadastrado em</th>
              </tr>
            </thead>
            <tbody>
              {data.petsAsTutor.map((pet) => (
                <tr key={pet.id}>
                  <td>{pet.name}</td>
                  <td>
                    <span className="badge badge-pet">
                      {PET_STATUS_LABEL[pet.status] ?? pet.status}
                    </span>
                  </td>
                  <td>{fmtDate(pet.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fin-section">
        <h2>
          Casos como buscador{' '}
          <span className="count-pill">{data.casesAsFinder.length}</span>
        </h2>
        {data.casesAsFinder.length === 0 ? (
          <p className="empty-state">Não atuou como buscador em nenhum caso.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Pet</th>
                <th>Tutor</th>
                <th>Chat</th>
                <th>Desfecho</th>
                <th>Início</th>
              </tr>
            </thead>
            <tbody>
              {data.casesAsFinder.map((c) => (
                <tr key={c.chatId}>
                  <td>{c.pet?.name ?? '—'}</td>
                  <td>{c.tutorName ?? '—'}</td>
                  <td>{c.status === 'open' ? 'Aberto' : 'Encerrado'}</td>
                  <td>
                    {c.found === true
                      ? 'Encontrou'
                      : c.found === false
                        ? 'Não encontrou'
                        : '—'}
                  </td>
                  <td>{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fin-section">
        <h2>
          Histórico financeiro{' '}
          <span className="count-pill">{data.transactions.length}</span>
        </h2>
        {data.transactions.length === 0 ? (
          <p className="empty-state">Nenhuma transação.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Caso</th>
                <th className="num">Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDateTime(t.created_at)}</td>
                  <td>{TX_TYPE_LABEL[t.type] ?? t.type}</td>
                  <td>{t.pet?.name ?? '—'}</td>
                  <td className={`num ${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}`}>
                    {brl(t.amount)}
                  </td>
                  <td>
                    <span className={`badge badge-${t.status}`}>{t.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fin-section">
        <h2>
          Assinaturas premium <span className="count-pill">{data.premium.length}</span>
        </h2>
        {data.premium.length === 0 ? (
          <p className="empty-state">Nunca assinou o premium.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Plano</th>
                <th className="num">Valor</th>
                <th>Status</th>
                <th>Início</th>
                <th>Expira</th>
              </tr>
            </thead>
            <tbody>
              {data.premium.map((s) => (
                <tr key={s.id}>
                  <td>{s.plan_type === 'lifetime' ? 'Vitalício' : 'Mensal'}</td>
                  <td className="num">{brl(s.amount)}</td>
                  <td>{s.status}</td>
                  <td>{fmtDate(s.starts_at)}</td>
                  <td>{s.expires_at ? fmtDate(s.expires_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fin-section">
        <h2>
          Avaliações recebidas{' '}
          <span className="count-pill">{data.ratingsReceived.length}</span>
        </h2>
        {data.ratingsReceived.length === 0 ? (
          <p className="empty-state">Nenhuma avaliação recebida.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nota</th>
                <th>Comentário</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {data.ratingsReceived.map((r) => (
                <tr key={r.id}>
                  <td>
                    {'★'.repeat(r.score)}
                    {'☆'.repeat(Math.max(0, 5 - r.score))}
                  </td>
                  <td className="desc-cell">{r.comment ?? '—'}</td>
                  <td>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
