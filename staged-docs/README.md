# Staged web pages (NOT published)

GitHub Pages publishes `main:/docs`. These are build 88's versions of two pages, held here so merging build 88 into main
did not publish them early. Each is published by copying it over `docs/` in its own commit, only with the owner's approval:

- `privacy.html`: deletion / limited-records wording. Publish with the deletion migrations (Batch 8: 0402/0403) after
  counsel review. Further sentences are still to add before their migrations: `PRODUCT_AUDIT/PRIVACY_POLICY_GAP_AUDIT_2026-11-26.md`.
- `business.html`: "We go to customers" service-area sign-up. Publish only once 20270419 (Batch 10) is live.

Tests that check page wording read the staged copy when one exists (`src/qa/publishedPage.js`), so they test what will be
published. `src/qa/stagedDocs.test.js` lists the pages still waiting, so the gap stays visible.
