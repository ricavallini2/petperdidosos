// Config plugin (iOS): modular headers para as dependências do Google Maps SDK.
//
// O Google Maps iOS SDK 9.x (pod react-native-google-maps) depende do
// AppCheckCore (Swift), que exige que GoogleUtilities e RecaptchaInterop gerem
// module maps. Sem isso o pod install falha ("Swift pods cannot yet be
// integrated as static libraries"). Marcar só esses dois pods com
// :modular_headers => true resolve sem precisar de use_frameworks (que quebra
// a compilação do react-native-maps). Mesma técnica dos guias Expo+Firebase.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PODS = `
  pod 'GoogleUtilities', :modular_headers => true
  pod 'RecaptchaInterop', :modular_headers => true
`;

module.exports = function withIosGoogleMapsPods(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(":modular_headers => true")) {
        contents = contents.replace(/(target\s+'[^']+'\s+do)/, `$1${PODS}`);
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
