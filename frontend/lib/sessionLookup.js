/**
 * "Who is signed in?", asked from the browser. No React or Next imports, so it
 * can be unit-tested with a fake fetch (see sessionLookup.test.js).
 *
 * The important distinction is between "the server says nobody is signed in"
 * and "we couldn't get an answer". Treating the second as the first is what
 * made a 30-minute edge blip (2026-11-10: Railway's edge answering 429) look
 * like a sign-out: the app showed "log in", the login page said you were
 * already signed in and sent you straight back, and round it went. So:
 *
 *   - 200 + a user        → "ok"
 *   - 401, or 200 without → "anonymous"   (a real answer: offer login)
 *   - deniedStatus        → "denied"      (signed in, but not allowed here)
 *   - anything else       → retried, then "unavailable" (NOT a sign-out)
 */

const DEFAULTS = {
  attempts: 3,
  backoffMs: [300, 900],
  timeoutMs: 8000,
};

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function attempt(url, timeoutMs, fetchImpl, deniedStatus) {
  let res;
  try {
    res = await fetchImpl(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: timeoutSignal(timeoutMs),
    });
  } catch (err) {
    return { done: false, reason: err?.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }

  // The server's own "not signed in".
  if (res.status === 401) return { done: true, result: { kind: 'anonymous' } };

  if (deniedStatus && res.status === deniedStatus) {
    return { done: true, result: { kind: 'denied' } };
  }

  // 429 / 5xx / anything unexpected came from in front of (or instead of)
  // the server: not a statement about the session.
  if (!res.ok) return { done: false, reason: `HTTP ${res.status}` };

  // The server always answers JSON; a 200 that isn't JSON is an edge
  // challenge or error page wearing a 200.
  const body = await res.json().catch(() => undefined);
  if (body === undefined) return { done: false, reason: 'non-JSON response' };

  if (!body?.user) return { done: true, result: { kind: 'anonymous' } };
  return { done: true, result: { kind: 'ok', user: body.user } };
}

/**
 * Ask `url` (an /api/auth/me endpoint) who the browser's session belongs to.
 * Never throws.
 *
 * options: attempts (total tries), backoffMs (pause before each retry; the
 * last value repeats), timeoutMs (per try), deniedStatus (a status that means
 * "signed in but not allowed", if the app has one), fetchImpl, sleep.
 */
export async function lookupSession(url, options = {}) {
  const attempts = Math.max(1, options.attempts ?? DEFAULTS.attempts);
  const backoffMs = options.backoffMs ?? DEFAULTS.backoffMs;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let reason = 'unknown';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const wait = backoffMs[Math.min(i - 1, backoffMs.length - 1)] ?? 0;
      if (wait > 0) await sleep(wait);
    }
    const outcome = await attempt(url, timeoutMs, fetchImpl, options.deniedStatus);
    if (outcome.done) return outcome.result;
    reason = outcome.reason;
  }
  return { kind: 'unavailable', reason };
}

/** How often the "can't reach sign-in" page re-checks, in seconds. */
export const RETRY_SECONDS = 8;

/**
 * Keep re-checking until the lookup gives a real answer, then hand it to
 * onAnswer. Returns a function that stops the loop.
 */
export function retryUntilAnswered(lookup, onAnswer, options = {}) {
  const everyMs = options.everyMs ?? RETRY_SECONDS * 1000;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let stopped = false;
  let timer;

  const tick = async () => {
    const result = await lookup();
    if (stopped) return;
    if (result.kind === 'unavailable') {
      timer = setTimer(tick, everyMs);
      return;
    }
    onAnswer(result);
  };

  timer = setTimer(tick, everyMs);
  return () => {
    stopped = true;
    clearTimer(timer);
  };
}
