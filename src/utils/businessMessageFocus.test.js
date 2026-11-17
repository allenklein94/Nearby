// 20270428: a customer-message alert opens the business inbox ON that conversation, from the alert's message id only.
import { messageFocusPlan } from './businessMessageFocus';
import { notificationDestination } from '../navigation/notificationDestinations';
import { businessWebDestination, businessWebLinkUrl, parseBusinessWebLink } from './businessWebLink';
import { notificationGroupOf } from '../constants/notificationPreferences';
import { notificationPriority } from '../constants/notificationTier';
import { NOTIFICATION_ACTION_BY_TYPE } from '../constants/notificationActions';

const fs = require('fs');
const path = require('path');

jest.mock('../services/supabase', () => ({ supabase: {} }));

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const MID = '11111111-2222-4333-8444-555555555555';
const CUST = 'cccccccc-0000-4000-8000-000000000003';
const convos = [{ userId: 'someone-else', displayName: 'X' }, { userId: CUST, displayName: 'Sam' }];

describe('which conversation opens', () => {
  test('the message of this location opens its conversation', () => {
    expect(messageFocusPlan({ partner_id: A, conversation_with_id: CUST }, A, convos)).toEqual({ kind: 'open', convo: convos[1] });
  });
  test('another location\'s message never opens a conversation here (the plain inbox)', () => {
    expect(messageFocusPlan({ partner_id: B, conversation_with_id: CUST }, A, convos)).toEqual({ kind: 'list' });
  });
  test('unreadable (another business, deleted, blocked) = the plain inbox, never an error', () => {
    expect(messageFocusPlan(null, A, convos)).toEqual({ kind: 'list' });
    expect(messageFocusPlan(undefined, A, convos)).toEqual({ kind: 'list' });
    expect(messageFocusPlan({ partner_id: A }, A, convos)).toEqual({ kind: 'list' });
  });
  test('inbox not loaded yet = wait; loaded and still missing = the plain inbox', () => {
    expect(messageFocusPlan({ partner_id: A, conversation_with_id: CUST }, A, [])).toEqual({ kind: 'wait' });
    expect(messageFocusPlan({ partner_id: A, conversation_with_id: CUST }, A, [], { conversationsLoaded: true })).toEqual({ kind: 'list' });
  });
  test('no business selected yet = the plain inbox', () => {
    expect(messageFocusPlan({ partner_id: A, conversation_with_id: CUST }, null, convos)).toEqual({ kind: 'list' });
  });
});

describe('the alert itself', () => {
  test('the tap opens the inbox on that message; no id = the inbox', async () => {
    expect(await notificationDestination({ type: 'business_message_received', message_id: MID, partner_id: A }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'inbox_modal', focusMessageId: MID } });
    expect(await notificationDestination({ type: 'business_message_received' }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'inbox_modal' } });
  });
  test('"New requests" owner switch, high priority, Reply button', () => {
    expect(notificationGroupOf('business_message_received')).toBe('owner_requests');
    expect(notificationPriority('business_message_received')).toBe('high');
    expect(NOTIFICATION_ACTION_BY_TYPE.business_message_received).toBe('reply');
  });
  test('the email link names the message (never the customer) and the website opens the same conversation', async () => {
    const url = businessWebLinkUrl('https://example.org/b/', 'business_message_received', MID);
    expect(url).toBe(`https://example.org/b/?n=business_message_received&r=${MID}`);
    const link = parseBusinessWebLink(new URL(url).search);
    expect(await businessWebDestination(link)).toEqual({ name: 'BusinessDashboard', params: { initialSection: 'inbox_modal', focusMessageId: MID } });
  });
  test('the "New requests" switch says it covers messages (all 11 languages carry the reworded line)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../i18n/ui/bizComp.js'), 'utf8');
    expect(src).toContain('A customer asks for something you could offer or sends you a message, a request is about to expire, or a customer cancels one.');
    expect(src).not.toContain('A customer asks for something you could offer, a request is about to expire');
  });
  test('the migration: customer messages only, no text/name/customer id in the payload, 5-minute window, never fails the message', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270428_business_message_alerts.sql'), 'utf8');
    expect(sql).toMatch(/after insert on public\.business_messages\s+for each row when \(new\.from_business = false\)/);
    expect(sql).toMatch(/jsonb_build_object\('type', 'business_message_received', 'message_id', new\.id, 'partner_id', new\.partner_id\)/);
    expect(sql).not.toMatch(/new\.body/);
    expect(sql).toMatch(/interval '5 minutes'/);
    expect(sql).toMatch(/exception when others then\s+raise warning/);
  });
});
