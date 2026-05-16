import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Financeiro } from './pages/Financeiro';
import { Chamados } from './pages/Chamados';
import { ChamadoDetalhe } from './pages/ChamadoDetalhe';
import { Assinaturas } from './pages/Assinaturas';
import { Usuarios } from './pages/Usuarios';
import { UsuarioDetalhe } from './pages/UsuarioDetalhe';
import { Configuracoes } from './pages/Configuracoes';

export function App() {
  const { admin, loading } = useAuth();

  if (loading) {
    return <div className="splash">Carregando…</div>;
  }

  // Sem admin = mostra login (que também avisa se a conta não tem permissão)
  if (!admin) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/financeiro" element={<Financeiro />} />
        <Route path="/chamados" element={<Chamados />} />
        <Route path="/chamados/:id" element={<ChamadoDetalhe />} />
        <Route path="/assinaturas" element={<Assinaturas />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/usuarios/:id" element={<UsuarioDetalhe />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
