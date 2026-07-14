import React, { useMemo, useRef } from 'react';
import {
  Animated, PanResponder, StyleSheet, View,
  type StyleProp, type ViewStyle, type ImageResizeMode, type ImageSourcePropType,
} from 'react-native';

const MAX_SCALE = 3.5;

/**
 * Foto com zoom por pinça (dois dedos). O zoom é temporário: ao soltar, a imagem
 * volta ao normal com uma animação de mola. Usa só PanResponder + Animated do core
 * do RN (sem gesture-handler/reanimated), então funciona em qualquer tela.
 *
 * `style` define o tamanho do container (a imagem preenche via absoluteFill).
 * `onZoomStart/onZoomEnd` permitem, p.ex., desligar o scroll de uma galeria durante o pinch.
 */
export function ZoomableImage({
  source,
  style,
  resizeMode = 'cover',
  onZoomStart,
  onZoomEnd,
}: {
  source: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
  onZoomStart?: () => void;
  onZoomEnd?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const size = useRef({ w: 0, h: 0 });
  const pinch = useRef<{ d0: number; fx: number; fy: number } | null>(null);
  const active = useRef(false);

  const reset = () => {
    if (active.current) { active.current = false; onZoomEnd?.(); }
    pinch.current = null;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }),
      Animated.spring(tx, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }),
      Animated.spring(ty, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }),
    ]).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Só captura o gesto com DOIS dedos — toques de 1 dedo (scroll/tap) passam direto.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length === 2,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderMove: (e) => {
          const ts = e.nativeEvent.touches;
          if (ts.length !== 2) return;
          const [a, b] = ts;
          const d = Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY);
          const fx = (a.locationX + b.locationX) / 2;
          const fy = (a.locationY + b.locationY) / 2;
          if (!pinch.current) {
            pinch.current = { d0: d || 1, fx, fy };
            active.current = true;
            onZoomStart?.();
            return;
          }
          const s = Math.min(MAX_SCALE, Math.max(1, d / pinch.current.d0));
          const { w, h } = size.current;
          scale.setValue(s);
          // Ancorar o zoom no ponto entre os dedos (não no centro cego).
          tx.setValue((pinch.current.fx - w / 2) * (1 - s));
          ty.setValue((pinch.current.fy - h / 2) * (1 - s));
        },
        onPanResponderRelease: reset,
        onPanResponderTerminate: reset,
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <View
      style={style}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        size.current = { w: width, h: height };
      }}
      {...responder.panHandlers}
    >
      <Animated.Image
        source={source}
        resizeMode={resizeMode}
        style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]}
      />
    </View>
  );
}
