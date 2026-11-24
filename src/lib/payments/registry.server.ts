// Which provider adapters this server runs. Server only.
// Production: none (PROVIDER_REGISTRY is empty). The Linkwa SANDBOX adapter is added only when
// linkwaSandboxConfig() allows it (never on the production database or a production deployment).

import { PROVIDER_REGISTRY, type ProviderAdapter } from "@/lib/payments/provider.server";
import { linkwaSandboxConfig } from "@/lib/payments/linkwa-config.server";
import { getLinkwaProtocol, type LinkwaProtocol } from "@/lib/payments/linkwa-protocol";
import { createLinkwaAdapter, type LinkwaAdapter } from "@/lib/payments/linkwa.server";

type Env = Record<string, string | undefined>;

export function linkwaSandboxAdapter(
  env: Env = process.env,
  protocol: LinkwaProtocol | null = getLinkwaProtocol(),
): LinkwaAdapter | null {
  const c = linkwaSandboxConfig(env, protocol);
  return c.ok ? createLinkwaAdapter(c.config) : null;
}

export function getProviderRegistry(
  env: Env = process.env,
  protocol: LinkwaProtocol | null = getLinkwaProtocol(),
): Readonly<Record<string, ProviderAdapter>> {
  const linkwa = linkwaSandboxAdapter(env, protocol);
  return Object.freeze({ ...PROVIDER_REGISTRY, ...(linkwa ? { [linkwa.name]: linkwa } : {}) });
}
