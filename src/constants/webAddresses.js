// Nearby's public web addresses: the ONE source for every link the app builds or opens
// (legal pages, invite / shared-night / occasion-invite / live-tracking share links).
// Primary domain thisisnearby.com (owner, 2026-11-18), served by GitHub Pages from main /docs.
// The old https://allenklein94.github.io/Nearby/... links keep working: GitHub Pages redirects
// them to the custom domain once docs/CNAME is live, so builds <= 87 stay correct.
export const SITE_BASE = 'https://thisisnearby.com';
export const PRIVACY_URL = `${SITE_BASE}/privacy.html`;
export const TERMS_URL = `${SITE_BASE}/terms.html`;
export const BUSINESS_WEB_BASE = `${SITE_BASE}/business/`;
