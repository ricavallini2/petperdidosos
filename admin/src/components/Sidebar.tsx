import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePending } from '../contexts/PendingContext';

type Badge = 'openTickets' | 'openReports' | 'sightingsPending';
type NavItem = { to: string; label: string; end?: boolean; badge?: Badge };
type NavGroup = { title: string; items: NavItem[] };

// Home do painel — fora de grupo, para nunca sumir num grupo recolhido.
const PINNED: NavItem[] = [
  { to: '/', label: 'Visão geral', end: true },
  { to: '/analises', label: 'Análises' },
];

// Ordem = ordem do dia do operador: primeiro o que exige ação (fila com
// badges), depois o conteúdo, depois pessoas, e por último o sistema.
const GROUPS: NavGroup[] = [
  {
    // Os 3 itens com badge ficam juntos: recolhido, o grupo mostra quanto
    // trabalho existe pendente hoje.
    title: 'Fila de trabalho',
    items: [
      { to: '/denuncias', label: 'Denúncias', badge: 'openReports' },
      { to: '/chamados', label: 'Chamados', badge: 'openTickets' },
      { to: '/avistamentos', label: 'Avistamentos', badge: 'sightingsPending' },
    ],
  },
  {
    title: 'Operação',
    items: [
      { to: '/casos', label: 'Casos' },
      // "Adoções", não "Doações": aqui é doação de PET. Doação em dinheiro
      // (Pix) é outra coisa e se configura em Configurações.
      { to: '/doacoes', label: 'Adoções' },
      { to: '/mapa', label: 'Mapa' },
    ],
  },
  {
    title: 'Pessoas',
    items: [
      { to: '/usuarios', label: 'Usuários' },
      { to: '/comunicados', label: 'Comunicados' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { to: '/configuracoes', label: 'Configurações' },
      { to: '/administradores', label: 'Administradores' },
      { to: '/auditoria', label: 'Auditoria' },
      { to: '/atualizacoes', label: 'Atualizações do app' },
    ],
  },
];

const STORAGE_KEY = 'pps-admin-collapsed-groups';

// Qual grupo contém a rota atual — esse grupo nunca fica recolhido.
function groupOfPath(pathname: string): string | null {
  for (const g of GROUPS) {
    for (const it of g.items) {
      if (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + '/')) {
        return g.title;
      }
    }
  }
  return null;
}

export function Sidebar() {
  const { admin, signOut } = useAuth();
  const pending = usePending();
  const location = useLocation();
  const activeGroup = groupOfPath(location.pathname);

  // Persiste os grupos recolhidos manualmente pelo usuário
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const toggle = (title: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-dot" />
        PetPerdido<strong>SOS</strong>
        <span className="brand-tag">Admin</span>
      </div>

      <nav>
        <div className="nav-group-items nav-pinned">
          {PINNED.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              <span>{n.label}</span>
            </NavLink>
          ))}
        </div>

        {GROUPS.map((group) => {
          // O grupo da página ativa permanece sempre aberto
          const isOpen = activeGroup === group.title || !collapsed.has(group.title);
          // Contagem de pendências do grupo (mostrada quando recolhido)
          const groupPending = group.items.reduce(
            (sum, it) => sum + (it.badge ? pending[it.badge] : 0),
            0
          );
          return (
            <div key={group.title} className={'nav-group' + (isOpen ? '' : ' collapsed')}>
              <button
                type="button"
                className="nav-group-title"
                onClick={() => toggle(group.title)}
                aria-expanded={isOpen}
              >
                <span>{group.title}</span>
                {!isOpen && groupPending > 0 && (
                  <span className="nav-badge">{groupPending}</span>
                )}
                <svg
                  className="nav-group-chevron"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {isOpen && (
                <div className="nav-group-items">
                  {group.items.map((n) => {
                    const count = n.badge ? pending[n.badge] : 0;
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.end}
                        className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
                      >
                        <span>{n.label}</span>
                        {count > 0 && <span className="nav-badge">{count}</span>}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="admin-name">
          {admin?.full_name ?? admin?.email ?? 'Administrador'}
        </div>
        <button className="btn-logout" onClick={signOut}>
          Sair
        </button>
      </div>
    </aside>
  );
}
