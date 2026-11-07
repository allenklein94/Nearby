# Link destination safety (20270396), staged, NOT deployed

Owner approved 2026-11-07: a narrowly scoped malicious-link check for public text. Branch `post-tier1/link-safety` (stacked
on `post-tier1/removal-followups`), not merged, not deployed, not in build 87. Own deploy approval, after 0395 (and after 0373,
which it extends: it protects nothing until 0373 is live).

## Provider evaluation (before implementation)

| | Google Safe Browsing v4 | Google Web Risk (chosen) |
|---|---|---|
| Commercial use | **No**: "for non-commercial use only" | Yes (Google Cloud product) |
| Lists | malware, social engineering, unwanted software | same lists, commercial terms |
| Cost | free | Lookup API `uris:search`: first 100,000 calls a month free, then $0.50 per 1,000 (100k-10M) |
| What is sent | URL hashes (Update API) or URLs | the full URL (Lookup API) |
| Setup | API key | Google Cloud project with billing, Web Risk API enabled, API key |

Not chosen: Safe Browsing v4 (licence); third-party URL reputation services (another vendor + data processor, owner
declined vendors for trust & safety); the Web Risk Update API (local hash lists: no URL leaves Nearby, but needs a stored,
refreshed database and a paid `hashes.search` confirmation at $50 per 1,000 in the first tier).

**Expected cost:** one lookup per link plus one per redirect hop (at most 5 links, 5 hops). A budget in the database caps
lookups at 200 per account and 3,000 for everyone per day (about 90,000 a month), inside the free 100,000. At the cap, linked
text can't be published that day (fail closed); text without links is never affected. Raising the cap = a migration.

**Privacy:** the links in a public text (not the rest of the text, not who wrote it) are sent to Google. Draft Privacy Policy
sentence (needs approval + legal review, publish with the deploy): "When you publish text with a link in it (for example a
gathering description), we send the link, and any address it redirects to, to Google Web Risk to check that it isn't a known
phishing or malware site. We don't store the link for this check."

## What it does

- ONE detector, in the database (`private.ugc_links`): plain links, `www.`, bare domains (any script, so look-alike Cyrillic
  names count), IPv4; and the usual disguises: `dot com`, `[.]`, `(dot)`, `hxxp`, full-width letters and dots, invisible
  characters, `http:\\`, `user@host` links, a name glued to text in another script. Email addresses, decimals, times and
  abbreviations are not links. The edge function asks the database which links to check, so the two never disagree.
- Public text with a link needs a result recorded by the link-checking `screen-user-content`: every link, plus the
  destinations recognisably embedded in it (query values, path, fragment, after percent-decoding), looked up in Web Risk.
  NOTHING user-submitted is ever fetched, resolved or followed (Option B, below). Old (word-only) results don't count: refused `link_check_required`.
- Listed destination = refused `link_not_allowed` (stored: verdict + threat types only, no URL), whatever the language rule.
- Fail closed, nothing recorded: Web Risk down, no key, budget used up (503); a known shortener / link-in-bio page (also
  when embedded), a private / local / non-web-port address, an embedded destination that won't parse, more than 5 links,
  more than 3 embedded destinations in a link, nesting deeper than 2, or more than 15 lookups for one text (planned before
  any call; refused, the app's existing "change it" words).
- Applies to all of 0373's public text (gathering title + description, community name + description, profile text, Q&A,
  photo comments): one rule, so a link moved from a gathering into a community or bio gets the same check.
- No new screen, string, client change, score or chat scanning. Logs keep counts only.

## Verified (2026-11-07, local)

- Fresh replay 520/520 (real Auth first). Journey `linkSafety` 6/6 (detector, bypasses, clean/malicious, forged results,
  budget). Journeys 1170/1170. Deno tests `supabase/functions/_shared/linkSafety_test.ts` 15/15 (fake Web Risk + sites:
  safe, listed, shortener -> listed, shortener unresolved, too many hops, loops, private addresses incl. DNS + metadata IP,
  redirect to private / javascript:, userinfo, outage / no key / no budget, several links). `deno check` of the edge function
  passes. `scripts/replay/link-check-budget-concurrency.js` 5 rounds pass. Rollback + re-apply: schema identical (0 diff lines).
  Guard `src/utils/linkSafetyGuard.test.js`.
- See the history entry for the full regression numbers.

## Focused security verification (owner, 2026-11-07, second pass)

Read the code, not the summary. Results:

- **SSRF: one real defect FOUND + FIXED** (edge-function code only; migration 0396 unchanged).
  (a) `isPrivateAddress` matched IPv6 as text, so a DNS answer in hex IPv4-mapped (`::ffff:7f00:1`), NAT64
  (`64:ff9b::a9fe:a9fe` = the cloud metadata address) or 6to4 (`2002:c0a8:...`) form counted as public and was fetched.
  Literal URLs like `http://[::ffff:127.0.0.1]` were already refused, but only by accident (the hex form has no dot).
  Now IPv6 is parsed into its 8 groups and any embedded IPv4 is judged as IPv4; unreadable = private; documentation ranges added.
  (b) If the runtime had no `Deno.resolveDns`, the DNS check was skipped (fail OPEN). Now a named host is never fetched
  without a DNS check (unverifiable = refused). DEPLOY CHECK: confirm `Deno.resolveDns` exists in Supabase's edge runtime,
  or every link will be refused.
  Deno tests 20/20 (5 new; 3 fail on the previous code). Already in place, re-read: http/https only, ports 80/443 only,
  localhost / .local / .internal / .home.arpa / dotless names refused, every redirect hop re-checked before fetch
  (`redirect: manual`), max 5 hops, 4 s per hop, body never read, credentials dropped, Web Risk called with `redirect: error`.
  The request is a blind GET: nothing from the fetched page reaches the user.
- **DNS rebinding: still a limit, not fixed** (resolved by Option B, below: no fetching). The check resolves, then `fetch` resolves again; Deno's fetch can't be
  pinned to the checked IP. A name that answers public then private could get one blind GET into the edge runtime's network.
- **Quota / outage: blocks legitimate users, by design.** Web Risk down, key missing, 200/account or 3000/day used up =
  any text WITH a link is refused (`link_check_required`); text without links unaffected. A popular day could exhaust 3000.
  Test after deploy: one legitimate save with a link (passes), then the budget forced to 0 (refused, link-free save passes).
- **Legitimate links:** a site that's down or times out = clean (its own address was looked up); a shortener that doesn't
  redirect = refused (could block some real short links). Not measured on real sites.
- **Real Google Web Risk API: NEVER CALLED.** Every test uses a fake. The request/response shape follows Google's
  `uris:search` docs, unconfirmed against the live API. Pricing (100k/month free, then $0.50/1000) from Google's page,
  to reconfirm when the key is created.

## Option B: no server-side fetching (owner approved 2026-11-07, third pass)

Why: the second pass left DNS rebinding open (Deno's `fetch` can't be pinned to a checked IP; pinning would need a
hand-written HTTP/1.1 client over `Deno.connect` + `Deno.startTls`). Fetching also added little: a site can show a checker
a clean page, use a JavaScript redirect, or change its target after posting.

What changed (edge-function code `_shared/linkSafety.ts` + `screen-user-content`; migration SQL unchanged, comments only):
- Removed: redirect following, DNS lookups, every request to a user-supplied address. The ONLY request is Web Risk's
  `uris:search` endpoint, and the code checks the request's origin is Google's before sending it.
- Added: embedded destinations (`?q=https://...`, `/redirect/https%3A%2F%2F...`, `#u=...`, `www.` values, up to 3 rounds of
  percent-decoding) looked up as well; '&' ends a destination so two in one link are both found.
- Caps, all planned before any lookup: 5 links, 3 embedded per link, depth 2, 15 lookups per text; over = refused.
  Repeats looked up once.
- Shortener / link-in-bio list (now 51 domains) refused, also when embedded. SUPPLEMENTAL ONLY: any domain can redirect,
  and an unlisted shortener is looked up only as its own address.
- Private / local / non-web-port addresses still refused (they can't be judged by Web Risk); the IPv6 parsing fix stays,
  but no longer guards a network path.

Tests: Deno 15/15 (each asserts the only request went to Web Risk; covers safe, listed, shorteners, open redirect on
google.com, path / fragment / double-encoded / www. forms, embedded shortener, depth, caps, two destinations in one link
(found a real bug while writing it: the first destination swallowed the rest; fixed), private addresses, userinfo, outage /
429 / network error / no key / no budget / budget running out mid-text, several links, punycode). Jest guard adds a static
check: one `deps.fetch` call, to the Web Risk endpoint, and no `resolveDns` / `Deno.connect` / `startTls` /
`redirect: 'manual'`. `deno check` of the edge function passes. Journeys not re-run (no SQL change).

Limits (accepted by the owner for the first launch, provided the real Web Risk tests pass before external users):
- A new or unlisted domain that redirects to a listed site passes (its own address is clean). So does an unlisted shortener.
- Newly created phishing domains aren't listed yet; a site can turn bad after posting (no re-check of published text).
- Destinations hidden in ways other than plain or percent-encoded text (base64, custom encodings) aren't found.
- Legitimate short links (bit.ly, linktr.ee, ...) are refused: people post the full link.
- An embedded destination's own later query parameters are dropped from its lookup (Web Risk matches on host + path).

Still required before deploy: a real Web Risk call with the owner's key (clean link passes, Google's test URL refused, also
when embedded in a google.com/url link), the edge function running on Supabase's runtime, the quota test, prod journeys with
0348-0396 prelude, prod aborted rollback, grants vs prod (`scripts/live-verify/post-deploy.js` 20270396).

## Not verified / limits

- Real Web Risk never called (needs the owner's Google Cloud key). The edge function was type-checked, not run.
- No scanner proves a link is safe: new phishing sites aren't listed yet; a site can turn bad after publishing (no re-check
  of published text); a site can show the checker something different from a browser (cloaking); JavaScript and
  meta-refresh redirects aren't followed (no redirect is followed at all since Option B). This complements screening + reports, never replaces them.
- (Second-pass DNS rebinding limit: GONE with Option B; nothing is fetched.)
- Phone numbers, emails, payment instructions and QR codes are not part of this (offers refuse contact details, 0372;
  QR = the D8 launch requirement).
- Private and group chats stay reports-based (owner decision).
