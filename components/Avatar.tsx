import React from 'react';
import { View, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Avatar de usuário com imagem padrão do app.
 * - Com `uri`: mostra a foto.
 * - Sem `uri` (usuário ocultou a foto ou não tem): mostra o avatar padrão
 *   definido pelo app (círculo cinza com ícone de pessoa).
 */
export function Avatar({
  uri,
  size,
  style,
}: {
  uri?: string | null;
  size: number;
  style?: StyleProp<ViewStyle | ImageStyle>;
}) {
  const base = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[base, style as any]} />;
  }

  return (
    <View style={[base, style as any, styles.fallback]}>
      <Ionicons name="person" size={Math.round(size * 0.52)} color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  // A cor de fundo vem por último para sempre vencer um backgroundColor herdado
  // do estilo passado (ex.: avatares com fundo claro).
  fallback: { backgroundColor: '#B9C2CF', justifyContent: 'center', alignItems: 'center' },
});
