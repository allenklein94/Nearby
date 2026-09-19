import { CANCELLATION_REASONS, CANCELLATION_REASONS_BY_ROLE } from './cancellationReasons';
const fs = require('fs');
const path = require('path');

test('every offered reason has a label and appears in the DB CHECK / RPC allow-list', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261213_cancellation_events.sql'), 'utf8');
  Object.keys(CANCELLATION_REASONS).forEach((code) => expect(sql).toContain(`'${code}'`));
  Object.values(CANCELLATION_REASONS_BY_ROLE).flat().forEach((code) => expect(CANCELLATION_REASONS[code]).toBeTruthy());
});

test('every root cancel RPC records its event', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261213_cancellation_events.sql'), 'utf8');
  ['business_reservation', 'business_request', 'gathering', 'occasion_group_plan'].forEach((t) =>
    expect(sql).toContain(`_record_cancellation('${t}'`));
});
