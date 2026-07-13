import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { getNearbyRegionAlerts, markRegionAlertSeen, RegionAlertView } from '../services/api';

// Via B: enquanto o app está aberto, verifica (~60s) se há alerta ativo no raio
// da localização ATUAL e mostra um banner. Aparece pra qualquer usuário ativo no
// raio (conteúdo contextual, como os pets próximos) — dedup por alerta "visto".
// Renderiza inline; o parent decide onde posicionar.
export function RegionAlertBanner({ location }: { location: { latitude: number; longitude: number } | null }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<RegionAlertView[]>([]);
  const anim = useRef(new Animated.Value(0)).current;

  const poll = useCallback(async () => {
    if (!location) return;
    const data = await getNearbyRegionAlerts(location.latitude, location.longitude);
    setAlerts((prev) => {
      // preserva a ordem/foco; só substitui se mudou o conjunto
      const ids = data.map((a) => a.id).join(',');
      const prevIds = prev.map((a) => a.id).join(',');
      return ids === prevIds ? prev : data;
    });
  }, [location]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 60000);
    return () => clearInterval(t);
  }, [poll]);

  const current = alerts[0] ?? null;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: current ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [current, anim]);

  const dismiss = () => {
    if (!current) return;
    markRegionAlertSeen(current.id);
    setAlerts((a) => a.filter((x) => x.id !== current.id));
  };

  const open = () => {
    if (!current) return;
    markRegionAlertSeen(current.id);
    router.push(`/region-alert/${current.id}` as Href);
    setAlerts((a) => a.filter((x) => x.id !== current.id));
  };

  if (!current) return null;
  const pet = current.pet;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
      ]}
    >
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={open}>
        {pet?.main_photo_url ? (
          <Image source={{ uri: pet.main_photo_url }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPh]}><Ionicons name="paw" size={18} color="#FF4757" /></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>🔎 {pet?.name ?? 'Pet perdido'} — perto de você</Text>
          <Text style={styles.sub} numberOfLines={1}>{current.comment || 'Ajude a encontrar este pet na sua região.'}</Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FF4757', borderRadius: 16, padding: 10, paddingRight: 8,
    shadowColor: '#FF4757', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  thumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.25)' },
  thumbPh: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF' },
  title: { fontSize: 14, fontWeight: '900', color: '#FFF' },
  sub: { fontSize: 12.5, color: 'rgba(255,255,255,0.9)', fontWeight: '600', marginTop: 1 },
  close: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
});
