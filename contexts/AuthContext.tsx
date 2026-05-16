import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { Session, User } from '@supabase/supabase-js';

const KEEP_LOGGED_IN_KEY = 'keepLoggedIn';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isLoading: true,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      // Se havia sessão de uma execução anterior mas o usuário não marcou
      // "manter conectado", encerra a sessão local e exige novo login.
      if (session) {
        const keep = await AsyncStorage.getItem(KEEP_LOGGED_IN_KEY);
        if (keep === 'false') {
          await supabase.auth.signOut({ scope: 'local' });
          return; // onAuthStateChange (SIGNED_OUT) atualiza o estado
        }
      }
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
