import fs from 'fs';
import path from 'path';
import { BUSINESS_NOTIFICATION_GROUP_BY_TYPE, BUSINESS_NOTIFICATION_GROUPS } from './businessNotificationGroups';

describe('business notification groups', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-push/index.ts'), 'utf8');
  const block = src.match(/const BUSINESS_NOTIFICATION_GROUP_BY_TYPE = \{([\s\S]*?)\};/)[1];
  const denoMap = Object.fromEntries([...block.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));

  it('send-push mirrors the client map exactly', () => {
    expect(denoMap).toEqual(BUSINESS_NOTIFICATION_GROUP_BY_TYPE);
  });
  it('only maps to groups an owner can actually toggle', () => {
    const keys = BUSINESS_NOTIFICATION_GROUPS.map((g) => g.key);
    expect(Object.values(BUSINESS_NOTIFICATION_GROUP_BY_TYPE).every((g) => keys.includes(g))).toBe(true);
  });
  it('keeps account events unmutable', () => {
    expect(BUSINESS_NOTIFICATION_GROUP_BY_TYPE.business_partner_approved).toBeUndefined();
    expect(BUSINESS_NOTIFICATION_GROUP_BY_TYPE.business_partnership_response).toBeUndefined();
  });
});
