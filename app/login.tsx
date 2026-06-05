import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { toast } from '../components/Feedback';
import {
  signInWithGoogle, signInWithApple, isAppleAuthAvailable, SocialAuthCancelled,
} from '../services/socialAuth';

export const KEEP_LOGGED_IN_KEY = 'keepLoggedIn';
// Marca, no cadastro, que o lembrete de completar o perfil deve aparecer no 1º acesso.
export const COMPLETE_PROFILE_KEY = 'completeProfilePrompt';

const FEATURES = [
  { icon: 'location', label: 'Mapa ao vivo' },
  { icon: 'sparkles', label: 'Busca por IA' },
  { icon: 'shield-checkmark', label: 'Recompensa segura' },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [keepConnected, setKeepConnected] = useState(true);
  const [socialLoading, setSocialLoading] = useState<null | 'google' | 'apple'>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);

  // Mostra o botão da Apple só onde ele realmente funciona (iOS 13+).
  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  // Conclui um login social: respeita "manter conectado" e entra no app.
  async function finishSocial() {
    await AsyncStorage.setItem(KEEP_LOGGED_IN_KEY, keepConnected ? 'true' : 'false');
    router.replace('/(tabs)');
  }

  async function handleGoogle() {
    try {
      setSocialLoading('google');
      await signInWithGoogle();
      await finishSocial();
    } catch (e: any) {
      if (e instanceof SocialAuthCancelled) return; // usuário fechou a folha
      toast.error(e?.message || 'Não foi possível entrar com o Google.', 'Erro no login');
    } finally {
      setSocialLoading(null);
    }
  }

  async function handleApple() {
    try {
      setSocialLoading('apple');
      await signInWithApple();
      await finishSocial();
    } catch (e: any) {
      if (e instanceof SocialAuthCancelled) return;
      toast.error(e?.message || 'Não foi possível entrar com a Apple.', 'Erro no login');
    } finally {
      setSocialLoading(null);
    }
  }

  const validate = (): string | null => {
    const mail = email.trim();
    if (!mail) return 'Informe seu email';
    if (!EMAIL_RE.test(mail)) return 'Email inválido';
    if (!password) return 'Informe sua senha';
    if (isSignUp && password.length < 6) return 'A senha precisa ter ao menos 6 caracteres';
    return null;
  };

  async function signInWithEmail() {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        toast.error(error.message, 'Erro ao entrar');
      } else if (data.session) {
        await AsyncStorage.setItem(KEEP_LOGGED_IN_KEY, keepConnected ? 'true' : 'false');
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      toast.error(e.message, 'Erro no login');
    } finally {
      setLoading(false);
    }
  }

  async function signUpWithEmail() {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) {
        toast.error(error.message, 'Erro ao cadastrar');
        return;
      }
      // Cadastro OK: agenda o lembrete de completar o perfil no primeiro acesso.
      await AsyncStorage.setItem(COMPLETE_PROFILE_KEY, 'pending');
      if (data.session) {
        await AsyncStorage.setItem(KEEP_LOGGED_IN_KEY, keepConnected ? 'true' : 'false');
        router.replace('/(tabs)');
      } else {
        toast.success(
          'Confirme seu email para ativar a conta e depois entre com seus dados.',
          'Cadastro realizado!',
        );
        setIsSignUp(false);
      }
    } catch (e: any) {
      toast.error(e.message, 'Erro ao cadastrar');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = () => {
    const err = validate();
    if (err) return toast.warning(err);
    if (isSignUp) signUpWithEmail();
    else signInWithEmail();
  };

  async function handleForgotPassword() {
    const mail = email.trim();
    if (!mail || !EMAIL_RE.test(mail)) {
      return toast.warning('Digite seu email no campo acima para receber o link de redefinição.');
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(mail);
      if (error) toast.error(error.message, 'Erro');
      else toast.success('Enviamos um link de redefinição para o seu email.', 'Verifique seu email');
    } catch (e: any) {
      toast.error(e.message, 'Erro');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* HERO — marca */}
        <LinearGradient
          colors={['#FF6B81', '#FF4757']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + 36 }]}
        >
          <View style={styles.logoCircle}>
            <Ionicons name="paw" size={40} color="#FFF" />
          </View>
          <Text style={styles.brand}>PetPerdido<Text style={{ color: '#FFE2E6' }}>SOS</Text></Text>
          <Text style={styles.tagline}>A rede que reúne pets perdidos aos seus tutores</Text>

          {/* Destaques compactos */}
          <View style={styles.featuresRow}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featurePill}>
                <Ionicons name={f.icon as any} size={14} color="#FFF" />
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* CARD — formulário sobreposto ao hero */}
        <View style={styles.card}>
          {/* Segmented Entrar / Criar conta */}
          <View style={styles.segment}>
            <TouchableOpacity
              style={[styles.segmentBtn, !isSignUp && styles.segmentBtnActive]}
              activeOpacity={0.8}
              onPress={() => setIsSignUp(false)}
            >
              <Text style={[styles.segmentText, !isSignUp && styles.segmentTextActive]}>Entrar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentBtn, isSignUp && styles.segmentBtnActive]}
              activeOpacity={0.8}
              onPress={() => setIsSignUp(true)}
            >
              <Text style={[styles.segmentText, isSignUp && styles.segmentTextActive]}>Criar conta</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.formTitle}>
            {isSignUp ? 'Criar sua conta' : 'Bem-vindo de volta'}
          </Text>
          <Text style={styles.formSubtitle}>
            {isSignUp
              ? 'Em menos de um minuto você já está ajudando.'
              : 'Entre para continuar a busca.'}
          </Text>

          {/* Email */}
          <View style={styles.inputGroup}>
            <Ionicons name="mail-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#A4B0BE"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!loading}
            />
          </View>

          {/* Senha */}
          <View style={styles.inputGroup}>
            <Ionicons name="lock-closed-outline" size={20} color="#A4B0BE" style={styles.inputIcon} />
            <TextInput
              ref={passwordRef}
              style={styles.input}
              placeholder="Senha"
              placeholderTextColor="#A4B0BE"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete={isSignUp ? 'new-password' : 'password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              returnKeyType="go"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleSubmit}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#A4B0BE" />
            </TouchableOpacity>
          </View>

          {/* Manter conectado + Esqueci a senha */}
          <View style={styles.rowBetween}>
            <TouchableOpacity style={styles.keepRow} activeOpacity={0.7} onPress={() => setKeepConnected((v) => !v)}>
              <View style={[styles.checkbox, keepConnected && styles.checkboxChecked]}>
                {keepConnected && <Ionicons name="checkmark" size={13} color="#FFF" />}
              </View>
              <Text style={styles.keepText}>Manter conectado</Text>
            </TouchableOpacity>
            {!isSignUp && (
              <TouchableOpacity onPress={handleForgotPassword} disabled={loading}>
                <Text style={styles.forgotText}>Esqueci a senha</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Botão principal */}
          <TouchableOpacity
            style={styles.mainButtonWrapper}
            activeOpacity={0.9}
            onPress={handleSubmit}
            disabled={loading}
          >
            <LinearGradient
              colors={loading ? ['#FF9AA8', '#FF8492'] : ['#FF6B81', '#FF4757']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.mainButton}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name={isSignUp ? 'person-add' : 'log-in'} size={18} color="#FFF" />
                  <Text style={styles.mainButtonText}>{isSignUp ? 'Criar conta' : 'Entrar'}</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Login social */}
          {Platform.OS !== 'web' && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>ou continue com</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={styles.socialBtn}
                activeOpacity={0.85}
                onPress={handleGoogle}
                disabled={loading || socialLoading !== null}
              >
                {socialLoading === 'google' ? (
                  <ActivityIndicator color="#2F3542" />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={19} color="#EA4335" />
                    <Text style={styles.socialText}>Continuar com Google</Text>
                  </>
                )}
              </TouchableOpacity>

              {appleAvailable && (
                <TouchableOpacity
                  style={[styles.socialBtn, styles.appleBtn]}
                  activeOpacity={0.85}
                  onPress={handleApple}
                  disabled={loading || socialLoading !== null}
                >
                  {socialLoading === 'apple' ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="logo-apple" size={20} color="#FFF" />
                      <Text style={[styles.socialText, styles.appleText]}>Continuar com Apple</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}

          {isSignUp && (
            <Text style={styles.terms}>
              Ao criar a conta, você concorda com os Termos de Uso e a Política de Privacidade.
            </Text>
          )}
        </View>

        <Text style={[styles.marketing, { marginBottom: insets.bottom + 16 }]}>
          Tecnologia e comunidade trabalhando juntas para trazer cada pet de volta para casa.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F1F2F6' },
  scroll: { flexGrow: 1, backgroundColor: '#F1F2F6' },

  // Hero
  hero: {
    paddingHorizontal: 24,
    paddingBottom: 64,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'center',
  },
  logoCircle: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  brand: { fontSize: 30, fontWeight: '900', color: '#FFF', letterSpacing: -0.5 },
  tagline: {
    fontSize: 14, color: 'rgba(255,255,255,0.92)', fontWeight: '600',
    textAlign: 'center', lineHeight: 20, marginTop: 6, paddingHorizontal: 12,
  },
  featuresRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18 },
  featurePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20,
    paddingHorizontal: 11, paddingVertical: 6,
  },
  featureText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  // Card
  card: {
    backgroundColor: '#FFF',
    marginTop: -40,
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.10, shadowRadius: 20, elevation: 8,
  },
  segment: {
    flexDirection: 'row', backgroundColor: '#F1F2F6', borderRadius: 14, padding: 4, marginBottom: 18,
  },
  segmentBtn: { flex: 1, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  segmentBtnActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  segmentText: { fontSize: 14, fontWeight: '800', color: '#A4B0BE' },
  segmentTextActive: { color: '#FF4757' },

  formTitle: { fontSize: 20, fontWeight: '900', color: '#2F3542' },
  formSubtitle: { fontSize: 13.5, color: '#747D8C', fontWeight: '500', marginTop: 3, marginBottom: 18 },

  inputGroup: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F7F8FA', borderRadius: 16, borderWidth: 1, borderColor: '#EAEDF0',
    paddingHorizontal: 16, height: 56, marginBottom: 13,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#2F3542', fontWeight: '500' },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, marginBottom: 4 },
  keepRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 21, height: 21, borderRadius: 6, borderWidth: 2, borderColor: '#DFE4EA',
    justifyContent: 'center', alignItems: 'center', marginRight: 9,
  },
  checkboxChecked: { backgroundColor: '#FF4757', borderColor: '#FF4757' },
  keepText: { color: '#747D8C', fontSize: 13.5, fontWeight: '600' },
  forgotText: { color: '#FF4757', fontSize: 13.5, fontWeight: '700' },

  mainButtonWrapper: {
    marginTop: 18,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 14, elevation: 8,
  },
  mainButton: {
    height: 56, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  mainButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },

  terms: { fontSize: 12, color: '#A4B0BE', fontWeight: '500', textAlign: 'center', lineHeight: 17, marginTop: 14 },

  // Login social
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 6 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EAEDF0' },
  dividerText: { fontSize: 12.5, color: '#A4B0BE', fontWeight: '700' },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54, borderRadius: 16, borderWidth: 1.5, borderColor: '#EAEDF0',
    backgroundColor: '#FFF', marginTop: 12,
  },
  socialText: { fontSize: 15.5, fontWeight: '800', color: '#2F3542' },
  appleBtn: { backgroundColor: '#000', borderColor: '#000' },
  appleText: { color: '#FFF' },

  marketing: {
    fontSize: 12.5, color: '#A4B0BE', fontWeight: '600', textAlign: 'center',
    lineHeight: 18, marginTop: 22, paddingHorizontal: 28,
  },
});
