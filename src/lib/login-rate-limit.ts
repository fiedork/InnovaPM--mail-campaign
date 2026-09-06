const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_KEYS = 10_000;

type AttemptState = {
  failures: number;
  resetAt: number;
};

type AttemptDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const attempts = new Map<string, AttemptState>();

function removeExpired(now: number) {
  for (const [key, state] of attempts) {
    if (state.resetAt <= now) attempts.delete(key);
  }
}

export function checkLoginAttempt(
  key: string,
  now = Date.now(),
): AttemptDecision {
  const state = attempts.get(key);
  if (!state || state.resetAt <= now) {
    if (state) attempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (state.failures < MAX_FAILURES) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
  };
}

export function recordLoginFailure(key: string, now = Date.now()) {
  removeExpired(now);
  const current = attempts.get(key);
  attempts.set(key, {
    failures: current && current.resetAt > now ? current.failures + 1 : 1,
    resetAt: current && current.resetAt > now ? current.resetAt : now + WINDOW_MS,
  });

  if (attempts.size > MAX_KEYS) {
    const oldestKey = attempts.keys().next().value as string | undefined;
    if (oldestKey) attempts.delete(oldestKey);
  }
}

export function resetLoginAttempts(key: string) {
  attempts.delete(key);
}

export function clearLoginRateLimitForTests() {
  attempts.clear();
}
