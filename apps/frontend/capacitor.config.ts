import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'Cross Platform App',
  // Output of `npm run build:mobile`. The web and admin builds are not shipped in the app.
  webDir: 'dist/mobile',
};

export default config;
