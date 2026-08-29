// Serves /.well-known/assetlinks.json — required for Android App Links
// (https://www.conz.co.zw/... opening the installed Con Z app directly
// instead of a browser tab). Must be reachable, unauthenticated, over
// HTTPS, exactly at this path.
//
// TODO before this does anything: replace PLACEHOLDER_FILL_IN_SHA256
// below with the real SHA-256 certificate fingerprint of the signing
// key used for the Play Store release build. Get it with:
//   keytool -list -v -keystore <your-release-keystore>.jks
// (look for "SHA256:" under the certificate fingerprints), or from
// Play Console > Setup > App integrity > App signing key certificate
// once the app has been uploaded there at least once. Until this is a
// real value, Android will simply fail App Link verification and keep
// falling back to opening links in the browser — safe, just inert.
import { createFileRoute } from "@tanstack/react-router";
import { ANDROID_APP_ID } from "@/lib/platform";

const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ANDROID_APP_ID,
      sha256_cert_fingerprints: ["PLACEHOLDER_FILL_IN_SHA256"],
    },
  },
];

export const Route = createFileRoute("/.well-known/assetlinks/json")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(ASSET_LINKS), {
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
