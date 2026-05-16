import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  console.warn('[admin] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes — confira o .env');
}

// Mesmo projeto Supabase do app mobile — usado aqui apenas para autenticação.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
