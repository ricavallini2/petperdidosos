// Configuração dinâmica do Expo.
//
// Lê o app.json estático e injeta a chave do Google Maps a partir da variável
// de ambiente EXPO_PUBLIC_GOOGLE_MAPS_KEY (definida no .env, que NÃO é versionado).
// Assim a chave nunca fica hardcoded/commitada no repositório.
//
// Em build local/dev o .env é lido automaticamente. Em builds EAS, defina a
// variável em eas.json (env) ou como EAS env var/secret.

const appJson = require('./app.json');
const fs = require('fs');

module.exports = () => {
  const expo = { ...appJson.expo };

  // Push (Android/FCM): só referencia o google-services.json se ele existir —
  // assim builds antes de configurar o Firebase não quebram.
  if (fs.existsSync('./google-services.json')) {
    expo.android = { ...expo.android, googleServicesFile: './google-services.json' };
  }

  // Chaves do Google Maps por plataforma (restrições diferentes no Google Cloud:
  // Android usa pacote + SHA-1; iOS usa apenas o bundle ID). Se as específicas
  // não estiverem definidas, cai na chave única EXPO_PUBLIC_GOOGLE_MAPS_KEY.
  const androidKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY_ANDROID || process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  const iosKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY_IOS || process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;

  if (androidKey) {
    expo.android = {
      ...expo.android,
      config: {
        ...(expo.android && expo.android.config),
        googleMaps: { apiKey: androidKey },
      },
    };
  }
  if (iosKey) {
    expo.ios = {
      ...expo.ios,
      config: {
        ...(expo.ios && expo.ios.config),
        googleMapsApiKey: iosKey,
      },
    };
  }

  return { expo };
};
