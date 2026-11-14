// The website's "Admin review" link only when its backend answers (prod 2026-11-14: 1 admin, who also manages a
// business; admin functions not deployed, so the link led to a failing screen and the dashboard redirect was skipped).
const fs = require('fs');
const path = require('path');
const { adminReviewAvailable, probeAdminReview } = require('./adminReviewAvailability');

describe('adminReviewAvailable', () => {
  it('hidden for non-admins whatever the probe says', () => {
    expect(adminReviewAvailable(false, { data: [], error: null })).toBe(false);
  });
  it('hidden while the functions are missing (PGRST202), on any error, or with no probe', () => {
    expect(adminReviewAvailable(true, { data: null, error: { code: 'PGRST202' } })).toBe(false);
    expect(adminReviewAvailable(true, { data: null, error: { message: 'network' } })).toBe(false);
    expect(adminReviewAvailable(true, null)).toBe(false);
  });
  it('shown once the backend answers an admin', () => {
    expect(adminReviewAvailable(true, { data: [], error: null })).toBe(true);
  });
  it('a thrown probe counts as an error', async () => {
    const probe = await probeAdminReview({ rpc: () => { throw new Error('offline'); } });
    expect(adminReviewAvailable(true, probe)).toBe(false);
  });
});

describe('BusinessWebHomeScreen wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'BusinessWebHomeScreen.js'), 'utf8');
  it('redirects to the dashboard unless Admin review is really available, and shows the link only then', () => {
    expect(src).toMatch(/if \(partner && !admin\)/);
    expect(src).toMatch(/const adminLinks = showAdmin \?/);
    expect(src).not.toMatch(/const adminLinks = isAdmin \?/);
  });
});
