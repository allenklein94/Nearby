// Item 183 (owner, LOCKED): a Faith & Spirituality search may resolve for that search, but it never becomes learned
// affinity, a ranking signal, a "Based on your recent activity" reason or a persistent profile fact.
import fs from 'fs';
import path from 'path';

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(() => Promise.resolve({ error: null })) } }));
const { supabase } = require('./supabase');
const { recordBehaviorEvent, recordSearchBehavior, NEVER_LEARNED_CATEGORIES } = require('./behaviorSignals');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270280_ies_plurals_never_learn_faith.sql'), 'utf8');
const persistSql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270281_never_learned_search_persistence.sql'), 'utf8');

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

describe('never-learned categories are stripped at the persistence boundary (item 183 follow-up)', () => {
  it('the database strips the search log and tap log on every write, and never audits such an ask', () => {
    expect(persistSql).toMatch(/if public\._category_never_learned\(new\.category\) then\s+new\.category := null;\s+new\.raw_text := null;/);
    expect(persistSql).toMatch(/new\.result_title := null/);
    expect(persistSql).toMatch(/before insert or update on public\.intent_submissions/);
    expect(persistSql).toMatch(/before insert or update on public\.intent_outcomes/);
    expect(persistSql).toMatch(/_category_never_learned\(snapshot #>> '\{interpretation,category\}'\)[\s\S]*?return null;/);
  });

  it('every reader of a searched category reads it from those stripped rows (so demand counts and trends cannot see it)', () => {
    const dir = path.join(__dirname, '../../supabase/migrations');
    const latest = (fn) => fs.readdirSync(dir).sort().filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(`function public.${fn}`)).pop();
    for (const fn of ['get_partner_demand_signals', '_category_trend_facts']) {
      const body = fs.readFileSync(path.join(dir, latest(fn)), 'utf8');
      expect(body).toMatch(/intent_submissions/);
    }
  });
});
