import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import "../lib/fonts";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { ViewModeProvider } from "@/lib/view-mode";
import { Toaster } from "@/components/ui/sonner";
import { GuidedTourProvider } from "@/components/GuidedTourProvider";

// Public base URL of the live site — used for absolute Open Graph URLs.
// Change this to your custom domain if/when you add one.
const SITE_URL = "https://conz-build-connect.vercel.app";
const SITE_NAME = "Con Z";
const SITE_TITLE = "Con Z — Construction Made Easy";
const SITE_DESCRIPTION = "Zimbabwe's construction marketplace. Post jobs. Get tipper trucks. Build.";
const OG_IMAGE = `${SITE_URL}/og-image.jpg`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That page isn't on the map. Let's get you back to base.
        </p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-display font-bold uppercase tracking-wide">Something broke on the build site</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again — or head back to the yard.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Try again
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">Go home</a>
        </div>
        {/* Visible error detail — this screen used to hide the actual
            error, making every crash impossible to diagnose from a
            screenshot alone. Showing it here isn't a security risk (it's
            a JS error message/stack, not secrets) and is the single
            fastest way to actually fix the next one of these. */}
        <div className="mt-8 text-left rounded-lg border bg-muted/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Technical details (screenshot this)
          </p>
          <p className="text-[11px] font-mono break-words text-muted-foreground mb-1">
            {typeof window !== "undefined" ? window.location.pathname : ""}
          </p>
          <p className="text-xs font-mono break-words text-destructive">{error?.message || String(error)}</p>
          {error?.stack && (
            <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-words text-muted-foreground max-h-40 overflow-y-auto">
              {error.stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { httpEquiv: "Permissions-Policy", content: "geolocation=(self)" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "theme-color", content: "#ee6c1a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: SITE_NAME },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:type", content: "image/jpeg" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('conz.theme')||'dark';var r=document.documentElement;if(t==='dark'){r.classList.add('dark')}else{r.classList.remove('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    // Register the service worker up front (no permission prompt yet — that
    // only happens when someone taps "Enable notifications"). Registering
    // early means it's ready the moment they do.
    import("@/lib/push").then(({ registerServiceWorker }) => registerServiceWorker());
  }, []);

  useEffect(() => {
    // No-ops immediately on web (isNativePlatform() check inside). On
    // native, catches the system-browser OAuth redirect coming back into
    // the app — see capacitor-oauth-bridge.ts for why this exists.
    import("@/lib/capacitor-oauth-bridge").then(({ registerOAuthRedirectListener }) =>
      registerOAuthRedirectListener(),
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ViewModeProvider>
          <GuidedTourProvider>
            <Outlet />
            <Toaster position="top-center" richColors closeButton visibleToasts={3} />
          </GuidedTourProvider>
        </ViewModeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
