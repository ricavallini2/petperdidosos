import { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, Linking, StyleSheet, ScrollView, Platform, ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

type VersionInfo = {
  version: number;          // inteiro monotônico; se > appBuild instalado, há update
  versionName?: string;     // ex.: "1.0.1" (só exibição)
  apkUrl: string;           // URL do APK no VPS
  notes?: string;           // novidades (1 item por linha)
  mandatory?: boolean;      // true => trava até atualizar
};

const API_URL = process.env.EXPO_PUBLIC_API_URL;
// Build instalado (definido em app.json -> extra.appBuild; bumpar a cada release).
const CURRENT_BUILD = Number((Constants.expoConfig?.extra as any)?.appBuild ?? 0);

/**
 * Aviso de atualização para distribuição via APK (fora da Play Store).
 * Na abertura, consulta {API_URL}/app/version; se a versão do servidor for maior
 * que a instalada, mostra um modal com as novidades e um botão que baixa/instala
 * o novo APK. Em iOS não faz nada (atualização é pela App Store).
 */
export function AppUpdateGate() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !API_URL) return; // sideload só no Android
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/app/version`, { cache: 'no-store' as RequestCache });
        if (!res.ok) return; // 204/404 => sem manifesto => sem update
        const data = (await res.json()) as VersionInfo;
        if (!cancelled && data?.apkUrl && Number(data.version) > CURRENT_BUILD) {
          setInfo(data);
        }
      } catch {
        // offline / sem servidor: simplesmente não avisa
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;
  const visible = !(dismissed && !info.mandatory);
  if (!visible) return null;

  const handleUpdate = async () => {
    try {
      setInstalling(true);
      await Linking.openURL(info.apkUrl); // navegador baixa o APK -> usuário instala
    } catch {
      // falha ao abrir o link do APK
    } finally {
      // Sempre reseta: o navegador abre e o app fica em background; ao voltar sem
      // atualizar, o botão não pode ficar travado no spinner.
      setInstalling(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => { if (!info.mandatory) setDismissed(true); }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="rocket" size={30} color="#FF4757" />
          </View>

          <Text style={styles.title}>Atualização disponível</Text>
          {!!info.versionName && <Text style={styles.version}>Versão {info.versionName}</Text>}

          {!!info.notes && (
            <ScrollView style={styles.notesBox} contentContainerStyle={{ paddingVertical: 2 }}>
              <Text style={styles.notes}>{info.notes}</Text>
            </ScrollView>
          )}

          <TouchableOpacity style={styles.updateBtn} activeOpacity={0.9} onPress={handleUpdate} disabled={installing}>
            {installing ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="download" size={18} color="#FFF" />
                <Text style={styles.updateText}>Atualizar agora</Text>
              </>
            )}
          </TouchableOpacity>

          {info.mandatory ? (
            <Text style={styles.mandatoryHint}>Esta atualização é obrigatória para continuar usando o app.</Text>
          ) : (
            <TouchableOpacity style={styles.laterBtn} onPress={() => setDismissed(true)} activeOpacity={0.7}>
              <Text style={styles.laterText}>Agora não</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: '#FFF', borderRadius: 24, padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 12,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: '#FFE8EB',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: '900', color: '#2F3542', textAlign: 'center' },
  version: { fontSize: 13.5, fontWeight: '700', color: '#A4B0BE', marginTop: 3 },
  notesBox: { maxHeight: 180, alignSelf: 'stretch', marginTop: 14, marginBottom: 4 },
  notes: { fontSize: 14.5, color: '#57606F', fontWeight: '500', lineHeight: 22 },
  updateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FF4757', height: 54, borderRadius: 16, alignSelf: 'stretch', marginTop: 18,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  updateText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  laterBtn: { height: 44, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch', marginTop: 6 },
  laterText: { color: '#A4B0BE', fontSize: 14.5, fontWeight: '700' },
  mandatoryHint: { fontSize: 12.5, color: '#A4B0BE', fontWeight: '600', textAlign: 'center', marginTop: 12, lineHeight: 17 },
});
