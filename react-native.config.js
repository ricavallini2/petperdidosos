// Autolinking: exclui o módulo nativo do Google Sign-In APENAS no iOS.
//
// Motivo: o pod do GoogleSignIn (AppCheckCore) exige frameworks estáticos no
// iOS, e esse modo quebra a compilação do react-native-maps. Como no iOS o
// login social é via Apple (botão Google fica oculto lá — ver app/login.tsx),
// removemos o pod do build iOS e mantemos o Google Sign-In só no Android.
//
// Para habilitar Google login no iOS no futuro: remover esta exclusão, criar o
// client OAuth iOS no Google Cloud (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/_URL_SCHEME)
// e resolver a combinação maps + useFrameworks static.
module.exports = {
  dependencies: {
    '@react-native-google-signin/google-signin': {
      platforms: {
        ios: null,
      },
    },
  },
};
