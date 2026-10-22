// The sign-up server action with the signupbouncer check, offline. fetch is replaced, so the real helper
// (lib/signupbouncer.ts) runs against canned answers; the database, session and Next.js modules are stand-ins
// (test/stubs, mapped in test/import_map.json).
//
//   deno test --no-check --import-map=test/import_map.json --allow-read=. \
//     --allow-env=SIGNUPBOUNCER_API_KEY,SIGNUPBOUNCER_BASE_URL,SIGNUPBOUNCER_IP_HEADER test/

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.13';
import { PgDialect } from 'drizzle-orm/pg-core';
import { signUp } from '../app/(login)/actions.ts';
import { DEFAULT_BLOCK_MESSAGE } from '../lib/signupbouncer.ts';
import { inserted, ops, resetDb, selectResults } from './stubs/drizzle.ts';
import { request } from './stubs/next-headers.ts';
import { Redirect } from './stubs/next-navigation.ts';

type Answer = 'allow' | 'challenge' | 'block';

/** A complete /v1/check answer, as the API sends it. Only a complete answer can refuse a sign-up. */
function answer(action: Answer, mode: 'enforce' | 'shadow' = 'enforce') {
  return {
    verdict: action,
    action: mode === 'shadow' ? 'allow' : action,
    mode,
    score: { allow: 0, challenge: 45, block: 100 }[action],
    check_id: 'chk_test',
    reasons: action === 'allow'
      ? []
      : [{ code: 'burner_domain', detail: 'test', points: 100, tier: 'free' }],
    shadow: [],
    normalized: { provider: 'gmail', repeat_signups_7d: 0 },
    network: null,
    latency_ms: 3,
    quota_exceeded: false
  };
}

type Call = { url: string; auth: string | null; body: Record<string, string> };
const realFetch = globalThis.fetch;
const realWarn = console.warn;

/** Replaces fetch for one test. Returns the calls made and the warnings logged. */
function mockFetch(reply: (signal: AbortSignal | undefined) => Promise<Response>) {
  const calls: Call[] = [];
  const warnings: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body))
    });
    return reply(init?.signal ?? undefined);
  };
  console.warn = (...a: unknown[]) => void warnings.push(a.join(' '));
  return { calls, warnings };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function form(email: string, inviteId = '', password = 'a long password') {
  const f = new FormData();
  f.set('email', email);
  f.set('password', password);
  f.set('redirect', '');
  f.set('priceId', '');
  f.set('inviteId', inviteId);
  return f;
}

/** Runs signUp. Returns where it redirected, or the state it gave back to the form. */
async function submit(email: string, inviteId = '') {
  try {
    const state = await signUp({ error: '' }, form(email, inviteId));
    return { redirect: undefined, state };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.url, state: undefined };
    throw e;
  }
}

function setup(env: Record<string, string> = {}) {
  resetDb();
  selectResults.push([]); // no existing user with this email
  request.headers = new Headers({ 'user-agent': 'test-agent', 'x-real-ip': '203.0.113.7' });
  for (const k of ['SIGNUPBOUNCER_API_KEY', 'SIGNUPBOUNCER_BASE_URL', 'SIGNUPBOUNCER_IP_HEADER']) {
    Deno.env.delete(k);
  }
  Deno.env.set('SIGNUPBOUNCER_API_KEY', 'sb_live_test');
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
}

function teardown() {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
}

Deno.test('allow: the user and team are created and the action redirects to /dashboard', async () => {
  setup();
  const { calls } = mockFetch(() => json(answer('allow')));
  try {
    const r = await submit('new.user@gmail.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(inserted('users').length, 1);
    assertEquals(inserted('teams').length, 1);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, 'https://signupbouncer.com/v1/check');
    assertEquals(calls[0].auth, 'Bearer sb_live_test');
    // No IP header named: the email is checked alone.
    assertEquals(calls[0].body, { email: 'new.user@gmail.com', user_agent: 'test-agent' });
  } finally {
    teardown();
  }
});

Deno.test('block: the form gets the message back and no user is created', async () => {
  setup();
  mockFetch(() => json(answer('block')));
  try {
    const r = await submit('someone@mailinator.com');
    assertEquals(r.redirect, undefined);
    assertEquals(r.state, {
      error: DEFAULT_BLOCK_MESSAGE,
      email: 'someone@mailinator.com',
      password: 'a long password'
    });
    assertEquals(inserted('users').length, 0);
    assertEquals(inserted('teams').length, 0);
  } finally {
    teardown();
  }
});

Deno.test('block: the form shows the message set on the Rules tab when the answer carries one', async () => {
  setup();
  const words = 'Sign up with your work email, please.';
  mockFetch(() => json({ ...answer('block'), block_message: words }));
  try {
    const r = await submit('someone@mailinator.com');
    assertEquals(r.state?.error, words);
    assertEquals(inserted('users').length, 0);
  } finally {
    teardown();
  }
});

Deno.test('challenge: allowed at the default, the user is created', async () => {
  setup();
  mockFetch(() => json(answer('challenge')));
  try {
    const r = await submit('a.b+3@gmail.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(inserted('users').length, 1);
  } finally {
    teardown();
  }
});

Deno.test('shadow mode: a block verdict still allows the sign-up', async () => {
  setup();
  mockFetch(() => json(answer('block', 'shadow')));
  try {
    const r = await submit('someone@mailinator.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(inserted('users').length, 1);
  } finally {
    teardown();
  }
});

Deno.test('API down: a network error fails open and logs the reason', async () => {
  setup();
  const { warnings } = mockFetch(() => Promise.reject(new TypeError('connection refused')));
  try {
    const r = await submit('new.user@gmail.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(inserted('users').length, 1);
    assertEquals(warnings, ['signupbouncer: network ']);
  } finally {
    teardown();
  }
});

Deno.test('API down: a 503 fails open', async () => {
  setup();
  const { warnings } = mockFetch(() => json({ error: 'down' }, 503));
  try {
    const r = await submit('new.user@gmail.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(warnings, ['signupbouncer: http_status 503']);
  } finally {
    teardown();
  }
});

Deno.test('API hangs: the sign-up goes through after the 1.5 s timeout', async () => {
  setup();
  const { warnings } = mockFetch((signal) =>
    new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  );
  try {
    const t0 = performance.now();
    const r = await submit('new.user@gmail.com');
    const ms = performance.now() - t0;
    assertEquals(r.redirect, '/dashboard');
    assert(ms >= 1400 && ms < 2000, `took ${Math.round(ms)} ms`);
    assertEquals(warnings, ['signupbouncer: timeout ']);
  } finally {
    teardown();
  }
});

Deno.test('a half answer cannot refuse: block without the full fields fails open', async () => {
  setup();
  const { warnings } = mockFetch(() => json({ action: 'block' }));
  try {
    const r = await submit('someone@mailinator.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(warnings, ['signupbouncer: bad_response 200']);
  } finally {
    teardown();
  }
});

Deno.test('no API key: no call, the sign-up goes through, the reason is logged', async () => {
  setup();
  Deno.env.delete('SIGNUPBOUNCER_API_KEY');
  const { calls, warnings } = mockFetch(() => json(answer('block')));
  try {
    const r = await submit('new.user@gmail.com');
    assertEquals(r.redirect, '/dashboard');
    assertEquals(calls.length, 0);
    assertEquals(warnings, ['signupbouncer: missing_api_key ']);
  } finally {
    teardown();
  }
});

Deno.test('SIGNUPBOUNCER_BASE_URL and SIGNUPBOUNCER_IP_HEADER are used when set', async () => {
  setup({ SIGNUPBOUNCER_BASE_URL: 'http://127.0.0.1:8080/', SIGNUPBOUNCER_IP_HEADER: 'x-real-ip' });
  const { calls } = mockFetch(() => json(answer('allow')));
  try {
    await submit('new.user@gmail.com');
    assertEquals(calls[0].url, 'http://127.0.0.1:8080/v1/check');
    assertEquals(calls[0].body.ip, '203.0.113.7');
  } finally {
    teardown();
  }
});

Deno.test('an empty SIGNUPBOUNCER_BASE_URL falls back to the hosted API', async () => {
  setup({ SIGNUPBOUNCER_BASE_URL: '' });
  const { calls } = mockFetch(() => json(answer('allow')));
  try {
    await submit('new.user@gmail.com');
    assertEquals(calls[0].url, 'https://signupbouncer.com/v1/check');
  } finally {
    teardown();
  }
});

Deno.test('#184: the email is lowercased before the check and the insert', async () => {
  setup();
  const { calls } = mockFetch(() => json(answer('allow')));
  try {
    await submit('  Test.User@Gmail.COM ');
    assertEquals(calls[0].body.email, 'test.user@gmail.com');
    assertEquals(inserted('users')[0].values?.email, 'test.user@gmail.com');
  } finally {
    teardown();
  }
});

Deno.test('an existing user is refused before any check is made', async () => {
  setup();
  selectResults[0] = [{ id: 1, email: 'taken@gmail.com' }];
  const { calls } = mockFetch(() => json(answer('allow')));
  try {
    const r = await submit('Taken@gmail.com');
    assertEquals(r.state?.error, 'Failed to create user. Please try again.');
    assertEquals(calls.length, 0);
    assertEquals(inserted('users').length, 0);
  } finally {
    teardown();
  }
});

Deno.test('#184: an invitation stored with capitals still matches the lowercased email', async () => {
  setup();
  selectResults.push([{ id: 7, teamId: 3, role: 'member', email: 'Ann@Gmail.com', status: 'pending' }]);
  selectResults.push([{ id: 3, name: 'Team' }]);
  mockFetch(() => json(answer('allow')));
  try {
    const r = await submit('Ann@Gmail.com', '7');
    assertEquals(r.redirect, '/dashboard');
    const lookup = ops.find((o) => o.op === 'select' && o.table === 'invitations');
    assert(lookup?.where, 'the invitation lookup has a where clause');
    const q = new PgDialect().sqlToQuery(lookup.where);
    assertStringIncludes(q.sql, 'lower("invitations"."email") = $');
    assert(q.params.includes('ann@gmail.com'));
    assertEquals(inserted('teams').length, 0);
    assertEquals(inserted('team_members')[0].values?.teamId, 3);
  } finally {
    teardown();
  }
});
