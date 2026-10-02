// Gathering group chat: a message is visible only when neither the viewer nor the sender blocked the other
// (migration 20270263). The rule lives in the database; these guards keep every read path on it. The behavior itself
// (both directions, multiple attendees, other members unaffected, count, by-id read, unblock, DM policy untouched) is
// proven against production by scripts/live-verify/gathering-chat-blocks-either-way.sql.
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
