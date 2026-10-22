# Next.js SaaS starter with signup protection

The Next.js SaaS starter (nextjs/saas-starter) with one signupbouncer check in its sign-up server action.

The walkthrough is
[Block burner emails in the Next.js SaaS starter](https://signupbouncer.com/guides/nextjs-saas-starter).

## What it does

- Refuses a burner (disposable) address, or a domain that can't receive mail, with a message in the starter's own
  sign-up form. The check runs in `signUp` before it hashes the password, so a refused signup creates no user and no
  team.
- Folds one Gmail inbox's dot and `+tag` spellings into one inbox, and refuses repeat signups from it after a few
  tries.
- Lets the signup through if signupbouncer is slow or down, after 1.5 seconds at most.
- Trims and lowercases email addresses in the sign-up, sign-in, account and invite forms, so `Test@test.com` and
  `test@test.com` are one account ([nextjs/saas-starter#184](https://github.com/nextjs/saas-starter/issues/184)).

What this copy changes from upstream:

| File | Change |
| --- | --- |
| `lib/signupbouncer.ts` | The signupbouncer helper (`checkSignup`, `shouldBlock`, `blockMessage`, `clientIp`). No dependencies. |
| `app/(login)/actions.ts` | The check in `signUp`, after the existing-user check and before the user is created. A refusal goes back through the form's own `{ error }` state. |
| `app/(login)/actions.ts` | The lowercase fix in each email schema, and an invitation lookup that compares the stored address in lower case. |
| `.env.example` | `SIGNUPBOUNCER_API_KEY`, and the optional `SIGNUPBOUNCER_IP_HEADER` and `SIGNUPBOUNCER_BASE_URL`. |
| `tsconfig.json` | `test` is excluded, so `next build` skips the Deno tests. |
| `package.json`, `pnpm-lock.yaml` | Next.js 16.4.2 instead of upstream's 15.6.0-canary.59. That canary is older than the fix for CVE-2026-96889, a remote code execution bug in Next.js disclosed in October 2026. The other packages keep upstream's versions. |
| `next.config.ts` | Upstream's experimental `ppr` and `clientSegmentCache` flags are gone, because Next.js 16 no longer accepts them. Pages render without Partial Prerendering. |
| `test/` | Offline tests of the sign-up action, and a live run against a running app. |

## Run it

You need Node, pnpm, Docker and a signupbouncer API key. [Sign up for signupbouncer](https://signupbouncer.com/signup)
(the Free plan needs no card), then choose "Create API key" on your app's Integration tab.

```sh
git clone https://github.com/signupbouncer/nextjs-saas-starter-signup-protection
cd nextjs-saas-starter-signup-protection
pnpm install
cp .env.example .env
docker run -d --name saas-starter-db -p 127.0.0.1:54322:5432 -e POSTGRES_PASSWORD=postgres postgres:16.4-alpine
```

Fill in `.env` as the next section shows. Then create the tables and start the app:

```sh
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000/sign-up and sign up with an address at mailinator.com. New signupbouncer apps start in
shadow mode, which logs every check and refuses nothing. To refuse signups, choose Enforce under Mode on your app's
Rules tab. The form then shows "Please sign up with a permanent email address." and the starter creates no account.

Skip `pnpm db:seed`, because it creates products in your Stripe account.

## Environment variables

| Variable | Value |
| --- | --- |
| `POSTGRES_URL` | `postgres://postgres:postgres@127.0.0.1:54322/postgres` for the Docker database above. |
| `AUTH_SECRET` | Any long random string, such as the output of `openssl rand -base64 32`. |
| `BASE_URL` | `http://localhost:3000` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Signup works with placeholder values. The pricing page, Checkout and `pnpm build` need your Stripe test keys (see `README.upstream.md`). |
| `SIGNUPBOUNCER_API_KEY` | Your `sb_live_...` key. It has no `NEXT_PUBLIC_` prefix, so it stays on the server. |
| `SIGNUPBOUNCER_IP_HEADER` | In production, the header your host overwrites with the client IP (`x-real-ip` on Vercel). Leave it unset locally, and the email is checked alone. |
| `SIGNUPBOUNCER_BASE_URL` | Only for tests against a local signupbouncer API. Leave it unset. |

## Tests

Our tests run with Deno.

```sh
deno install
deno test --no-check --import-map=test/import_map.json --allow-read=. \
  --allow-env=SIGNUPBOUNCER_API_KEY,SIGNUPBOUNCER_BASE_URL,SIGNUPBOUNCER_IP_HEADER test/
```

`test/signup_test.ts` runs the real `signUp` action and the real helper with `fetch` replaced and the database stubbed.
It covers allow, block, challenge, shadow mode, the API down or hanging, an incomplete answer, no key and the lowercase
fix. It needs no network.

`test/live.ts` posts the real sign-up form of a running app and counts rows in `users` and `teams`. Start the app with
`SIGNUPBOUNCER_BASE_URL` pointing at a signupbouncer API whose app is in Enforce mode, then run:

```sh
POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres deno run \
  --allow-net=localhost:3000,127.0.0.1:54322 '--allow-env=APP_URL,POSTGRES_URL,PG*' --allow-read=. test/live.ts
```

Add `--api-down` with that API stopped to check that a signup still goes through.

## Credit and license

This is a copy of [nextjs/saas-starter](https://github.com/nextjs/saas-starter) by Vercel, at commit
`6e33e58b1e553a41fe22e6b941a7229a002de361` (11 Dec 2025), with upstream's versions and `pnpm-lock.yaml` except
Next.js, which is 16.4.2. The starter's own README is kept as `README.upstream.md`, with the Stripe setup and the steps
for production.

MIT, as upstream. See `LICENSE`.

## signupbouncer

[signupbouncer](https://signupbouncer.com) checks new signups for burner addresses, repeat signups from one inbox and,
on paid plans, datacenter, VPN and Tor IPs.
