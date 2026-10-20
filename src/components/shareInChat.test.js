// Share a gathering in a one-to-one chat (owner decision 2026-10-20, idea "244" follow-up; migration 20270331, journey
// shareGatheringInChat). Guards: ONE write path, reached only from the person's own tap; the card reads the gathering only
// through the viewer's own gatherings read (item 147) and opens that exact GatheringDetail; the chat checks for a shared
// gathering before any other message kind.
const fs = require('fs');
const path = require('path');

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
});

describe('share a gathering in a chat', () => {
  const files = walk(path.join(__dirname, '..'));

  test('share_gathering_in_chat is called from ONE service, used only by the share sheet', () => {
    const rpcCallers = files.filter((f) => fs.readFileSync(f, 'utf8').includes("'share_gathering_in_chat'"));
    expect(rpcCallers.map((f) => path.relative(path.join(__dirname, '..'), f))).toEqual(['services/chatShare.js']);
    const users = files.filter((f) => /shareGatheringInChat\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('chatShare.js'));
    expect(users.map((f) => path.basename(f))).toEqual(['ShareInChatSheet.js']);
  });

  test('the sheet sends only from a row\'s own Send tap (nothing on open)', () => {
    const s = src('components/ShareInChatSheet.js');
    const effect = s.slice(s.indexOf('useEffect('), s.indexOf('async function load'));
    expect(effect).not.toMatch(/send\(|shareGatheringInChat/);
    expect(s).toMatch(/onPress=\{\(\) => send\(item\)\}/);
  });

  test('nobody writes messages.gathering_id directly', () => {
    const direct = files.filter((f) => /from\('messages'\)[\s\S]{0,200}gathering_id/.test(fs.readFileSync(f, 'utf8')));
    expect(direct).toEqual([]);
  });

  test('the card reads through the RLS-scoped gatherings read and opens that gathering', () => {
    const svc = src('services/chatShare.js');
    expect(svc).toMatch(/getSharedGatheringCard[\s\S]*from\('gatherings'\)[\s\S]*maybeSingle/);
    expect(svc).not.toMatch(/precise_lat|precise_lng/);
    const chat = src('screens/ChatScreen.js');
    expect(chat.indexOf('item.gathering_id ?')).toBeGreaterThan(-1);
    expect(chat.indexOf('item.gathering_id ?')).toBeLessThan(chat.indexOf(') : item.audio_url ?'));
    expect(chat).toMatch(/navigation\.navigate\('GatheringDetail', \{ gatheringId: id \}\)/);
  });

  test('GatheringDetail offers it only for a gathering that has not passed', () => {
    const d = src('screens/GatheringDetailScreen.js');
    expect(d).toMatch(/viewer\.time !== 'past' && \(\s*<TouchableOpacity\s*onPress=\{\(\) => setShareInChatVisible\(true\)\}/);
  });
});
