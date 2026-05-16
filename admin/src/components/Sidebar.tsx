import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const NAV = [
  { to: '/', label: 'Visão geral', end: true },
  { to: '/financeiro', label: 'Financeiro', end: false },
  { to: '/chamados', label: 'Chamados', end: false },
  { to: '/assinaturas', label: 'Assinaturas', end: false },
  { to: '/usuarios', label: 'Usuários', end: false },
  { to: '/configuracoes', label: 'Configurações', end: false },
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
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="admin-name">{admin?.full_name ?? admin?.email ?? 'Administrador'}</div>
        <button className="btn-logout" onClick={signOut}>Sair</button>
      </div>
    </aside>
  );
}
