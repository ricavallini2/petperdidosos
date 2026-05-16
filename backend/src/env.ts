// Carrega o .env do backend de forma INDEPENDENTE do diretório de execução.
// Precisa ser o PRIMEIRO import de index.ts (antes de ./supabase.js), porque
// em ESM os imports são avaliados na ordem em que aparecem — e o supabase.ts
// lê process.env já no carregamento do módulo.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/env.ts  ->  ../.env  (backend/.env), seja rodando via tsx ou compilado
const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, '../.env');

// override: true — o .env do backend é a fonte da verdade. Sem isso, uma
// variável já presente no ambiente do SO (ex.: ANTHROPIC_API_KEY vazia,
// definida por outra ferramenta) venceria o valor do arquivo.
const result = dotenv.config({ path: envPath, override: true });

if (result.error) {
  console.warn(`[env] Falha ao ler ${envPath}:`, result.error.message);
} else {
  console.log(`[env] .env carregado de ${envPath}`);
  console.log('[env] ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'OK' : 'AUSENTE');
  console.log('[env] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'AUSENTE');
}
