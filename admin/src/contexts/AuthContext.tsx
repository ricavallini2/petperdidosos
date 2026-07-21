import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api, setAccessToken, AdminProfile, ApiError } from '../lib/api';

interface AuthState {
  session: Session | null;
  admin: AdminProfile | null;
  loading: boolean;
  /** true quando a verificação falhou por rede/servidor — NÃO é falta de permissão. */
  verifyFailed: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifyFailed, setVerifyFailed] = useState(false);

  // Confere a sessão e valida no backend se o usuário é admin.
  const verify = async (s: Session | null) => {
    setSession(s);
    setAccessToken(s?.access_token ?? null);
    if (!s) {
      setAdmin(null);
      setVerifyFailed(false);
      setLoading(false);
      return;
    }
    try {
      setAdmin(await api.me());
      setVerifyFailed(false);
    } catch (e) {
      // Só 401/403 significam "não é admin". Erro de rede ou 5xx NÃO pode
      // derrubar a sessão: verify() roda a cada TOKEN_REFRESHED (~1x/hora),
      // e uma instabilidade momentânea expulsava o admin no meio do trabalho.
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401 || status === 403) {
        setAdmin(null);
        setVerifyFailed(false);
      } else {
        setVerifyFailed(true); // mantém o admin logado e sinaliza a falha
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => verify(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // defere pra fora do callback de auth do Supabase (evita deadlock)
      setTimeout(() => verify(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    // onAuthStateChange dispara verify() automaticamente
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ session, admin, loading, verifyFailed, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
