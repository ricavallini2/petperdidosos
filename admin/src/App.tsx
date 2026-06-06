import { lazy, Suspense } from 'react';
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
import { Casos } from './pages/Casos';
import { CasoDetalhe } from './pages/CasoDetalhe';
import { Denuncias } from './pages/Denuncias';
import { DenunciaDetalhe } from './pages/DenunciaDetalhe';
import { Doacoes } from './pages/Doacoes';
import { DoacaoDetalhe } from './pages/DoacaoDetalhe';
import { Avistamentos } from './pages/Avistamentos';
import { Analises } from './pages/Analises';
// Mapa é carregado sob demanda — Leaflet só entra no bundle ao abrir a página.
const Mapa = lazy(() => import('./pages/Mapa').then((m) => ({ default: m.Mapa })));
import { Auditoria } from './pages/Auditoria';
import { Administradores } from './pages/Administradores';
import { Atualizacoes } from './pages/Atualizacoes';
import { Comunicados } from './pages/Comunicados';
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
        <Route path="/analises" element={<Analises />} />
        <Route
          path="/mapa"
          element={
            <Suspense fallback={<div className="splash">Carregando mapa…</div>}>
              <Mapa />
            </Suspense>
          }
        />
        <Route path="/casos" element={<Casos />} />
        <Route path="/casos/:id" element={<CasoDetalhe />} />
        <Route path="/denuncias" element={<Denuncias />} />
        <Route path="/denuncias/:id" element={<DenunciaDetalhe />} />
        <Route path="/doacoes" element={<Doacoes />} />
        <Route path="/doacoes/:id" element={<DoacaoDetalhe />} />
        <Route path="/avistamentos" element={<Avistamentos />} />
        <Route path="/financeiro" element={<Financeiro />} />
        <Route path="/chamados" element={<Chamados />} />
        <Route path="/chamados/:id" element={<ChamadoDetalhe />} />
        <Route path="/assinaturas" element={<Assinaturas />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/usuarios/:id" element={<UsuarioDetalhe />} />
        <Route path="/comunicados" element={<Comunicados />} />
        <Route path="/auditoria" element={<Auditoria />} />
        <Route path="/administradores" element={<Administradores />} />
        <Route path="/atualizacoes" element={<Atualizacoes />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
