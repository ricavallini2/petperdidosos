import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em produção o painel é servido sob o caminho /admin
// (petperdidosos.imestredigital.cloud/admin), então o build referencia os assets
// a partir de /admin/. No dev local continua na raiz (http://localhost:5173).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/admin/' : '/',
  plugins: [react()],
  server: { port: 5173 },
}));
