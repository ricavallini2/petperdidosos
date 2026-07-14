import React, { useRef, useState } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet, PanResponder, Easing, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Filtros recolhíveis: barra no topo (chevron à direita) + gesto.
// Fechado: arrastar pra BAIXO abre (ou toque). Aberto: fecha só no toque da barra —
// arrastar pra cima NÃO fecha (evita fechar sem querer ao interagir/rolar).
// Sem dependências extras — Animated (JS driver, pois animamos height) + PanResponder.
const ANIM = { duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false };

export function CollapsibleFilters({
  children,
  accentColor = '#FF4757',
  defaultOpen = true,
}: {
  children: React.ReactNode;
  accentColor?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const openRef = useRef(defaultOpen);
  const [contentH, setContentH] = useState(0);
  const contentHRef = useRef(0);
  const anim = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current; // 0=fechado, 1=aberto

  const animateTo = (to: 0 | 1) => {
    openRef.current = to === 1;
    setOpen(to === 1);
    Animated.timing(anim, { toValue: to, ...ANIM }).start();
  };
  const toggle = () => animateTo(openRef.current ? 0 : 1);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Só assume o gesto para ABRIR: fechado + arraste pra BAIXO. Quando já está
      // aberto, NÃO rouba o gesto (arrastar pra cima não fecha; fechar é pelo toque).
      onMoveShouldSetPanResponder: (_e, g) => !openRef.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        const h = contentHRef.current || 1;
        const next = Math.max(0, Math.min(h, g.dy)); // base 0 (fechado)
        anim.setValue(next / h);
      },
      onPanResponderRelease: (_e, g) => {
        const h = contentHRef.current || 1;
        const current = Math.max(0, Math.min(h, g.dy));
        animateTo(g.vy > 0.4 || current > h / 2 ? 1 : 0);
      },
      onPanResponderTerminate: () => animateTo(openRef.current ? 1 : 0),
    }),
  ).current;

  const onContentLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== contentHRef.current) {
      contentHRef.current = h;
      setContentH(h);
    }
  };

  const height = contentH ? anim.interpolate({ inputRange: [0, 1], outputRange: [0, contentH] }) : undefined;
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const contentOpacity = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.1, 1] });

  return (
    <View style={styles.wrap}>
      {/* Barra sempre visível — arraste ou toque para abrir/fechar */}
      <View {...pan.panHandlers}>
        <TouchableOpacity style={styles.bar} activeOpacity={0.7} onPress={toggle}>
          <View style={[styles.grip, { backgroundColor: accentColor + '55' }]} />
          <Ionicons name="options-outline" size={15} color={accentColor} />
          <Text style={[styles.barText, { color: accentColor }]}>{open ? 'Ocultar filtros' : 'Filtros'}</Text>
          <View style={{ flex: 1 }} />
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="chevron-down" size={20} color={accentColor} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* Conteúdo animado (clipa ao recolher) */}
      <Animated.View style={[styles.clip, contentH ? { height } : null]}>
        <Animated.View style={[styles.content, { opacity: contentOpacity }]} onLayout={onContentLayout}>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#ECECEC' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  grip: {
    position: 'absolute', top: 5, left: '50%', marginLeft: -18,
    width: 36, height: 4, borderRadius: 2,
  },
  barText: { fontSize: 13, fontWeight: '800' },
  clip: { overflow: 'hidden' },
  content: { paddingBottom: 10, gap: 6 },
});
