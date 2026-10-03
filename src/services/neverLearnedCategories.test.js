// Item 183 (owner, LOCKED): a Faith & Spirituality search may resolve for that search, but it never becomes learned
// affinity, a ranking signal, a "Based on your recent activity" reason or a persistent profile fact.
import fs from 'fs';
import path from 'path';

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(() => Promise.resolve({ error: null })) } }));
const { supabase } = require('./supabase');
const { recordBehaviorEvent, recordSearchBehavior, NEVER_LEARNED_CATEGORIES } = require('./behaviorSignals');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270280_ies_plurals_never_learn_faith.sql'), 'utf8');

describe('Faith & Spirituality is never learned', () => {
  beforeEach(() => supabase.rpc.mockClear());

  it('the client never sends it, from any kind of event', () => {
    recordBehaviorEvent('search', 'search', null, 'Faith & Spirituality');
    recordBehaviorEvent('open', 'gathering', 'g1', 'Faith & Spirituality');
    recordBehaviorEvent('join', 'gathering', 'g1', 'Faith & Spirituality');
    recordBehaviorEvent('create', 'community', 'c1', 'Faith & Spirituality');
    recordSearchBehavior('Faith & Spirituality');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('other categories are still learned', () => {
    recordBehaviorEvent('search', 'search', null, 'Coffee');
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('the server list is identical and every learning path checks it', () => {
    const arr = sql.match(/_category_never_learned\(c text\)[\s\S]*?any \(array\[([^\]]*)\]\)/)[1]
      .split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
    expect(arr).toEqual([...NEVER_LEARNED_CATEGORIES]);
    expect(sql).toMatch(/if public\._category_never_learned\(category_param\) then return; end if;/); // record_behavior_event
    expect(sql).toMatch(/or public\._category_never_learned\(v_category\)/); // redemption trigger
    expect(sql).toMatch(/and not public\._category_never_learned\(be\.category\)/); // the one read
  });
});
