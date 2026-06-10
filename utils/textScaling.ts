import React from 'react';
import { Text, TextInput } from 'react-native';

/**
 * Limita o fator de aumento de fonte do sistema (acessibilidade) para que
 * fontes muito grandes no aparelho NÃO quebrem o layout do app.
 *
 * Mantém um aumento moderado (até +20%) — o suficiente para ajudar quem precisa
 * de letras maiores, sem estourar telas densas (cards, badges, abas, botões).
 *
 * Aplica um padrão global em <Text> e <TextInput>. Telas que quiserem outro
 * limite podem passar `maxFontSizeMultiplier` explicitamente — este patch
 * respeita o valor próprio quando informado.
 *
 * Observação: no React 19 o antigo `Text.defaultProps` deixou de funcionar, por
 * isso o padrão é injetado via override do `render` (forma compatível com RN 0.81).
 */
export const MAX_FONT_SCALE = 1.2;

function capFontScale(Component: any) {
  if (!Component || Component.__fontScaleCapped) return;
  const originalRender = Component.render;
  if (typeof originalRender !== 'function') return;

  Component.render = function patchedRender(props: any, ref: any) {
    const element = originalRender.call(this, props, ref);
    if (element && element.props && element.props.maxFontSizeMultiplier == null) {
      return React.cloneElement(element, { maxFontSizeMultiplier: MAX_FONT_SCALE });
    }
    return element;
  };
  Component.__fontScaleCapped = true;
}

capFontScale(Text);
capFontScale(TextInput);
