export const TwitterNowUrls = {
  marketing: 'https://twitter.now/',
  app: 'https://app.twitter.now/',
  login: 'https://app.twitter.now/login',
  termsOfService: 'https://twitter.now/terms-of-service/',
} as const;

/**
 * Hosts that are safe to render inside the in-app WebView. Anything else
 * (payment processors, OAuth providers, external links, ...) is handed off
 * to the system browser instead of being loaded in-app.
 */
export const AllowedWebViewHosts = ['twitter.now', 'app.twitter.now', 'www.twitter.now'];

export function isAllowedWebViewHost(url: string) {
  try {
    const { hostname } = new URL(url);
    return AllowedWebViewHosts.includes(hostname);
  } catch {
    return false;
  }
}
