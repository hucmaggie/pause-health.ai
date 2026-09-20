# Runbook: wire the contact form to email via Resend

Turns the `/contact` form from log-only (submissions currently just land in the
Vercel function logs — nobody is emailed) into real email delivery to
**hu.c.maggie@gmail.com** via Resend.

## What's already done (in code)

No app code changes are needed — `frontend/app/api/contact/route.ts` already
supports Resend. When `CONTACT_PROVIDER=resend`, it POSTs to
`https://api.resend.com/emails` with:
- `from` = `CONTACT_FROM_EMAIL`
- `to` = `CONTACT_TO_EMAIL`
- `reply_to` = the submitter's email (so you can reply to them directly)
- subject `"[Contact] <subject> — from <name>"`, plain-text body with their message

It validates name/email/message, silently drops bot submissions (honeypot +
timing), and — if `TURNSTILE_SECRET_KEY` is set — verifies a Cloudflare Turnstile
token server-side. On provider failure it returns 502 and logs `[contact] provider
error: …`.

So this runbook is **provisioning + env vars only**. All steps run in your own
tooling (Resend dashboard, Vercel) — secrets never go in the repo.

## 1. Provision Resend

Two paths — pick one:

**A. Via the Vercel Marketplace (unified billing, auto-injects RESEND_API_KEY):**
```bash
cd frontend
vercel link            # if not already linked
vercel integration add resend
# Resend is a "connectable" integration — the CLI will hand off to a browser/
# dashboard step to connect your Resend account. Finish it there.
```

**B. Directly at resend.com:**
1. Create a Resend account, then **API Keys → Create** → copy the `re_…` key.

**Verify a sending domain (required for `from`):** Resend will only send `from`
an address on a domain you've verified.
- Resend → **Domains → Add Domain** → `pause-health.ai`.
- Add the DKIM/SPF/return-path DNS records Resend shows to your DNS provider.
- Wait for **Verified**. Then `CONTACT_FROM_EMAIL` can be any address at that
  domain, e.g. `info@pause-health.ai`.
- (Quick test before the domain verifies: Resend's shared `onboarding@resend.dev`
  sender works for testing but shouldn't be the production `from`.)

The **receiving** address (`CONTACT_TO_EMAIL = hu.c.maggie@gmail.com`) needs no
verification — any inbox works.

## 2. Set the env vars in Vercel (production)

```bash
cd frontend
vercel env add CONTACT_PROVIDER production      # value: resend
vercel env add CONTACT_FROM_EMAIL production    # value: info@pause-health.ai (on the verified domain)
vercel env add CONTACT_TO_EMAIL production      # value: hu.c.maggie@gmail.com
vercel env add RESEND_API_KEY production        # value: re_…   (skip if Marketplace path A injected it)
```
Optional spam protection (recommended if the form gets abused):
```bash
vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production   # Cloudflare Turnstile site key
vercel env add TURNSTILE_SECRET_KEY production             # Turnstile secret
```
Add the same to `preview` too if you want previews to send (or leave preview on
`log` so preview submissions don't email you).

Then redeploy (or push any commit) so prod picks up the new env:
```bash
vercel --prod         # or just merge/push; Vercel auto-deploys on push to main
```

## 3. Verify end-to-end

1. Confirm the vars are set (names only; never echo secret values):
   ```bash
   vercel env ls production | grep -iE "CONTACT|RESEND|TURNSTILE"
   ```
2. Submit the live form at `https://pause-health.ai/contact` with a real message.
3. A `[Contact] …` email should arrive at **hu.c.maggie@gmail.com** within a
   minute, with the submitter's address as reply-to.
4. If nothing arrives: check the Vercel function logs for `[contact] provider
   error:` and the Resend dashboard **Logs** tab. Common causes: `from` not on a
   verified domain (Resend rejects), wrong/absent `RESEND_API_KEY`, or
   `CONTACT_PROVIDER` still `log`.

## Rollback

Set `CONTACT_PROVIDER=log` (or remove it) and redeploy — the form goes back to
log-only, delivering to no inbox. Removing `RESEND_API_KEY` also disables sending
(the route returns 502 and logs the missing-config detail).

## Notes / honesty

- Nothing here changes application code — it's config. The route already handles
  `resend` correctly (see `frontend/app/api/contact/route.ts`).
- Secrets (`RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`) live only in Vercel env, never
  in the repo. `frontend/.env.example` documents the variable names for local dev.
- The site's `mailto:` addresses (`hello@` / `invest@` / `partners@` /
  `press@pause-health.ai`) are separate direct-email links, unaffected by this.
