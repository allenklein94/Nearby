// Rule 6: the ask-local-businesses reminder closes the intent -> business-request gap WITHOUT sending anything on the
// host's behalf. Consent stays consent; only the host's explicit "Yes, look now" creates the request.
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270146_gathering_business_reminder.sql'), 'utf8');
const notifications = fs.readFileSync(path.join(__dirname, '../services/notifications.js'), 'utf8');

describe('gathering business reminder', () => {
  test('never creates a request or an offer', () => {
    expect(sql).not.toMatch(/insert into\s+(public\.)?business_requests/i);
    expect(sql).not.toMatch(/create_business_request/i);
    expect(sql).not.toMatch(/_business_request_fanout/i);
  });
  test('honors every stop condition in the candidate query', () => {
    for (const needle of ['ask_local_businesses = true', 'not exists (select 1 from business_requests', 'gathering_business_reminders b', 'notify_planning', 'scheduled_at >=', 'scheduled_at <=', 'precise_lat is not null', 'hosting_partner_id is null']) {
      expect(sql).toContain(needle);
    }
  });
  test('does not depend on attendees (a zero-attendee gathering is valid)', () => {
    expect(sql).not.toMatch(/gathering_interest/i);
  });
  test('tapping the push opens the gathering', () => {
    expect(notifications).toMatch(/case 'gathering_business_reminder':/);
    expect(sql).toContain("'gathering_id', v_row.gathering_id");
  });
});
