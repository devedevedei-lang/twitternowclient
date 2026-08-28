export interface Env {
  MONITOR_KV: KVNamespace;
  TARGET_URL?: string;
}

const DEFAULT_TARGET_URL = 'https://app.twitter.now/';
// Require two consecutive failed checks (~2 minutes at the 1-minute cron
// schedule) before declaring the site down, so one transient blip doesn't
// trigger a false alarm. Recovery is declared on the first successful check.
const FAILURE_THRESHOLD = 2;
const STATUS_KEY = 'status';
const TOKEN_PREFIX = 'token:';
const REQUEST_TIMEOUT_MS = 10_000;

type Status = {
  state: 'up' | 'down';
  consecutiveFailures: number;
  lastCheckedAt: number;
  lastChangedAt: number;
};

async function checkTarget(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'user-agent': 'twitternowclient-uptime-monitor' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function loadStatus(kv: KVNamespace): Promise<Status> {
  const stored = await kv.get<Status>(STATUS_KEY, 'json');
  // Assume "up" when we've never checked before, so the very first run
  // can't immediately fire a spurious "back up" notification.
  return stored ?? { state: 'up', consecutiveFailures: 0, lastCheckedAt: 0, lastChangedAt: Date.now() };
}

async function saveStatus(kv: KVNamespace, status: Status): Promise<void> {
  await kv.put(STATUS_KEY, JSON.stringify(status));
}

async function listTokens(kv: KVNamespace): Promise<string[]> {
  const tokens: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: TOKEN_PREFIX, cursor });
    tokens.push(...page.keys.map((key) => key.name.slice(TOKEN_PREFIX.length)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return tokens;
}

function isValidExpoPushToken(token: string): boolean {
  return token.length <= 200 && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

async function sendPushNotifications(tokens: string[], title: string, body: string): Promise<void> {
  if (tokens.length === 0) return;
  const chunkSize = 100; // Expo's push API accepts at most 100 messages per request.
  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    const messages = chunk.map((to) => ({ to, title, body, sound: 'default', priority: 'high' }));
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });
    } catch (error) {
      console.error('Failed to send a push notification batch', error);
    }
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const targetUrl = env.TARGET_URL || DEFAULT_TARGET_URL;
    const ok = await checkTarget(targetUrl);
    const status = await loadStatus(env.MONITOR_KV);
    const now = Date.now();

    if (ok) {
      const wasDown = status.state === 'down';
      await saveStatus(env.MONITOR_KV, {
        state: 'up',
        consecutiveFailures: 0,
        lastCheckedAt: now,
        lastChangedAt: wasDown ? now : status.lastChangedAt,
      });
      if (wasDown) {
        const tokens = await listTokens(env.MONITOR_KV);
        ctx.waitUntil(sendPushNotifications(tokens, 'twitter.now is back up', 'The server is responding again.'));
      }
      return;
    }

    const consecutiveFailures = status.consecutiveFailures + 1;
    const shouldDeclareDown = status.state === 'up' && consecutiveFailures >= FAILURE_THRESHOLD;
    await saveStatus(env.MONITOR_KV, {
      state: shouldDeclareDown ? 'down' : status.state,
      consecutiveFailures,
      lastCheckedAt: now,
      lastChangedAt: shouldDeclareDown ? now : status.lastChangedAt,
    });

    if (shouldDeclareDown) {
      const tokens = await listTokens(env.MONITOR_KV);
      ctx.waitUntil(
        sendPushNotifications(
          tokens,
          'twitter.now looks down',
          'The server stopped responding — checking again shortly.'
        )
      );
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/register') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'invalid JSON body' }, { status: 400 });
      }
      const token = (body as { token?: unknown } | null)?.token;
      if (typeof token !== 'string' || !isValidExpoPushToken(token)) {
        return Response.json({ error: 'invalid token' }, { status: 400 });
      }
      await env.MONITOR_KV.put(`${TOKEN_PREFIX}${token}`, String(Date.now()));
      return Response.json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      return Response.json(await loadStatus(env.MONITOR_KV));
    }

    return new Response('Not found', { status: 404 });
  },
};
