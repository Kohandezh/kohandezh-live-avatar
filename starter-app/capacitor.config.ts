import type { CapacitorConfig } from '@capacitor/cli';

// Native shells (android/, ios/) are generated with `npx cap add android|ios` and are gitignored
// until the team decides to commit them. The web bundle in dist/ is the single source of truth.
const config: CapacitorConfig = {
  appId: 'com.example.starter',
  appName: 'Starter App',
  webDir: 'dist',
  server: {
    // Native app runs on a local origin (capacitor://localhost / http://localhost), which is why
    // native auth uses Bearer tokens instead of cookies. See docs/engineering/SECURITY.md.
    androidScheme: 'https',
  },
};

export default config;
