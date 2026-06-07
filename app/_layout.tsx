import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import 'react-native-reanimated';
import * as Sentry from '@sentry/react-native';

// Monitoramento de erros/crash. Sem DSN definido, fica desativado (no-op).
// Ativo apenas em builds (não em DEV) para não poluir com erros locais.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN && !__DEV__,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { FeedbackHost } from '../components/Feedback';
import { AppUpdateGate } from '../components/AppUpdateGate';
import { usePushNotifications } from '../hooks/use-push-notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Registra o token de push e trata o toque na notificação (apenas em build).
  usePushNotifications();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(tabs)';

    if (!session && inAuthGroup) {
      // Se tentar acessar uma rota protegida sem sessão, vai para o login
      router.replace('/login');
    } else if (session && segments[0] === 'login') {
      // Se estiver logado e tentar ir pro login, manda pras abas
      router.replace('/(tabs)');
    }
  }, [session, isLoading, segments]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
      {/* Sistema de toasts/confirmações padronizado — fica acima de tudo */}
      <FeedbackHost />
      {/* Aviso de atualização (distribuição via APK fora da Play Store) */}
      <AppUpdateGate />
    </ThemeProvider>
  );
}

function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

// Sentry.wrap habilita captura de erros de renderização + contexto de navegação.
export default Sentry.wrap(RootLayout);
