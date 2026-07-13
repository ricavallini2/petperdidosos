import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { registerPushToken } from '../services/api';

// Em primeiro plano (app aberto), ainda mostra a notificação como banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registra o token de push do aparelho (vinculado ao usuário logado) e trata o
 * toque na notificação. Use uma vez, no layout raiz do app. Push só funciona em
 * APARELHO real e em build (dev/preview/production) — não no Expo Go.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const responseSub = useRef<Notifications.Subscription | undefined>(undefined);

  // Registro do token quando há usuário logado.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        if (!Device.isDevice) return; // emulador não recebe push remoto

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Notificações',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF4757',
          });
        }

        const { status: existing } = await Notifications.getPermissionsAsync();
        let status = existing;
        if (status !== 'granted') {
          const req = await Notifications.requestPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted' || cancelled) return;

        const projectId =
          (Constants?.expoConfig as any)?.extra?.eas?.projectId ??
          (Constants as any)?.easConfig?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        if (cancelled) return;
        await registerPushToken(tokenData.data, Platform.OS);
      } catch {
        // best-effort — não atrapalha o login
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Decide o destino a partir dos dados do push (deep link).
  const routeFromData = useCallback((data: any) => {
    if (!data) { router.push('/profile/notifications'); return; }
    const type = data.type as string | undefined;
    const petId = data.pet_id as string | undefined;
    const chatId = data.chat_id as string | undefined;
    const tutorId = data.chat_tutor_id as string | undefined;
    const finderId = data.chat_finder_id as string | undefined;

    // Chat (mensagem, avistamento, doação, "é a sua vez"...) → abre a CONVERSA.
    if (chatId && petId && tutorId && finderId) {
      router.push(`/chat/${petId}?tutorId=${tutorId}&finderId=${finderId}` as Href);
      return;
    }
    // Resgate concluído → ficha do caso.
    if (type === 'rescue_confirmed' && petId) {
      router.push(`/pet/case/${petId}` as Href);
      return;
    }
    // Suporte → chamado específico.
    if (type === 'support' && data.ticket_id) {
      router.push(`/profile/ticket/${data.ticket_id}` as Href);
      return;
    }
    if (type === 'withdraw') { router.push('/profile/wallet'); return; }
    // Lembrete de saúde (vacina/vermífugo/medicação...) → carteirinha do pet.
    if (type === 'health_reminder' && data.meuPetId) {
      router.push(`/meu-pet/${data.meuPetId}` as Href);
      return;
    }
    // Alerta de região → tela do alerta.
    if (type === 'region_alert' && (data.alert_id || data.region_alert_id)) {
      router.push(`/region-alert/${data.alert_id ?? data.region_alert_id}` as Href);
      return;
    }
    // Alerta pausado (moderação) → perfil do tutor ("Ver meus alertas"), igual ao in-app.
    if (type === 'region_alert_paused') {
      router.push('/(tabs)/profile' as Href);
      return;
    }
    // Fallback: tela de Notificações.
    router.push('/profile/notifications');
  }, [router]);

  // Toque na notificação com o app aberto/em segundo plano.
  useEffect(() => {
    responseSub.current = Notifications.addNotificationResponseReceivedListener((response) => {
      routeFromData(response.notification.request.content.data);
    });
    return () => responseSub.current?.remove();
  }, [routeFromData]);

  // App ABERTO pela notificação (estava fechado): trata o toque inicial.
  useEffect(() => {
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      // Pequeno atraso para o layout/rotas já estarem montados.
      setTimeout(() => routeFromData(response.notification.request.content.data), 700);
    });
    return () => { cancelled = true; };
  }, [routeFromData]);
}
