// Block visibility. Group chats (gathering 20270263, community 20270264): a message is visible only when neither the viewer nor the
// sender blocked the other. The rule lives in the database; these guards keep every read path on it, and keep any NEW
// read rule from reading `blocks` inline (blocks RLS shows a viewer only the blocks they made, so an inline read leaks
// the reverse direction). Behavior is proven against production by scripts/live-verify/gathering-chat-blocks-either-way.sql
// and community-chat-blocks-either-way.sql.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const migDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const readMig = (f) => fs.readFileSync(path.join(migDir, f), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}
const srcFiles = walk(path.join(root, 'src'));

const POLICY = /create policy "Host and approved attendees can view gathering chat[^"]*"\s+on public\.gathering_messages[\s\S]*?;\s*$/m;

describe('the chat read policy hides blocked pairs both ways', () => {
  const defining = migrations.filter((f) => POLICY.test(readMig(f)));
  const latest = defining[defining.length - 1];
  const body = readMig(latest).match(POLICY)[0];

  test('the latest definition is 20270263 and uses the one shared helper', () => {
    expect(latest).toBe('20270263_gathering_chat_block_either_way.sql');
    expect(body).toMatch(/not public\.viewer_blocked_either_way\(gathering_messages\.sender_id\)/);
  });

  test('it no longer reads blocks inline (blocks RLS only shows the viewer\'s own blocks, so that missed the reverse direction)', () => {
    expect(body).not.toMatch(/from\s+blocks/i);
  });

  test('the helper is SECURITY DEFINER and checks both directions', () => {
    const helper = readMig('20270138_attendee_read_respects_blocks.sql');
    expect(helper).toMatch(/security definer/);
    expect(helper).toMatch(/b\.blocker_id = auth\.uid\(\) and b\.blocked_id = other_user/);
    expect(helper).toMatch(/b\.blocker_id = other_user and b\.blocked_id = auth\.uid\(\)/);
  });
});

describe('every chat read goes through that policy', () => {
  test('no server function reads gathering_messages (a SECURITY DEFINER read would skip the rule)', () => {
    const offenders = migrations.filter((f) => {
      const sql = readMig(f);
      return /create (or replace )?function[\s\S]*?gathering_messages/i.test(sql)
        && /security definer/i.test(sql)
        && /\$\$[\s\S]*?from\s+(public\.)?gathering_messages[\s\S]*?\$\$/i.test(sql);
    });
    expect(offenders).toEqual([]);
  });

  test('the client reads chat rows only with plain table reads, never an RPC', () => {
    const readers = srcFiles.filter((f) => /\.from\('gathering_messages'\)/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f)).sort();
    expect(readers).toEqual(['src/services/gatheringChat.js', 'src/services/gatherings.js']);
    for (const f of srcFiles) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/rpc\([^)]*gathering_message/);
  });

  test('a realtime arrival is re-read by id through the policy, never shown from the event payload', () => {
    const chat = fs.readFileSync(path.join(root, 'src/screens/GatheringChatScreen.js'), 'utf8');
    expect(chat).toMatch(/getGatheringMessageById\(payload\.new\.id\)/);
    expect(chat).not.toMatch(/prependMessage\(payload\.new\)/);
  });

  test('the Message count is a count-only read of the same rows', () => {
    const svc = fs.readFileSync(path.join(root, 'src/services/gatherings.js'), 'utf8');
    expect(svc).toMatch(/from\('gathering_messages'\)\s*\.select\('id', \{ count: 'exact', head: true \}\)/);
  });
});

describe('community chat uses the same rule', () => {
  const CPOLICY = /create policy "Members can view community chat[^"]*"\s+on public\.community_messages[\s\S]*?;\s*$/m;
  const defining = migrations.filter((f) => CPOLICY.test(readMig(f)));
  const body = readMig(defining[defining.length - 1]).match(CPOLICY)[0];

  test('the latest definition is 20270264, uses the shared helper and reads no blocks inline', () => {
    expect(defining[defining.length - 1]).toBe('20270264_community_chat_block_either_way.sql');
    expect(body).toMatch(/not public\.viewer_blocked_either_way\(community_messages\.sender_id\)/);
    expect(body).not.toMatch(/from\s+blocks/i);
  });

  test('no server function reads community_messages', () => {
    const offenders = migrations.filter((f) => /\$\$[\s\S]*?from\s+(public\.)?community_messages[\s\S]*?\$\$/i.test(readMig(f)));
    expect(offenders).toEqual([]);
  });

  test('the client reads it only with plain table reads; a realtime arrival is re-read by id', () => {
    const readers = srcFiles.filter((f) => /\.from\('community_messages'\)/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f)).sort();
    expect(readers).toEqual(['src/services/communities.js', 'src/services/homeDashboard.js']);
    const chat = fs.readFileSync(path.join(root, 'src/screens/CommunityChatScreen.js'), 'utf8');
    expect(chat).toMatch(/getCommunityMessageById\(payload\.new\.id\)/);
    expect(chat).not.toMatch(/prependMessage\(payload\.new\)/);
  });
});

describe('no NEW read rule reads blocks inline', () => {
  // Latest definition of every RLS policy across all migrations; flag those whose body queries `blocks` directly.
  // These three still do (same one-way defect, reported 2026-10-02, not changed yet); remove each as it is fixed.
  const KNOWN_INLINE = [
    'public.business_messages :: Only the follower and business owner can see this conversation,',
    'public.stories :: Visible to poster, matches, friends, fellow attendees, host, or',
    'storage.objects :: Story media visible to poster, matches, friends, fellow attende',
  ];
  test('only the known, reported policies remain', () => {
    const latest = new Map();
    const RE = /create policy\s+"([^"]+)"\s+on\s+([\w.]+)([\s\S]*?);\s*$/gim;
    for (const f of migrations) {
      const sql = readMig(f);
      for (const m of sql.matchAll(/drop policy if exists\s+"([^"]+)"\s+on\s+([\w.]+)/gi)) {
        const t = m[2].includes('.') ? m[2] : `public.${m[2]}`;
        latest.delete(`${t} :: ${m[1]}`);
      }
      for (const m of sql.matchAll(RE)) {
        const t = m[2].includes('.') ? m[2] : `public.${m[2]}`;
        latest.set(`${t} :: ${m[1]}`, m[3]);
      }
    }
    const inline = [...latest].filter(([, body]) => /from\s+(public\.)?blocks\b/i.test(body)).map(([k]) => k).sort();
    expect(inline).toEqual(KNOWN_INLINE.sort());
  });
});

describe('client code never decides "who blocked me" (migration 20270265)', () => {
  // A read of `blocks` filtered on blocked_id = me always returns nothing (blocks RLS shows a viewer only the blocks
  // they made), so a client-side block filter can only ever be one-way. Hiding a blocked pair belongs to the server read.
  const blockReads = (file) => (fs.readFileSync(file, 'utf8').match(/\.from\('blocks'\)/g) || []).length;
  const readers = Object.fromEntries(
    srcFiles.filter((f) => blockReads(f) > 0).map((f) => [path.relative(root, f), blockReads(f)])
  );

  test('the three fixed surfaces (community members, friends, discovery/proximity) no longer read blocks', () => {
    for (const f of ['src/services/communities.js', 'src/services/friends.js', 'src/services/friendDiscovery.js', 'src/services/proximity.js']) {
      expect(readers[f]).toBeUndefined();
    }
  });

  test('only known readers remain: the own-blocks Settings list, and the reported one-way filters not yet moved', () => {
    expect(readers).toEqual({
      'src/services/blockedUsers.js': 2,     // the person's own block list + unblock (blocker_id = me): legitimate
      'src/services/gatherings.js': 10,      // reported 2026-10-02, not changed yet
      'src/services/stories.js': 2,          // reported 2026-10-02, not changed yet
      'src/screens/ActivityScreen.js': 2,    // reported 2026-10-02, not changed yet
    });
  });

  test('the fixed reads go through the server rule instead', () => {
    const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    expect(read('src/services/friends.js')).toMatch(/from\('people_visible_to_me'\)/);
    expect(read('src/services/proximity.js').match(/from\('people_visible_to_me'\)/g)).toHaveLength(2);
    expect(read('src/services/friendDiscovery.js')).toMatch(/from\('people_visible_to_me'\)/);
    const mig = readMig('20270265_people_reads_block_either_way.sql');
    expect(mig).toMatch(/with \(security_invoker = true\)/);
    expect(mig).toMatch(/not public\.viewer_blocked_either_way\(user_id\)/);                         // community members
    expect(mig.match(/not public\.viewer_blocked_either_way\(case when user_a = auth\.uid\(\)/g)).toHaveLength(2); // friendships read + create
    expect(mig).toMatch(/and not public\.viewer_blocked_either_way\(other\.user_id\)/);                // crossed-paths partners
    expect(mig).not.toMatch(/from\s+(public\.)?blocks/i);
  });

  test('a refused friend request reads the same whichever side blocked (one generic line, no direction)', () => {
    const src = fs.readFileSync(path.join(root, 'src/services/friends.js'), 'utf8');
    expect(src).toMatch(/error\.code === '42501'\) throw new Error\("You can't send a friend request to this person\."\)/);
  });
});
