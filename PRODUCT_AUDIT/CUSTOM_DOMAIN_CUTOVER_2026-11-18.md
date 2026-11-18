# thisisnearby.com cutover (owner, 2026-11-18)

Branch `post-tier1/custom-domain` (from main f9f64988 = build 87 source). NOT merged. Merging it IS the
website cutover (GitHub Pages publishes main `/docs`; `docs/CNAME` sets the domain), so the merge needs
its own approval and must carry a `/business` re-export of the business website in the same push.

## Status (owner, night of 2026-11-17/18; public DNS + redirect re-checked from a session 2026-11-18)

Cutover step 1 ("now") is COMPLETE. None of it changes the live site.

| Item | State | Checked how |
|---|---|---|
| `thisisnearby.com` bought (Cloudflare, auto-renew) | done | owner |
| GitHub domain verification (TXT `_github-pages-challenge-allenklein94`) | done | owner; TXT visible in public DNS |
| Apex A x4 + AAAA x4 -> GitHub Pages | done | public DNS = the 8 GitHub addresses |
| `www` CNAME -> allenklein94.github.io | done | public DNS |
| `business` AAAA 100:: proxied + redirect rule (302, query kept) | done | `business.thisisnearby.com/?n=..&r=..&b=..` -> 302 `https://thisisnearby.com/business/?n=..&r=..&b=..` (dummy ids) |
| support@ -> owner's inbox (Email Routing) | done | owner test; apex MX = Cloudflare, SPF `include:_spf.mx.cloudflare.net` |
| DMARC `p=none; rua=mailto:support@thisisnearby.com` | done | public DNS |
| Turnstile widget: + thisisnearby.com + www, github.io KEPT | done | owner (keys unchanged) |
| Resend `mail.thisisnearby.com` verified; staging + prod keys (sending only, that domain) in Bitwarden | done | owner; DKIM + send.mail SPF/MX in public DNS; standalone send Delivered + received |
| `https://thisisnearby.com` | 404 from GitHub, no certificate yet | expected until docs/CNAME is merged |
| Privacy Policy / Terms contact = support@ | condition met (the address receives mail) | ships with the cutover merge |

Still waiting for the cutover itself (after Tier 1, each its own approval): steps 2-5 below.

## Audit (2026-11-18)

| Dependency | Today | Finding |
|---|---|---|
| GitHub Pages | main `/docs`, legacy build, no custom domain, HTTPS enforced | One custom domain per repo. No user site `allenklein94.github.io` exists (404), so this repo can take the apex. |
| Business website export | `docs/business/` built with base `/Nearby/business` | **Breaks at cutover**: under a custom domain the path is `/business/`, so every asset path is wrong until re-exported with `NEARBY_WEB_EXPORT_BASE_URL=/business` (trial export done in a scratch folder: `src="/business/_expo/..."`, no `/Nearby/`). That re-export publishes new website code = the gated website publish, so the cutover happens **after Tier 1**, together with it. |
| Other pages (index, business.html, invite, occasion-invite, shared-night, track, privacy, terms) | relative links only | Work unchanged under the new domain. |
| App share links (invite, shared night, occasion invite, live tracking) + legal links | hard-coded `allenklein94.github.io/Nearby` in 6 files | Now ONE source `src/constants/webAddresses.js`, guard `webAddresses.test.js`. Ships in a build AFTER 87 and only after the cutover is live (else the new links 404). |
| Builds <= 87 links | old address baked in | GitHub Pages redirects `allenklein94.github.io/Nearby/*` to the custom domain (path kept). **Must be checked right after cutover**, incl. query strings (`invite.html?g=`, `business/?n=&r=&b=`). |
| Supabase Auth | `site_url` = `http://localhost:3000`, redirect allow list empty (read 2026-11-18, filtered) | Nothing depends on them (phone codes, no redirects). No change needed. Optional later: site_url = `https://thisisnearby.com` (prod setting, own approval). |
| CORS | every edge function answers `*` | No change. |
| Stripe | Connect onboarding + sponsored checkout fall back to the old business URL when `BUSINESS_WEB_URL` is unset | Fallback now `https://thisisnearby.com/business/` (needs those functions redeployed, own approval); Stripe has no redirect allow list for these. Old URLs still redirect. |
| Email deep links | `send-push` uses `BUSINESS_WEB_URL` (unset) | Set it to `https://thisisnearby.com/business/` (staging first; prod = own approval). Link shape unchanged. |
| Turnstile | widget hostname = allenklein94.github.io; native WebView origin = `turnstileHost` (app.json) | Add `thisisnearby.com` to the widget's hostnames BEFORE cutover; KEEP `allenklein94.github.io` while any build <= 87 is installed. Later builds use `https://thisisnearby.com` (changed on the branch). |
| Privacy Policy + Terms contact | owner's personal Gmail (6 places) | Now `support@thisisnearby.com`; publish only once that address really receives mail. |
| Spotify | redirect = app scheme `nearby://spotify-callback` | Unaffected. |
| App Store Connect | privacy / support URLs point at github.io | Owner updates them after cutover (old ones keep redirecting). |

## Cloudflare DNS (do now: no effect on the live site until docs/CNAME is merged)

All GitHub Pages records **DNS only (grey cloud)** so GitHub can issue the HTTPS certificate.

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` | 185.199.108.153 | DNS only |
| A | `@` | 185.199.109.153 | DNS only |
| A | `@` | 185.199.110.153 | DNS only |
| A | `@` | 185.199.111.153 | DNS only |
| AAAA | `@` | 2606:50c0:8000::153 | DNS only |
| AAAA | `@` | 2606:50c0:8001::153 | DNS only |
| AAAA | `@` | 2606:50c0:8002::153 | DNS only |
| AAAA | `@` | 2606:50c0:8003::153 | DNS only |
| CNAME | `www` | allenklein94.github.io | DNS only |
| TXT | `_github-pages-challenge-allenklein94` | the value GitHub shows (step 1 below) | n/a |
| AAAA | `business` | 100:: | **Proxied** (exists only so the redirect rule can run) |

**business.thisisnearby.com**: one Pages repo can't serve a second hostname, so it redirects. Cloudflare >
Rules > Redirect Rules: when hostname equals `business.thisisnearby.com`, dynamic redirect to
`concat("https://thisisnearby.com/business", http.request.uri.path)`, **preserve query string**, status 302
while testing, 301 once verified. Canonical business URL stays `https://thisisnearby.com/business/`.
A real `business.` site later = its own Pages repo or host (separate decision).

**support@thisisnearby.com**: Cloudflare > Email > Email Routing: enable, add the custom address `support`
forwarding to your existing inbox, let Cloudflare add its MX + SPF records on the apex. Send a test from
another account. Receiving only: replying *as* support@ needs a sending setup (Resend SMTP or similar, later).

**mail.thisisnearby.com (Resend)**: add the domain `mail.thisisnearby.com` in Resend, then copy its records
(SPF on a `send.mail` name, MX, DKIM `resend._domainkey.mail`) into Cloudflare exactly as shown, DNS only.
These sit under `mail.`, so they don't conflict with Email Routing on the apex.

**DMARC**: the domain is new, so there's no existing policy (check DNS for `_dmarc` first anyway). Add TXT
`_dmarc` = `v=DMARC1; p=none; rua=mailto:support@thisisnearby.com` (once support@ receives).

## GitHub settings

1. **Verify the domain first** (prevents takeover): github.com > your account Settings > Pages > Add a
   domain > `thisisnearby.com` > add the TXT record shown > Verify. Do NOT set it on the repo yet.
2. Repo Settings > Pages: leave "Custom domain" empty for now. Merging `docs/CNAME` sets it.
3. After cutover: wait for the certificate, then tick **Enforce HTTPS**.

## Cutover order (after Tier 1, each step its own approval)

1. Now: DNS records above, GitHub domain verification, Turnstile hostname added, support@ routing tested,
   Resend domain verified. None of these changes the live site.
2. Re-export the business website with `NEARBY_WEB_EXPORT_BASE_URL=/business` from the source approved for
   the website publish, into `docs/business/` on this branch (rebased on main at that time).
3. Approved merge to main = cutover. Then check: apex + www + business. redirect over HTTPS; old
   `allenklein94.github.io/Nearby/privacy.html`, `invite.html?g=<id>` and `business/?n=x&r=<id>` land on
   the same page + query on the new domain; business website signs in and Turnstile renders.
4. Enforce HTTPS; set `BUSINESS_WEB_URL`; redeploy the two Stripe functions; update App Store Connect URLs.
5. The next build after 87 carries the new app links + Turnstile host.

## Final cutover checklist (run in this order, record each line PASS / FAIL with the time)

Before (no live effect):
- [ ] Branch rebased on the main approved for the website publish; `/business` re-export into `docs/business/` from the
      source approved for the website publish (`NEARBY_WEB_EXPORT_BASE_URL=/business npx expo export -p web`); no
      `/Nearby/` left in `docs/business/index.html`; Jest (incl. `webAddresses.test.js`) passes.
- [ ] `docs/CNAME` = `thisisnearby.com` (one line).

Cutover (= the approved merge to main):
- [ ] Repo Settings > Pages shows `thisisnearby.com`, "DNS check successful".
- [ ] Certificate issued (Pages shows it; can take up to ~1 h), then tick **Enforce HTTPS**.
- [ ] `curl -sI https://thisisnearby.com/` = 200; `http://` -> 301 https; `https://www.thisisnearby.com/` -> apex.
- [ ] Old addresses keep path + query: `https://allenklein94.github.io/Nearby/privacy.html`,
      `.../Nearby/invite.html?g=<id>`, `.../Nearby/business/?n=x&r=<uuid>&b=<uuid>` -> same page + query on thisisnearby.com.
- [ ] `https://business.thisisnearby.com/?n=x&r=<uuid>` -> `https://thisisnearby.com/business/?n=x&r=<uuid>` and the
      page loads over HTTPS (it 302s today, but the destination has no certificate before the cutover).
- [ ] Business website at `https://thisisnearby.com/business/`: assets load (no 404 in the console), phone sign-in
      works, the Turnstile widget renders, Opportunities loads (the owner's signed-in pass).
- [ ] privacy.html / terms.html show support@thisisnearby.com.

After it passes:
- [ ] Cloudflare redirect rule: 302 -> **301** (only after every line above passed; 301s are cached by browsers, so a
      later change of destination is slow to take effect).
- [ ] `BUSINESS_WEB_URL=https://thisisnearby.com/business/` on production (own approval, with the Resend secrets).
- [ ] Redeploy `business-stripe-connect-onboarding` + `create-sponsored-checkout` (new fallback; own approval).
- [ ] App Store Connect: Privacy Policy URL `https://thisisnearby.com/privacy.html`, Support URL (a page with a way to
      reach support, e.g. `https://thisisnearby.com/` if it shows support@, else a contact page), Marketing URL optional.
      Old URLs keep redirecting, so this has no deadline.
- [ ] Keep `allenklein94.github.io` on the Turnstile widget while any build <= 87 is installed.
- [ ] Later (not needed now): DMARC `p=none` -> `p=quarantine` after a few weeks of clean aggregate reports.

Rollback: delete `docs/CNAME` on main (and restore the `/Nearby/business` export); GitHub serves the
github.io address again.
