import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';

// google-services.json is required for FCM push on Android. It is not committed;
// CI writes it from a secret (see README). Path can be overridden with GOOGLE_SERVICES_JSON.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
const hasGoogleServices = fs.existsSync(googleServicesFile);

const config: ExpoConfig = {
  name: 'Crew Tasks',
  slug: 'crew-tasks',
  scheme: 'crewtasks',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: process.env.ANDROID_PACKAGE || 'com.neomags.crewtasks',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#E8EAFF',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.POST_NOTIFICATIONS'],
    // Not used by this app; added transitively by libraries.
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
    ...(hasGoogleServices ? { googleServicesFile } : {}),
  },
  plugins: [
    'expo-router',
    '@react-native-community/datetimepicker',
    ['expo-notifications', { color: '#4F46E5', defaultChannel: 'default' }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Crew Tasks to attach photos to tasks as proof of work.',
        cameraPermission: 'Allow Crew Tasks to take photos as proof of work.',
        microphonePermission: false,
      },
    ],
    './plugins/withReleaseSigning.js',
  ],
  experiments: { typedRoutes: false },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
