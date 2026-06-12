import React from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';

/**
 * Ajustes globais de tipografia, aplicados em <Text> e <TextInput>:
 *
 * 1) Limita o fator de aumento de fonte do sistema (acessibilidade) para que
 *    fontes muito grandes no aparelho NÃO quebrem o layout (cap de +20%).
 *
 * 2) iOS: reduz levemente as fontes (fator 0.95). As telas dos iPhones têm
 *    largura útil menor que a maioria dos Androids, e o mesmo fontSize fica
 *    visualmente maior — truncando abas e estourando chips. Ajustar aqui evita
 *    mexer tela a tela; calibrar = trocar IOS_FONT_FACTOR (ex.: 0.93 p/ menor).
 *    Só escala elementos com fontSize explícito — filhos sem fontSize herdam o
 *    tamanho (já reduzido) do pai, mantendo a hierarquia correta.
 *
 * Telas que precisarem de outro limite de acessibilidade podem passar
 * `maxFontSizeMultiplier` explicitamente — o patch respeita o valor próprio.
 *
 * Observação: no React 19 o antigo `Text.defaultProps` deixou de funcionar, por
 * isso o padrão é injetado via override do `render` (compatível com RN 0.81).
 */
export const MAX_FONT_SCALE = 1.2;
export const IOS_FONT_FACTOR = 0.95;

function patchText(Component: any) {
  if (!Component || Component.__textScalingPatched) return;
  const originalRender = Component.render;
  if (typeof originalRender !== 'function') return;

  Component.render = function patchedRender(props: any, ref: any) {
    const element = originalRender.call(this, props, ref);
    if (!element || !element.props) return element;

    const extra: Record<string, unknown> = {};
    if (element.props.maxFontSizeMultiplier == null) {
      extra.maxFontSizeMultiplier = MAX_FONT_SCALE;
    }

    if (Platform.OS === 'ios') {
      const flat = StyleSheet.flatten(element.props.style);
      if (flat && typeof flat.fontSize === 'number') {
        const scaled: { fontSize: number; lineHeight?: number } = {
          fontSize: Math.round(flat.fontSize * IOS_FONT_FACTOR * 10) / 10,
        };
        if (typeof flat.lineHeight === 'number') {
          scaled.lineHeight = Math.round(flat.lineHeight * IOS_FONT_FACTOR * 10) / 10;
        }
        extra.style = [element.props.style, scaled];
      }
    }

    return Object.keys(extra).length ? React.cloneElement(element, extra) : element;
  };
  Component.__textScalingPatched = true;
}

patchText(Text);
patchText(TextInput);
