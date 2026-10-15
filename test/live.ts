// Live run: posts the real /sign-up form of a running app (no JavaScript, the way the form works before React loads)
// and checks the users and teams tables. Needs the app running with SIGNUPBOUNCER_API_KEY set and the signupbouncer
// app behind that key in Enforce mode.
//
//   deno run --allow-net=localhost:3000,127.0.0.1:54322 '--allow-env=APP_URL,POSTGRES_URL,PG*' --allow-read=. \
//     test/live.ts            # burner refused, fresh Gmail accepted, 5th spelling of one inbox refused
//   ... test/live.ts --api-down   # with the signupbouncer API stopped: a fresh Gmail sign-up still goes through
//
// APP_URL defaults to http://localhost:3000. POSTGRES_URL is the app's database.

import postgres from 'postgres';

const app = (Deno.env.get('APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
const dbUrl = Deno.env.get('POSTGRES_URL');
if (!dbUrl) {
  console.error('POSTGRES_URL is required (the starter app database)');
  Deno.exit(2);
}
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const BLOCK_MESSAGE = 'Please sign up with a permanent email address.';
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36);

const decode = (s: string) =>
  s.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** Submits /sign-up as a browser without JavaScript does: the form's hidden fields plus email and password. */
async function signUp(email: string) {
  const page = await (await fetch(`${app}/sign-up`)).text();
  const form = page.match(/<form[^>]*>([\s\S]*?)<\/form>/)?.[1];
  if (!form) throw new Error('no form on /sign-up');
  const body = new FormData();
  for (const tag of form.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = tag.match(/name="([^"]*)"/)?.[1];
    if (name) body.set(decode(name), decode(tag.match(/value="([^"]*)"/)?.[1] ?? ''));
  }
  body.set('email', email);
  body.set('password', 'follow test password');
  const t0 = performance.now();
  const res = await fetch(`${app}/sign-up`, { method: 'POST', body, redirect: 'manual' });
  const html = await res.text();
  const ms = Math.round(performance.now() - t0);
  const location = res.headers.get('location') ?? '';
  const rows = await sql`select count(*)::int as n from users where email = ${email.toLowerCase()}`;
  const teams = await sql`select count(*)::int as n from teams where name = ${`${email.toLowerCase()}'s Team`}`;
  return {
    email,
    status: res.status,
    redirected: res.status >= 300 && res.status < 400 && location.endsWith('/dashboard'),
    refused: html.includes(BLOCK_MESSAGE),
    users: rows[0].n as number,
    teams: teams[0].n as number,
    ms
  };
}

type Result = Awaited<ReturnType<typeof signUp>>;
let failed = 0;
function expect(label: string, r: Result, want: 'accepted' | 'refused', maxMs?: number) {
  const accepted = r.redirected && r.users === 1 && r.teams === 1;
  const refused = !r.redirected && r.refused && r.users === 0 && r.teams === 0;
  let ok = want === 'accepted' ? accepted : refused;
  if (ok && maxMs !== undefined && r.ms >= maxMs) ok = false;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: ${r.email} -> HTTP ${r.status}, ` +
      `${r.redirected ? 'redirect /dashboard' : r.refused ? 'refused with the message' : 'stayed, no message'}, ` +
      `users ${r.users}, teams ${r.teams}, ${r.ms} ms`
  );
}

try {
  if (Deno.args.includes('--api-down')) {
    expect('4 API down, fails open', await signUp(`follow.down.${rand()}@gmail.com`), 'accepted', 2000);
  } else {
    expect('1 burner', await signUp(`follow-${rand()}@mailinator.com`), 'refused');
    expect('2 fresh gmail', await signUp(`follow.${rand()}@gmail.com`), 'accepted');
    const n = rand();
    const spellings = [`a.b${n}@gmail.com`, `ab${n}+1@gmail.com`, `a.b${n}+2@gmail.com`, `ab${n}+3@gmail.com`];
    for (const [i, email] of spellings.entries()) {
      expect(`3 one inbox, signup ${i + 1}`, await signUp(email), 'accepted');
    }
    expect('3 one inbox, signup 5', await signUp(`a.b.${n}@gmail.com`), 'refused');
  }
} finally {
  await sql.end();
}
console.log(failed ? `${failed} failed` : 'all passed');
Deno.exit(failed ? 1 : 0);
