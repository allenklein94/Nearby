// ONE support address for account appeals AND account recovery (owner, 2026-11-07). Shown to people only when BOTH are set:
// the owner has configured the mailbox (it receives mail) and verified it (a test message sent and answered). Until then
// every message simply leaves the review line out: never an invented address, never the owner's personal one by default.
// Changing it needs a new native build (no expo-updates). Procedure: PRODUCT_AUDIT/ACCOUNT_APPEALS_PROCEDURE_2026-11-07.md.
export const SUPPORT_EMAIL = null;          // e.g. 'support@<the app's real domain>' once it exists
export const SUPPORT_EMAIL_VERIFIED = false; // true only after the owner's send-and-reply check
