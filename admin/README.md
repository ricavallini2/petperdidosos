# PetPerdidoSOS — Painel Admin

Interface web de administração (financeiro, chamados, assinaturas, usuários).

**Este projeto é APENAS a interface web.** Ele não contém backend nem banco —
usa o backend Express (`../backend`) e o Supabase já existentes do projeto,
apenas estendidos com rotas `/admin/*` e a coluna `profiles.is_admin`.

## Como rodar

1. `cd admin`
2. `npm install`
3. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_ANON_KEY`
   (a mesma anon key usada pelo app mobile).
4. `npm run dev` → abre em http://localhost:5173

O backend precisa estar rodando em paralelo:
```
cd ../backend && npm run dev
```

## Acesso

Somente usuários com `is_admin = true` na tabela `profiles` conseguem entrar.
O login usa o Supabase Auth; a verificação de admin é feita no backend
(`GET /admin/me`).

## Estrutura

```
src/
  lib/         supabase.ts (auth) + api.ts (chamadas ao backend)
  contexts/    AuthContext — login e verificação de admin
  components/  Layout + Sidebar
  pages/       Login, Dashboard, Financeiro, Chamados, Assinaturas, Usuarios
```

As páginas internas são placeholders — conforme os endpoints `/admin/*`
forem criados no backend, basta consumi-los via `src/lib/api.ts`.
