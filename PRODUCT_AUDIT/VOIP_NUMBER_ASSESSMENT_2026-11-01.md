# Virtual / VoIP phone numbers: assessment (2026-11-01)

Owner request (2026-11-01): assess whether the existing Twilio integration can support reliable line-type detection
(pricing, false positives, privacy) before anything is built. **Nothing is built, nothing is activated, no lookup has
been made, no registration is rejected.** This is idea 18's gap 2 ("a different number evades 0374").

## 1. What the existing integration can do

- Phone sign-in = Supabase Auth with `sms_provider: twilio_verify` (`scripts/trust-safety/b5-auth-settings.js`). Supabase
  Auth only sends and checks the code through Twilio Verify. It does **not** call Twilio Lookup, does not return a line
  type, and has no setting that refuses a line type.
- So line-type detection is **not available through the current integration**. It would be a separate call from our own
  server to Twilio Lookup v2 with the `line_type_intelligence` field, using the Twilio Account SID + an API key stored as
  an edge-function secret (the owner sets it; never in chat or Git). The Verify credentials live inside Supabase Auth's
  settings and are not readable by our functions.
- Twilio Verify has its own fraud features (Fraud Guard against SMS pumping, geo permissions). Those protect the SMS
  bill; they do not classify a number as VoIP for our purposes. Worth checking that Fraud Guard is on (owner, Twilio
  console) independently of this question.

## 2. Price

- Twilio Lookup pricing page: Line Type Intelligence = **$0.008 per request**, flat, any result type (to be confirmed by the
  owner on the pricing page before relying on it). Basic validation/formatting is free but gives no line type.
- At one lookup per newly confirmed number: 1,000 sign-ups = about $8; 100,000 = about $800. Repeat lookups for the same
  number can be avoided by storing only the result category (not the carrier response) with the 0374 number key.
- Canadian numbers need special approval from Twilio.

## 3. Accuracy and false positives

Line type answers "what kind of line is this", not "is this person abusive". Expected problems:

- **Real people use VoIP numbers.** Google Voice, TextNow and similar (`nonFixedVoip`) are used by privacy-minded people,
  people who don't want to share their main number with a social app, people between phones, and people on prepaid or
  wifi-only devices. **The owner's own phone-login account is a Google Voice number** (recorded as "the 'Google voice'
  phone login"): it would be flagged on day one.
- `fixedVoip` covers many business and cable-company landline numbers.
- Ported numbers and MVNOs are sometimes misclassified; results lag after porting.
- An abuser who knows the check switches to cheap prepaid mobile SIMs, which read as `mobile`. The check raises the cost
  of abuse a little; it does not stop a determined person.

So a VoIP result can only ever be a weak signal for a person to weigh, never a reason to refuse sign-up. Using it to
reject would block real users (starting with the owner) and contradict the locked "invisible trust & safety" design
(no friction for the ordinary path).

## 4. Privacy

- The full phone number goes to Twilio a second time (it already goes there for the code). Twilio is already a
  processor for sign-in; the Privacy Policy would need one more sentence ("we may check the type of phone line with our
  SMS provider to help detect abuse").
- Store only the category (`mobile` / `landline` / `fixedVoip` / `nonFixedVoip` / `unknown`) and the lookup time beside
  the 0374 HMAC key, never the carrier name or raw response. Never shown to the person or any other user; admins see only
  "VoIP number" as one line of evidence on an existing case.
- The person is never told, and nothing about their account changes.

## 5. Recommendation

1. **Do not build or activate it now.** No external users exist yet (8 accounts, all the owner's); there is no abuse to
   measure it against, and the first real result would be a false positive on the owner's own account.
2. If real abuse later shows account cycling across different numbers, the smallest compatible design is:
   - off by default (owner switch, like 0365 / 0376), one lookup per newly confirmed number, run outside the sign-up
     request by the 0374 queue (sign-up never waits on Twilio and never fails because of it);
   - result category kept with the 0374 number key, 12 months, purged with it;
   - **never** opens a case by itself; it is added as evidence to a case another signal already opened
     (0357 / 0368 / 0374 / 0376), so a VoIP number alone never puts anyone in front of an admin;
   - never rejects, restricts, limits or tells anyone.
3. Before any build: owner confirms price, enables a Twilio API key for Lookup only, approves the Privacy Policy sentence,
   and a test run on the owner's own numbers confirms the categories (expect Google Voice = `nonFixedVoip`).

## 6. Sources

- Twilio Lookup pricing: https://www.twilio.com/en-us/trusted-activation/pricing/lookup
- Line Type Intelligence: https://twilio.com/docs/lookup/v2-api/line-type-intelligence
