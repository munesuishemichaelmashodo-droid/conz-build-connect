import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.conz.app',
  appName: 'Con Z',
  // This is a server-rendered app (TanStack Start + Nitro), not a static
  // site — server functions (Paynow, admin actions, etc.) run on Vercel and
  // can't be bundled into the phone. So instead of loading local files from
  // webDir, Capacitor is told to load the live deployed app directly. The
  // native shell exists to get Con Z onto the Play Store, give it an app
  // icon/splash screen, and get proper Android permission prompts for
  // camera/location — the actual app still runs against your real backend.
  webDir: 'dist/client',
  server: {
    url: 'https://conz-build-connect.vercel.app',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
