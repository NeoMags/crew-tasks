/**
 * Config plugin: sign Android release builds with your own keystore (needed so friends can
 * install updates over the previous APK). Reads these environment variables at build time:
 *
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 *
 * If they are not set, the release build falls back to Expo's default (debug key) and prints
 * a warning — fine for a quick test, but every machine/CI run would produce a different key.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// crew-tasks: release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const signingBlock = `
        release {
            ${MARKER}
            def ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath) {
                storeFile file(ksPath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }`;

    // 1) add a `release` signing config next to the template's `debug` one
    gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${signingBlock}`);

    // 2) inside buildTypes.release, use it when a keystore is provided
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig System.getenv("ANDROID_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug`,
    );

    if (!gradle.includes('signingConfigs.release : signingConfigs.debug')) {
      throw new Error('withReleaseSigning: could not find buildTypes.release signingConfig in app/build.gradle');
    }
    if (!process.env.ANDROID_KEYSTORE_PATH) {
      console.warn('[withReleaseSigning] ANDROID_KEYSTORE_PATH not set: release APK will be signed with the debug key.');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
