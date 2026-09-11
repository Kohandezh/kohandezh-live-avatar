import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kohandezh.assistant',
  appName: 'Dr. Kohandezh',
  // Output of `npm run build:mobile`. The web and admin builds are not shipped in the app.
  webDir: 'dist/mobile',
};

export default config;
