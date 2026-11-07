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
- Public text with a link needs a result recorded by the link-checking `screen-user-content`: every link and every redirect
  hop looked up in Web Risk. Old (word-only) results don't count: refused `link_check_required`.
- Listed destination = refused `link_not_allowed` (stored: verdict + threat types only, no URL), whatever the language rule.
- Fail closed, nothing recorded: Web Risk down, no key, budget used up (503); a shortener that won't resolve, more than 5
  redirects, a private / local / non-web-port address, more than 5 links (refused, the app's existing "change it" words).
- Applies to all of 0373's public text (gathering title + description, community name + description, profile text, Q&A,
  photo comments): one rule, so a link moved from a gathering into a community or bio gets the same check.
- Redirects followed by the server with `redirect: manual`, each hop's address checked before it is fetched; never a private
  or local address (also after DNS), never a port other than 80/443, user:password@ dropped, 4 s per hop.
- No new screen, string, client change, score or chat scanning. Logs keep counts only.

## Verified (2026-11-07, local)

- Fresh replay 520/520 (real Auth first). Journey `linkSafety` 6/6 (detector, bypasses, clean/malicious, forged results,
  budget). Journeys 1170/1170. Deno tests `supabase/functions/_shared/linkSafety.test.ts` 15/15 (fake Web Risk + sites:
  safe, listed, shortener -> listed, shortener unresolved, too many hops, loops, private addresses incl. DNS + metadata IP,
  redirect to private / javascript:, userinfo, outage / no key / no budget, several links). `deno check` of the edge function
  passes. `scripts/replay/link-check-budget-concurrency.js` 5 rounds pass. Rollback + re-apply: schema identical (0 diff lines).
  Guard `src/utils/linkSafetyGuard.test.js`.
- See the history entry for the full regression numbers.

## Not verified / limits

- Real Web Risk never called (needs the owner's Google Cloud key). The edge function was type-checked, not run.
- No scanner proves a link is safe: new phishing sites aren't listed yet; a site can turn bad after publishing (no re-check
  of published text); a site can show the checker something different from a browser (cloaking); JavaScript and
  meta-refresh redirects aren't followed. This complements screening + reports, never replaces them.
- DNS check happens before fetch, but the fetch resolves again (DNS rebinding could reach a private address in theory; the
  edge runtime's network position limits what that reaches).
- Phone numbers, emails, payment instructions and QR codes are not part of this (offers refuse contact details, 0372;
  QR = the D8 launch requirement).
- Private and group chats stay reports-based (owner decision).
