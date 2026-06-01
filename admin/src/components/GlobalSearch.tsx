import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface Hit {
  kind: 'usuario' | 'caso' | 'chamado';
  id: string;
  title: string;
  subtitle: string;
  to: string;
}

const KIND_LABEL: Record<Hit['kind'], string> = {
  usuario: 'Usuário',
  caso: 'Caso',
  chamado: 'Chamado',
};

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (open) {
      setTerm('');
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myReq = ++reqId.current;
    const timer = setTimeout(async () => {
      try {
        const [users, casos, tickets] = await Promise.all([
          api.users({ q, limit: 5 }).catch(() => ({ rows: [] })),
          api.casos({ q, limit: 5 }).catch(() => ({ rows: [] })),
          api.tickets({ q, limit: 5 }).catch(() => ({ rows: [] })),
        ]);
        if (myReq !== reqId.current) return;
        const result: Hit[] = [
          ...users.rows.map((u) => ({
            kind: 'usuario' as const,
            id: u.id,
            title: u.full_name ?? 'Sem nome',
            subtitle: u.email ?? u.phone ?? '—',
            to: `/usuarios/${u.id}`,
          })),
          ...casos.rows.map((c) => ({
            kind: 'caso' as const,
            id: c.id,
            title: c.name,
            subtitle: `${c.tutor.full_name ?? '—'} · ${c.status}`,
            to: `/casos/${c.id}`,
          })),
          ...tickets.rows.map((t) => ({
            kind: 'chamado' as const,
            id: t.id,
            title: t.subject,
            subtitle: `${t.user.full_name ?? '—'} · ${t.status}`,
            to: `/chamados/${t.id}`,
          })),
        ];
        setHits(result);
        setActive(0);
      } finally {
        if (myReq === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term, open]);

  if (!open) return null;

  const go = (hit: Hit) => {
    navigate(hit.to);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      go(hits[active]);
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Buscar usuários, casos, chamados…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="search-results">
          {loading && <div className="search-empty">Buscando…</div>}
          {!loading && term.trim().length >= 2 && hits.length === 0 && (
            <div className="search-empty">Nada encontrado para “{term.trim()}”.</div>
          )}
          {!loading && term.trim().length < 2 && (
            <div className="search-empty">Digite ao menos 2 caracteres.</div>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.id}`}
              className={'search-hit' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
            >
              <span className={`search-kind kind-${h.kind}`}>{KIND_LABEL[h.kind]}</span>
              <span className="search-hit-main">
                <span className="search-hit-title">{h.title}</span>
                <span className="search-hit-sub">{h.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="search-foot">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  );
}
