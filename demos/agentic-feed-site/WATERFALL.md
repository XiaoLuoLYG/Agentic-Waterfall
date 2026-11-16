# Agentic Waterfall hosted demo

This directory contains the source of the Sites-hosted research demo. The snapshot was copied from the deployed Sites source commit `92065f536306cf20f0505e958300247c0f47a46d`.

- `public/`: participant interface, feed, profile, blind selection and trajectory views.
- `lib/waterfall/`: recommendation, source acquisition, research records and cloud handlers.
- `db/` and `drizzle/`: cloud database schema and migrations.
- `scripts/bilibili-relay.mjs`: optional Mac relay for Bilibili search when the hosting environment is blocked.

The relay polls the Site for Bilibili search jobs and uses a secret from `.sites-runtime/bilibili-relay-token`. The Site uses the corresponding `BILIBILI_RELAY_TOKEN` runtime secret. No token, provider credentials, account records or research data are included in this repository. The relay is available only while its host is running and connected.

Run the source tests from this directory with `node --test test/*.test.mjs`. Model and provider credentials belong in the hosting environment, never in source control.


## Hosted build

Use Node.js 22.13 or newer. Run the commands below from this directory. The built Worker preview uses local D1 and R2 state.

```sh
npm run install:ci
npm run build
npm start
```
