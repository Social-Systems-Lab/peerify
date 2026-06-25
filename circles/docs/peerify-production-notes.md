# Peerify Production Notes

Last updated: 2026-06-25

## Deployment

Peerify production runs from:

* Repository: `/home/tim/apps/peerify-app`
* App directory: `/home/tim/apps/peerify-app/circles`
* Production URL: `https://peerify.one`
* PM2 process: `peerify`

Deploy with:

```bash
cd /home/tim/apps/peerify-app/circles
./scripts/deploy-peerify.sh
```

The deploy script builds the app, copies static/public assets into the nested Next standalone app directory, and starts PM2 using:

```text
.next/standalone/apps/peerify-app/circles/server.js
```

This nested path is required because the split Peerify repo is built as a nested standalone app.

## Required production environment variables

`.env.local` must include the normal Peerify runtime values, plus:

```bash
ALTCHA_HMAC_KEY=<secret>
CIRCLES_URL=https://peerify.one
NEXT_PUBLIC_SITE_URL=https://peerify.one
POSTMARK_API_TOKEN=<postmark-server-api-token>
POSTMARK_SENDER_EMAIL=<verified-sender-email>
```

Notes:

* `ALTCHA_HMAC_KEY` powers the signup human-verification challenge.
* `CIRCLES_URL` is used when generating email verification links.
* Postmark requires a **Server API token**, not an Account API token.
* The Postmark sender signature display name is managed in Postmark. Current shared sender branding is `Social Systems Lab`.

## Production health checks

After deployment, verify:

```bash
curl -fsSL https://peerify.one/api/version && echo
curl -fsSL https://peerify.one/api/altcha/challenge | head -c 300 && echo
curl -I https://peerify.one/signup/pilot
```

Expected:

* `/api/version` returns JSON with the deployed git SHA and build time.
* `/api/altcha/challenge` returns ALTCHA challenge JSON.
* `/signup/pilot` returns `200 OK`.

## Notes from ALTCHA/Postmark pass

On 2026-06-25, Peerify signup was updated with ALTCHA human verification and Postmark email verification.

Related fixes included:

* Added ALTCHA challenge API and server-side verification.
* Added ALTCHA widget to public and pilot signup forms.
* Fixed Peerify standalone PM2 deployment path.
* Fixed standalone static/public asset copying for CSS/images.
* Configured Postmark email delivery for Peerify.
* Updated verification and notification email branding from Kamooni to Peerify.
* Changed platform announcements title to `Peerify Announcements`.
