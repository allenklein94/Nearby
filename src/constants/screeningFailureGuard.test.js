const fs = require('fs');
const path = require('path');
const fn = fs.readFileSync(path.join(__dirname, '../../supabase/functions/screen-business-content/index.ts'), 'utf8');
const cls = fs.readFileSync(path.join(__dirname, '../../supabase/functions/_shared/contentClassifier.ts'), 'utf8');
const dash = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');

test('a screening SERVICE failure is a 503 with a friendly, retryable message, never the old generic 500', () => {
  expect(fn).not.toMatch(/Could not screen this content right now/);
  expect(fn).toMatch(/code: 'screening_unavailable' \}, 503/);
  expect(fn).toMatch(/We couldn't review this right now\. Please try again/);
});
test('the classifier times out and logs the real technical cause (status + body) for the operator', () => {
  expect(cls).toMatch(/AbortSignal\.timeout/);
  expect(cls).toMatch(/SERVICE_FAILURE request failed/);
  expect(cls).toMatch(/SERVICE_FAILURE unexpected Anthropic response', anthropicResponse\.status/);
});
test('the dashboard offer prompt reads "Post an offer" once an offer exists', () => {
  expect(dash).toMatch(/offers\.length > 0 \? 'Post an offer' : 'Post your first offer'/);
});
