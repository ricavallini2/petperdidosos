import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type NavItem = { to: string; label: string; end?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: 'Operação',
    items: [
      { to: '/', label: 'Visão geral', end: true },
      { to: '/casos', label: 'Casos' },
      { to: '/doacoes', label: 'Doações' },
      { to: '/avistamentos', label: 'Avistamentos' },
      { to: '/denuncias', label: 'Denúncias' },
    ],
  },
  {
    title: 'Atendimento',
    items: [{ to: '/chamados', label: 'Chamados' }],
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
            {group.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
              >
                {n.label}
              </NavLink>
            ))}
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
