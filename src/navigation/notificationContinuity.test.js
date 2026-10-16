// Item 133 (owner, 2026-10-16): notification -> destination continuity. A push about a person or an object opens THAT
// person or object (not an inbox or a list to search), with what the push said visible there.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const fs = require('fs');
const path = require('path');
const { notificationDestination } = require('./notificationDestinations');
const { NOTIFICATION_ACTION_BY_TYPE } = require('../constants/notificationActions');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('item 133: the tap lands on the thing the push is about', () => {
  test('"{Name} accepted your friend request." opens that friend, and its button says View profile', async () => {
    expect(await notificationDestination({ type: 'friend_accepted', user_id: 'u9' })).toEqual({ name: 'ViewProfile', params: { userId: 'u9' } });
    expect(NOTIFICATION_ACTION_BY_TYPE.friend_accepted).toBe('view_profile');
    expect(read('supabase/functions/send-push/index.ts')).toMatch(/friend_accepted: 'view_profile'/);
  });

  test('an older friend_accepted push without the id still opens Friends', async () => {
    expect(await notificationDestination({ type: 'friend_accepted' })).toEqual({ name: 'Friends' });
  });

  test('the server sends the accepter\'s id with the push', () => {
    const m = read('supabase/migrations/20270318_friend_accepted_opens_friend.sql');
    expect(m).toMatch(/jsonb_build_object\('type', 'friend_accepted', 'user_id', v_accepter\)/);
  });

  test('"{Name} joined \\"{title}\\"" opens the gathering itself with the push\'s words on top (not Activity)', async () => {
    const body = 'Claude joined "Coffee Saturday"';
    expect(await notificationDestination({ type: 'gathering_interest', gathering_id: 'g1', body })).toEqual({
      name: 'GatheringDetail', params: { gatheringId: 'g1', notificationReason: body, notificationSuggestsInvite: true },
    });
    for (const type of ['gathering_approved', 'gathering_invite', 'friend_joined_gathering', 'gathering_waitlisted']) {
      expect((await notificationDestination({ type, gathering_id: 'g1', body })).name).toBe('GatheringDetail');
    }
  });

  test('a friend request still opens Friends, where it is answered', async () => {
    expect(await notificationDestination({ type: 'friend_request' })).toEqual({ name: 'Friends' });
  });
});
