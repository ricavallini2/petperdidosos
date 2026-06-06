import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getUserProfile, updateUserProfile } from './api';

// Client IDs do OAuth (Google Cloud). Definidos no .env / EAS env.
// - WEB: usado como "audience" do idToken nativo (obrigatório no Android e iOS).
// - IOS: client específico do iOS (necessário só no build iOS).
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** Lançada quando o usuário fecha a folha do Google/Apple — não é erro real. */
export class SocialAuthCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SocialAuthCancelled';
  }
}

let googleConfigured = false;
function getGoogle() {
  // require tardio: o módulo nativo só existe em build (não no Expo Go/web).
  const mod = require('@react-native-google-signin/google-signin');
  if (!googleConfigured) {
    mod.GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
      scopes: ['profile', 'email'],
      offlineAccess: false,
    });
    googleConfigured = true;
  }
  return mod;
}

/**
 * Login com Google (folha de seleção de conta nativa) → troca o idToken por uma
 * sessão Supabase. O AuthContext detecta a sessão e roteia o app automaticamente.
 */
export async function signInWithGoogle() {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Login com Google ainda não configurado neste build.');
  }
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = getGoogle();

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let response: any;
  try {
    response = await GoogleSignin.signIn();
  } catch (e: any) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new SocialAuthCancelled();
    }
    throw e;
  }

  // API nova (v13+): cancelar retorna { type: 'cancelled' } em vez de lançar erro.
  if (!isSuccessResponse(response)) throw new SocialAuthCancelled();

  const idToken: string | undefined = response.data?.idToken;
  if (!idToken) throw new Error('Não foi possível obter o token do Google.');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;

  // Se o perfil ainda não tiver foto, usa a foto do Google. Se já tiver, mantém.
  // Best-effort: nunca bloqueia/quebra o login.
  await maybeSetGoogleAvatar(data.user).catch(() => {});

  return data;
}

/**
 * Copia a foto do Google para o perfil SOMENTE quando ainda não há foto cadastrada.
 * Se o usuário já tem avatar (do trigger, upload manual, etc.), não sobrescreve.
 */
async function maybeSetGoogleAvatar(user: any) {
  const meta = user?.user_metadata ?? {};
  const pic: string | undefined = meta.avatar_url || meta.picture;
  if (!pic || !user?.id) return;

  const profile = await getUserProfile(user.id).catch(() => null);
  const hasPhoto = !!(profile && profile.photo_url != null && String(profile.photo_url).trim() !== '');
  if (!hasPhoto) {
    await updateUserProfile(user.id, { photo_url: pic });
  }
}

/**
 * Login com Apple (iOS) → troca o identityToken por uma sessão Supabase.
 * Só disponível em iOS 13+; verifique com isAppleAuthAvailable() antes de exibir o botão.
 */
export async function signInWithApple() {
  const AppleAuthentication = require('expo-apple-authentication');

  let credential: any;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED') throw new SocialAuthCancelled();
    throw e;
  }

  const token: string | undefined = credential?.identityToken;
  if (!token) throw new Error('Não foi possível obter o token da Apple.');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token,
  });
  if (error) throw error;
  return data;
}

/** Apple Sign-In só existe em iOS (13+) e com o entitlement habilitado no build. */
export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const AppleAuthentication = require('expo-apple-authentication');
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}
