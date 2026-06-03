import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
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

  // Toque na notificação → leva à tela de Notificações (que roteia ao destino).
  useEffect(() => {
    responseSub.current = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/profile/notifications');
    });
    return () => responseSub.current?.remove();
  }, [router]);
}
