import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { GlobalSearch } from './GlobalSearch';

export function Topbar() {
  const { admin, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const name = admin?.full_name ?? admin?.email ?? 'Administrador';
  const initial = name.charAt(0).toUpperCase();

  return (
    <header className="topbar">
      <button className="topbar-search" onClick={() => setSearchOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Buscar…</span>
        <kbd className="topbar-kbd">⌘K</kbd>
      </button>

      <div className="topbar-right">
        <button
          className="icon-btn"
          onClick={toggle}
          title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          aria-label="Alternar tema"
        >
          {theme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <div className="topbar-admin-wrap">
          <button className="topbar-admin" onClick={() => setMenuOpen((o) => !o)}>
            <span className="topbar-avatar">{initial}</span>
            <span className="topbar-admin-name">{name}</span>
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="topbar-menu">
                <div className="topbar-menu-head">
                  <div className="topbar-menu-name">{admin?.full_name ?? 'Administrador'}</div>
                  <div className="topbar-menu-email">{admin?.email ?? ''}</div>
                </div>
                <button
                  className="topbar-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    toggle();
                  }}
                >
                  {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
                </button>
                <button className="topbar-menu-item danger" onClick={signOut}>
                  Sair
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
