// Config plugin (iOS): permite includes não-modulares dentro de framework modules.
//
// Com useFrameworks: "static" (exigido pelo Google Sign-In/Maps), o Xcode passa a
// tratar como ERRO os includes de headers do React-Core feitos por pods antigos
// (ex.: react-native-maps/AIRMap). Este plugin injeta no post_install do Podfile o
// build setting CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES=YES em todos
// os pods — correção padrão da comunidade para maps/firebase + frameworks estáticos.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SETTING = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
      end
    end`;

module.exports = function withIosNonModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes('CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES')) {
        contents = contents.replace(
          /post_install do \|installer\|/,
          `post_install do |installer|${SETTING}`,
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
