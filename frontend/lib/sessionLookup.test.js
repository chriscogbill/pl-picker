import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSession, retryUntilAnswered } from './sessionLookup.js';

const ME = 'https://api.example.test/api/auth/me';
const USER = { userId: 7, email: 'someone@example.test', username: 'someone', role: 'user' };

/** A fetch that answers from a script, one entry per call (last entry repeats). */
function scripted(script) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ url: String(input), init });
    return script[Math.min(calls.length - 1, script.length - 1)]();
  };
  return { fetchImpl, calls };
}

const json = (status, body) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (status, body) => () => new Response(body, { status });
const throws = (name) => () => {
  const err = new Error(name);
  err.name = name;
  throw err;
};

const fast = { sleep: async () => {} };

test('signed-in session is returned from a single call, sent with the cookie', async () => {
  const { fetchImpl, calls } = scripted([json(200, { success: true, user: USER })]);
  const r = await lookupSession(ME, { fetchImpl, ...fast });
  assert.deepEqual(r, { kind: 'ok', user: USER });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ME);
  assert.equal(calls[0].init.credentials, 'include');
});

test('401 is anonymous and is not retried', async () => {
  const { fetchImpl, calls } = scripted([json(401, { success: false, error: 'Not authenticated' })]);
  assert.deepEqual(await lookupSession(ME, { fetchImpl, ...fast }), { kind: 'anonymous' });
  assert.equal(calls.length, 1);
});

test('200 without a user is anonymous', async () => {
  const { fetchImpl } = scripted([json(200, { success: false })]);
  assert.deepEqual(await lookupSession(ME, { fetchImpl, ...fast }), { kind: 'anonymous' });
});

// The 2026-11-10 incident: the edge answered 429 on roughly half of calls.
test('a 429 is retried and the session is recovered', async () => {
  const { fetchImpl, calls } = scripted([
    text(429, 'rate limited'),
    json(200, { success: true, user: USER }),
  ]);
  const r = await lookupSession(ME, { fetchImpl, ...fast });
  assert.equal(r.kind, 'ok');
  assert.equal(calls.length, 2);
});

test('persistent 429 is unavailable, never anonymous', async () => {
  const { fetchImpl, calls } = scripted([text(429, 'rate limited')]);
  const r = await lookupSession(ME, { fetchImpl, ...fast });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'HTTP 429' });
  assert.equal(calls.length, 3);
});

test('5xx, network errors and timeouts are unavailable', async () => {
  for (const [step, reason] of [
    [text(503, 'upstream'), 'HTTP 503'],
    [throws('TypeError'), 'network error'],
    [throws('TimeoutError'), 'timeout'],
  ]) {
    const { fetchImpl } = scripted([step]);
    assert.deepEqual(await lookupSession(ME, { fetchImpl, ...fast }), { kind: 'unavailable', reason });
  }
});

test("a 200 that isn't JSON (edge challenge page) is unavailable", async () => {
  const { fetchImpl } = scripted([text(200, '<html>checking your browser</html>')]);
  assert.deepEqual(await lookupSession(ME, { fetchImpl, ...fast }), {
    kind: 'unavailable',
    reason: 'non-JSON response',
  });
});

test('403 is unavailable unless the app names it as its "denied" status', async () => {
  const forbidden = json(403, { success: false, error: 'Access denied' });
  const plain = scripted([forbidden]);
  assert.deepEqual(await lookupSession(ME, { fetchImpl: plain.fetchImpl, ...fast }), {
    kind: 'unavailable',
    reason: 'HTTP 403',
  });
  const named = scripted([forbidden]);
  assert.deepEqual(
    await lookupSession(ME, { fetchImpl: named.fetchImpl, deniedStatus: 403, ...fast }),
    { kind: 'denied' },
  );
  assert.equal(named.calls.length, 1);
});

test('backoff waits between tries, and attempts is respected', async () => {
  const waits = [];
  const { fetchImpl, calls } = scripted([text(502, 'bad gateway')]);
  await lookupSession(ME, {
    fetchImpl,
    attempts: 4,
    backoffMs: [10, 20],
    sleep: async (ms) => void waits.push(ms),
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [10, 20, 20]);
});

test('retryUntilAnswered keeps checking until there is a real answer', async () => {
  const answers = [
    { kind: 'unavailable', reason: 'HTTP 429' },
    { kind: 'unavailable', reason: 'HTTP 429' },
    { kind: 'ok', user: USER },
  ];
  let lookups = 0;
  const pending = [];
  const got = await new Promise((resolve) => {
    retryUntilAnswered(async () => answers[lookups++], resolve, {
      everyMs: 5,
      setTimer: (fn) => {
        pending.push(fn);
        queueMicrotask(() => pending.shift()());
        return pending.length;
      },
      clearTimer: () => {},
    });
  });
  assert.deepEqual(got, { kind: 'ok', user: USER });
  assert.equal(lookups, 3);
});

test('retryUntilAnswered stops when told to', async () => {
  let lookups = 0;
  let answered = false;
  let fire;
  const stop = retryUntilAnswered(
    async () => {
      lookups++;
      return { kind: 'ok', user: USER };
    },
    () => {
      answered = true;
    },
    { setTimer: (fn) => void (fire = fn), clearTimer: () => {} },
  );
  const running = fire();
  stop();
  await running;
  assert.equal(lookups, 1);
  assert.equal(answered, false);
});
