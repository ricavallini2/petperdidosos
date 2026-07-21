import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, UserDetail } from '../lib/api';
import { confirmDialog, promptDialog, toast } from '../lib/ui';

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
      const ok = await confirmDialog({
        title: 'Reativar acesso',
        message: `Reativar o acesso de ${nome}?`,
        confirmLabel: 'Reativar',
      });
      if (!ok) return;
    } else {
      const verbo = status === 'blocked' ? 'bloquear' : 'banir';
      const r = await promptDialog({
        title: `${status === 'blocked' ? 'Bloquear' : 'Banir'} usuário`,
        message: `${nome} não conseguirá mais acessar o app.`,
        label: `Motivo para ${verbo}`,
        placeholder: 'Descreva o motivo…',
        confirmLabel: status === 'blocked' ? 'Bloquear' : 'Banir',
        danger: true,
      });
      if (r === null) return;
      reason = r;
    }
    setBusy(true);
    try {
      await api.setUserStatus(id, status, reason);
      toast.success(status === 'active' ? 'Acesso reativado.' : 'Usuário atualizado.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao alterar o status');
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
        {/* Chave PIX e carteira saíram: o app não intermedia pagamento, então
            esses dados não têm mais finalidade aqui (dado sensível sem uso). */}
        <Stat label="CPF" value={p.cpf ?? '—'} />
        <Stat label="Telefone" value={p.phone ?? '—'} />
        <Stat label="Avaliação" value={p.rating ? `${p.rating} ★` : '—'} />
        <Stat label="Resgates" value={String(p.rescues_count)} />
        <Stat
          label="Último acesso"
          value={p.last_sign_in_at ? fmtDateTime(p.last_sign_in_at) : 'Nunca entrou'}
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

      {/* Histórico financeiro e assinaturas premium removidos: o app não
          movimenta dinheiro (sem carteira/escrow/taxa) e o premium está
          desativado. Eram tabelas vazias sugerindo um fluxo que não existe. */}

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
