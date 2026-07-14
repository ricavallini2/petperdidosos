import React, { useMemo, useRef } from 'react';
import {
  Animated, StyleSheet,
  type StyleProp, type ViewStyle, type ImageResizeMode, type ImageSourcePropType,
} from 'react-native';
import { PinchGestureHandler, State, type PinchGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

const MAX_SCALE = 4;

/**
 * Foto com zoom por pinça (dois dedos). O zoom é temporário: ao soltar, a imagem
 * volta ao normal com uma animação de mola.
 *
 * Usa o PinchGestureHandler NATIVO (react-native-gesture-handler) em vez de
 * PanResponder — porque o PanResponder perde o gesto para ScrollViews horizontais
 * (galerias paginadas), onde um pinch "parece" um arraste lateral. O handler nativo
 * reconhece o pinch de 2 dedos em paralelo ao scroll de 1 dedo.
 *
 * `style` define o tamanho do container (a imagem preenche via absoluteFill).
 * `onZoomStart/onZoomEnd` permitem desligar o scroll da galeria durante o pinch.
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
  const rawScale = useRef(new Animated.Value(1)).current;

  const onGestureEvent = useMemo(
    () => Animated.event([{ nativeEvent: { scale: rawScale } }], { useNativeDriver: true }),
    [rawScale],
  );

  const onStateChange = (e: PinchGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.state === State.ACTIVE) onZoomStart?.();
    if (e.nativeEvent.oldState === State.ACTIVE) {
      onZoomEnd?.();
      Animated.spring(rawScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    }
  };

  // Impede encolher abaixo de 1 e limita o zoom máximo.
  const scale = rawScale.interpolate({
    inputRange: [0.8, 1, MAX_SCALE, MAX_SCALE + 3],
    outputRange: [1, 1, MAX_SCALE, MAX_SCALE],
    extrapolate: 'clamp',
  });

  return (
    <PinchGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onStateChange}>
      <Animated.View style={style} collapsable={false}>
        <Animated.Image
          source={source}
          resizeMode={resizeMode}
          style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}
        />
      </Animated.View>
    </PinchGestureHandler>
  );
}
