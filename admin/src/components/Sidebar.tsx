import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePending } from '../contexts/PendingContext';

type Badge = 'openTickets' | 'openReports' | 'sightingsPending';
type NavItem = { to: string; label: string; end?: boolean; badge?: Badge };
type NavGroup = { title: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: 'Operação',
    items: [
      { to: '/', label: 'Visão geral', end: true },
      { to: '/analises', label: 'Análises' },
      { to: '/casos', label: 'Casos' },
      { to: '/doacoes', label: 'Doações' },
      { to: '/avistamentos', label: 'Avistamentos', badge: 'sightingsPending' },
      { to: '/denuncias', label: 'Denúncias', badge: 'openReports' },
    ],
  },
  {
    title: 'Atendimento',
    items: [{ to: '/chamados', label: 'Chamados', badge: 'openTickets' }],
  },
  {
    title: 'Receita',
    items: [
      { to: '/financeiro', label: 'Financeiro' },
      { to: '/assinaturas', label: 'Assinaturas' },
    ],
  },
  {
    title: 'Pessoas',
    items: [{ to: '/usuarios', label: 'Usuários' }],
  },
  {
    title: 'Sistema',
    items: [{ to: '/configuracoes', label: 'Configurações' }],
  },
];

export function Sidebar() {
  const { admin, signOut } = useAuth();
  const pending = usePending();

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-dot" />
        PetPerdido<strong>SOS</strong>
        <span className="brand-tag">Admin</span>
      </div>

      <nav>
        {GROUPS.map((group) => (
          <div key={group.title} className="nav-group">
            <div className="nav-group-title">{group.title}</div>
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
        ))}
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
