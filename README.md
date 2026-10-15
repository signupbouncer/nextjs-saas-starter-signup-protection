# Next.js SaaS starter with signup protection

The Next.js SaaS starter (nextjs/saas-starter) with one signupbouncer check in its sign-up server action. Burner
addresses and domains that cannot receive mail are refused with a message in the existing form. One Gmail inbox
signing up again under dot and `+tag` spellings is refused after a few tries. If signupbouncer is slow or down, the
sign-up goes through after at most 1.5 seconds.

Draft README. The article that walks through it will be at https://signupbouncer.com/guides/nextjs-saas-starter.

## Built from nextjs/saas-starter

This is a copy of https://github.com/nextjs/saas-starter at commit `6e33e58b1e553a41fe22e6b941a7229a002de361`
(2025-12-11), by Vercel, under the MIT license (`LICENSE`). Its own README is kept as `README.upstream.md`, with the
Stripe setup and everything else the starter does. Versions are upstream's: `next` 15.6.0-canary.59, `react` 19.1.0,
`drizzle-orm` 0.43, `stripe` 18.1, and upstream's `pnpm-lock.yaml`.

What this copy adds:

| File | Change |
| --- | --- |
| `lib/signupbouncer.ts` | The signupbouncer helper (`checkSignup`, `shouldBlock`, `clientIp`), copied as is. No dependencies. |
| `app/(login)/actions.ts` | In `signUp`, the check runs after the existing-user check and before the user is created. A refusal goes back through the form's own `{ error }` state. |
| `app/(login)/actions.ts` | Email addresses are trimmed and lowercased in sign-up, sign-in, account and invite forms, so `Test@test.com` and `test@test.com` are one account (nextjs/saas-starter#184). |
| `.env.example` | `SIGNUPBOUNCER_API_KEY`, and the optional `SIGNUPBOUNCER_IP_HEADER` and `SIGNUPBOUNCER_BASE_URL`. |
| `tsconfig.json` | `test` is excluded, so `next build` skips the Deno tests. |
| `test/` | Offline tests of the sign-up action, and a live run against a running app. |

## Run it

You need Node 18.18 or later, Postgres, and a signupbouncer API key (`sb_live_...`) from https://signupbouncer.com.

```sh
npm install
cp .env.example .env
```

Fill in `.env`:

- `POSTGRES_URL`: your database, for example `postgres://postgres:postgres@127.0.0.1:54322/saas` with
  `docker run -d -p 127.0.0.1:54322:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=saas postgres:17-alpine`.
- `AUTH_SECRET`: any long random string (`openssl rand -hex 32`).
- `BASE_URL`: `http://localhost:3000`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: sign-up works with placeholder values. Checkout, the pricing page
  and `npm run build` need real test keys (see `README.upstream.md`).
- `SIGNUPBOUNCER_API_KEY`: your key. It stays on the server, so it has no `NEXT_PUBLIC_` prefix.
- `SIGNUPBOUNCER_IP_HEADER`: the header your host overwrites with the client IP (`x-real-ip` on Vercel). Leave it
  unset locally. Without it the email is checked alone.

```sh
npm run db:migrate
npm run dev
```

Open http://localhost:3000/sign-up. New signupbouncer apps start in shadow mode, which logs every check and refuses
nothing. Switch the app to Enforce on its Rules tab when the dashboard looks right.

## Tests

Our tests run with Deno.

```sh
deno install
deno test --no-check --import-map=test/import_map.json --allow-read=. \
  --allow-env=SIGNUPBOUNCER_API_KEY,SIGNUPBOUNCER_BASE_URL,SIGNUPBOUNCER_IP_HEADER test/
```

`test/signup_test.ts` runs the real `signUp` action and the real helper with `fetch` replaced and the database stubbed:
allow, block, challenge (allowed by default), shadow mode, the API down or hanging (the sign-up goes through), a half
answer, no key, and the lowercase fix. No network.

`test/live.ts` posts the real sign-up form of a running app (`npm run dev`, with `SIGNUPBOUNCER_BASE_URL` pointing at
a signupbouncer API whose app is in Enforce mode) and counts rows in `users` and `teams`:

```sh
POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54322/saas deno run \
  --allow-net=localhost:3000,127.0.0.1:54322 '--allow-env=APP_URL,POSTGRES_URL,PG*' --allow-read=. test/live.ts
```

Add `--api-down` with the signupbouncer API stopped to check that a sign-up still goes through.

## License

MIT, as upstream. See `LICENSE`.
