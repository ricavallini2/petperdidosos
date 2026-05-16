import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { toast } from '../components/Feedback';

export const KEEP_LOGGED_IN_KEY = 'keepLoggedIn';
// Marca, no cadastro, que o lembrete de completar o perfil deve aparecer no 1º acesso.
export const COMPLETE_PROFILE_KEY = 'completeProfilePrompt';

const FEATURES = [
  { icon: 'location', label: 'Mapa ao vivo', desc: 'Veja pets perdidos perto de você' },
  { icon: 'sparkles', label: 'Busca por IA', desc: 'Reconhece o pet por uma foto' },
  { icon: 'shield-checkmark', label: 'Recompensa segura', desc: 'Valor protegido até o resgate' },
] as const;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [keepConnected, setKeepConnected] = useState(true);
  const router = useRouter();

  async function signInWithEmail() {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
      const { data, error } = await supabase.auth.signUp({ email, password });
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
          'Se o login automático não funcionar, tente entrar com seus dados.',
          'Cadastro realizado!',
        );
      }
    } catch (e: any) {
      toast.error(e.message, 'Erro ao cadastrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F1F2F6' }}
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {/* Marca */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="paw" size={44} color="#FF4757" />
          </View>
          <Text style={styles.title}>PetPerdido<Text style={{ color: '#FF4757' }}>SOS</Text></Text>
          <Text style={styles.tagline}>
            A rede que reúne pets perdidos aos seus tutores.
          </Text>
        </View>

        {/* O que o app faz — apresentação rápida */}
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon as any} size={20} color="#FF4757" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureLabel}>{f.label}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Formulário */}
        <View style={styles.form}>
          <Text style={styles.formTitle}>
            {isSignUp ? 'Criar sua conta' : 'Bem-vindo de volta'}
          </Text>
          <Text style={styles.formSubtitle}>
            {isSignUp
              ? 'Em menos de um minuto você já está ajudando.'
              : 'Entre para continuar a busca.'}
          </Text>

          <View style={styles.inputGroup}>
            <Ionicons name="mail-outline" size={20} color="#747D8C" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#A4B0BE"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Ionicons name="lock-closed-outline" size={20} color="#747D8C" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Senha"
              placeholderTextColor="#A4B0BE"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={styles.keepRow}
            activeOpacity={0.7}
            onPress={() => setKeepConnected((v) => !v)}
          >
            <View style={[styles.checkbox, keepConnected && styles.checkboxChecked]}>
              {keepConnected && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </View>
            <Text style={styles.keepText}>Manter conectado</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mainButtonWrapper}
            activeOpacity={0.9}
            onPress={isSignUp ? signUpWithEmail : signInWithEmail}
            disabled={loading}
          >
            <LinearGradient
              colors={['#FF6B81', '#FF4757']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.mainButton}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.mainButtonText}>{isSignUp ? 'Criar conta' : 'Entrar'}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {isSignUp ? 'Já tem uma conta?' : 'Ainda não tem conta?'}
            </Text>
            <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
              <Text style={styles.footerLink}>
                {isSignUp ? 'Fazer login' : 'Criar conta'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Marketing velado — propósito */}
        <Text style={styles.marketing}>
          Tecnologia e comunidade trabalhando juntas para trazer cada pet de volta para casa.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 22,
  },
  iconContainer: {
    width: 76,
    height: 76,
    backgroundColor: '#FFF0F1',
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#2F3542',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14.5,
    color: '#747D8C',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  features: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFF0F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2F3542',
  },
  featureDesc: {
    fontSize: 12.5,
    color: '#747D8C',
    fontWeight: '500',
    marginTop: 1,
  },
  form: {
    backgroundColor: '#FFF',
    padding: 22,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 15,
    elevation: 5,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#2F3542',
  },
  formSubtitle: {
    fontSize: 13.5,
    color: '#747D8C',
    fontWeight: '500',
    marginTop: 3,
    marginBottom: 18,
  },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F2F6',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 14,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#2F3542',
    fontWeight: '500',
  },
  keepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    marginTop: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#DFE4EA',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#FF4757',
    borderColor: '#FF4757',
  },
  keepText: {
    color: '#747D8C',
    fontSize: 14,
    fontWeight: '600',
  },
  mainButtonWrapper: {
    marginTop: 14,
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  mainButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  footerText: {
    color: '#747D8C',
    fontSize: 14.5,
  },
  footerLink: {
    color: '#FF4757',
    fontSize: 14.5,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  marketing: {
    fontSize: 12.5,
    color: '#A4B0BE',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 22,
    paddingHorizontal: 16,
  },
});
