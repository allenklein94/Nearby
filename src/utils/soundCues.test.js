// Owner idea "169" (2026-10-18): three optional customer-side sound cues. Off by default, one Settings switch, silent under
// Reduce Motion / in the background / while recording / on platforms that can't honour the silent switch, never doubling a
// push's own sound, never on the business side, never awaited by a visual.
const fs = require('fs');
const path = require('path');
import {
  SOUND_CUES, SOUND_CUES_PREF_KEY, OS_OFFER_SOUND_WINDOW_MS, SAME_CUE_GAP_MS,
  soundCueDecision, soundCuesSupported, createSoundCuePlayer,
} from './soundCues';
import { createOfferArrivals, OFFER_ARRIVAL_DEBOUNCE_MS } from '../services/offerArrivals';

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const base = { cue: SOUND_CUES.offerAccepted, platform: 'ios', enabled: true, reduceMotion: false, appState: 'active', now: 100000 };

describe('the decision', () => {
  test('plays only when every condition holds', () => {
    expect(soundCueDecision(base)).toEqual({ play: true, reason: null });
  });
  test.each([
    ['switch off (the default)', { enabled: false }, 'off'],
    ['switch never read', { enabled: undefined }, 'off'],
    ['Reduce Motion on', { reduceMotion: true }, 'reduce_motion'],
    ['Reduce Motion unknown', { reduceMotion: null }, 'reduce_motion'],
    ['app in the background', { appState: 'background' }, 'background'],
    ['app inactive', { appState: 'inactive' }, 'background'],
    ['recording a voice note', { recording: true }, 'recording'],
    ['Android (no way to see silent mode / Do Not Disturb)', { platform: 'android' }, 'platform'],
    ['web', { platform: 'web' }, 'platform'],
    ['unknown cue', { cue: 'businessOpportunity' }, 'unknown_cue'],
    ['the same cue just played', { lastPlayedAt: 100000 - SAME_CUE_GAP_MS + 1 }, 'just_played'],
  ])('silent: %s', (_label, change, reason) => {
    expect(soundCueDecision({ ...base, ...change })).toEqual({ play: false, reason });
  });
  test('a reply push that just sounded on the phone is never doubled by the arrival cue; other cues are unaffected', () => {
    const osOfferSoundAt = 100000 - OS_OFFER_SOUND_WINDOW_MS + 1;
    expect(soundCueDecision({ ...base, cue: SOUND_CUES.offerArrived, osOfferSoundAt })).toEqual({ play: false, reason: 'os_sound' });
    expect(soundCueDecision({ ...base, cue: SOUND_CUES.offerArrived, osOfferSoundAt: 100000 - OS_OFFER_SOUND_WINDOW_MS })).toEqual({ play: true, reason: null });
    expect(soundCueDecision({ ...base, cue: SOUND_CUES.visitConfirmed, osOfferSoundAt })).toEqual({ play: true, reason: null });
  });
  test('exactly three cues, iOS only', () => {
    expect(Object.values(SOUND_CUES)).toEqual(['offerArrived', 'offerAccepted', 'visitConfirmed']);
    expect(soundCuesSupported('ios')).toBe(true);
    expect(soundCuesSupported('android')).toBe(false);
  });
});

function makePlayer({ stored = null, reduceMotion = false, appState = 'active', platform = 'ios', storageFails = false, assetFails = false } = {}) {
  const state = { stored, reduceMotion, appState, recording: false, t: 1000000, played: [], reduceAsks: 0 };
  const player = createSoundCuePlayer({
    platform,
    storage: {
      getItem: async (k) => { if (storageFails) throw new Error('disk'); return k === SOUND_CUES_PREF_KEY ? state.stored : null; },
      setItem: async (k, v) => { if (storageFails) throw new Error('disk'); if (k === SOUND_CUES_PREF_KEY) state.stored = v; },
    },
    isReduceMotionEnabled: async () => { state.reduceAsks += 1; if (state.reduceMotion === 'throw') throw new Error('a11y'); return state.reduceMotion; },
    getAppState: () => state.appState,
    isRecording: () => state.recording,
    playAsset: async (cue) => { if (assetFails) throw new Error('decode'); state.played.push(cue); },
    now: () => state.t,
  });
  return { player, state };
}

describe('the player: enabled / disabled', () => {
  test('off by default: nothing stored = off, and nothing plays', async () => {
    const { player, state } = makePlayer();
    expect(player.isEnabled()).toBe(false);
    expect(await player.load()).toBe(false);
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(false);
    expect(state.played).toEqual([]);
  });
  test('turning it on is kept on this phone and the cue plays; turning it off silences it', async () => {
    const { player, state } = makePlayer();
    const seen = [];
    player.subscribe((v) => seen.push(v));
    await player.setEnabled(true);
    expect(state.stored).toBe('true');
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(true);
    await player.setEnabled(false);
    expect(state.stored).toBe('false');
    state.t += SAME_CUE_GAP_MS;
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(false);
    expect(state.played).toEqual([SOUND_CUES.offerAccepted]);
    expect(seen).toEqual([true, false]);
  });
  test('a stored "on" is read before the first cue', async () => {
    const { player, state } = makePlayer({ stored: 'true' });
    expect(await player.play(SOUND_CUES.visitConfirmed)).toBe(true);
    expect(state.played).toEqual([SOUND_CUES.visitConfirmed]);
  });
  test('storage failing = off, never on', async () => {
    const { player, state } = makePlayer({ storageFails: true });
    expect(await player.load()).toBe(false);
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(false);
    expect(state.played).toEqual([]);
  });
});

describe('the player: accessibility and device state', () => {
  test('Reduce Motion is asked fresh at every cue and silences it', async () => {
    const { player, state } = makePlayer({ stored: 'true' });
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(true);
    state.reduceMotion = true;
    state.t += SAME_CUE_GAP_MS;
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(false);
    expect(state.reduceAsks).toBe(2);
    expect(state.played).toHaveLength(1);
  });
  test('the Reduce Motion lookup failing = silence', async () => {
    const { player, state } = makePlayer({ stored: 'true', reduceMotion: 'throw' });
    expect(await player.play(SOUND_CUES.offerAccepted)).toBe(false);
    expect(state.played).toEqual([]);
  });
  test('background, recording and Android are silent', async () => {
    const bg = makePlayer({ stored: 'true', appState: 'background' });
    expect(await bg.player.play(SOUND_CUES.offerArrived)).toBe(false);
    const rec = makePlayer({ stored: 'true' });
    rec.state.recording = true;
    expect(await rec.player.play(SOUND_CUES.offerArrived)).toBe(false);
    const android = makePlayer({ stored: 'true', platform: 'android' });
    expect(await android.player.play(SOUND_CUES.offerArrived)).toBe(false);
    expect([...bg.state.played, ...rec.state.played, ...android.state.played]).toEqual([]);
  });
  test('the reply push sounding while open suppresses the arrival cue for that window only', async () => {
    const { player, state } = makePlayer({ stored: 'true' });
    player.noteOsOfferSound();
    expect(await player.play(SOUND_CUES.offerArrived)).toBe(false);
    state.t += OS_OFFER_SOUND_WINDOW_MS;
    expect(await player.play(SOUND_CUES.offerArrived)).toBe(true);
  });
  test('a failing sound never throws (fire-and-forget)', async () => {
    const { player } = makePlayer({ stored: 'true', assetFails: true });
    await expect(player.play(SOUND_CUES.offerAccepted)).resolves.toBe(false);
  });
});

describe('triggering: the arrival cue comes from the one arrival rule', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const reply = (id, extra = {}) => ({ id, request_id: 'req1', status: 'offered', viewed_at: null, request_status: 'open', partner_name: 'Coastal Coffee', ...extra });
  function harness({ viewing = null } = {}) {
    const server = { rows: [] };
    const arrivals = [];
    const signals = [];
    const c = createOfferArrivals({
      fetchReplies: async () => server.rows.map((r) => ({ ...r })),
      isViewingRequest: (id) => id === viewing,
      onViewedArrival: () => {},
      onChange: (s) => signals.push(s),
      onArrival: () => arrivals.push(signals.length),
    });
    const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };
    const check = async () => { c.check(); jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS); await flush(); };
    return { c, server, arrivals, signals, check };
  }
  test('existing replies (the baseline) never sound', async () => {
    const h = harness();
    h.server.rows = [reply('o1')];
    await h.c.start();
    await h.check();
    expect(h.arrivals).toEqual([]);
  });
  test('a genuinely new reply sounds once, after its pill is shown; several together = one cue; a repeat look = none', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows = [reply('o1'), reply('o2', { request_id: 'req2' })];
    await h.check();
    expect(h.arrivals).toEqual([1]); // called after the one signal was set
    await h.check();
    expect(h.arrivals).toEqual([1]);
  });
  test('a reply on the request already on screen sounds too (no pill there; the card builds in)', async () => {
    const h = harness({ viewing: 'req1' });
    await h.c.start();
    h.server.rows = [reply('o1')];
    await h.check();
    expect(h.signals).toEqual([]);
    expect(h.arrivals).toEqual([0]);
  });
  test('a declined or already opened reply never sounds', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows = [reply('o1', { status: 'declined' }), reply('o2', { viewed_at: '2026-10-18T10:00:00Z' })];
    await h.check();
    expect(h.arrivals).toEqual([]);
  });
});

describe('source guards', () => {
  const CALLERS = ['components/OfferArrivalSignal.js', 'motion/OfferAcceptedMorph.js', 'motion/BookedCelebration.js', 'motion/VisitConfirmed.js', 'screens/SettingsScreen.js'];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(SRC).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  test('only the reviewed customer-side files use the sound service; no business screen, push or notification code does', () => {
    const users = files.filter((f) => /services\/soundCues['"]/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f)).sort();
    expect(users).toEqual([...CALLERS].sort());
    for (const f of files.filter((x) => /Biz|BusinessDashboard|Opportunit|notification/i.test(path.basename(x)))) {
      expect([path.relative(SRC, f), /soundCue|SOUND_CUES/.test(fs.readFileSync(f, 'utf8'))]).toEqual([path.relative(SRC, f), false]);
    }
  });
  test('the three cues are wired exactly where their moment is decided', () => {
    expect(code('components/OfferArrivalSignal.js')).toMatch(/onArrival: \(\) => playSoundCue\(SOUND_CUES\.offerArrived\)/);
    const detail = code('screens/BusinessRequestDetailScreen.js');
    expect(detail.match(/soundCue=\{SOUND_CUES\.\w+\}/g)).toEqual(['soundCue={SOUND_CUES.offerAccepted}', 'soundCue={SOUND_CUES.visitConfirmed}']);
    expect(code('screens/GroupPlanScreen.js').match(/soundCue=\{SOUND_CUES\.\w+\}/g)).toEqual(['soundCue={SOUND_CUES.offerAccepted}']);
    // accept: only with the person's own tap (the haptic's condition) and a real booking
    expect(code('motion/OfferAcceptedMorph.js')).toMatch(/if \(play && haptic && booked\) \{\s*playHaptic\(HAPTIC_MOMENTS\.success\);\s*if \(soundCue\) playSoundCue\(soundCue\);/);
    expect(code('motion/BookedCelebration.js')).toMatch(/if \(haptic\) \{\s*playHaptic\(HAPTIC_MOMENTS\.success\);\s*if \(soundCue\) playSoundCue\(soundCue\);/);
    // visit: only on the confirmation's first viewing
    expect(code('motion/VisitConfirmed.js')).toMatch(/if \(play && soundCue\) playSoundCue\(soundCue\);/);
  });
  test('sound never delays a visual: never awaited, and the visual components keep their own animation decision', () => {
    for (const f of files) expect([path.relative(SRC, f), /await\s+playSoundCue/.test(fs.readFileSync(f, 'utf8'))]).toEqual([path.relative(SRC, f), false]);
    for (const f of ['motion/OfferAcceptedMorph.js', 'motion/VisitConfirmed.js']) expect(code(f)).toMatch(/useRef\(play && !reduceMotion\)\.current/);
  });
  test('the phone wiring respects the silent switch, mixes with other audio, and the push handler keeps its own sound', () => {
    const svc = code('services/soundCues.js');
    expect(svc).toMatch(/playsInSilentModeIOS: false/);
    expect(svc).toMatch(/InterruptionModeIOS\.MixWithOthers/);
    expect(svc).toMatch(/staysActiveInBackground: false/);
    // Idea "338": the handler's normal presentation keeps the push's own sound; only a push the screen already shows is quiet.
    expect(code('navigation/foregroundPresentation.js')).toMatch(/NORMAL = Object\.freeze\(\{[^}]*shouldPlaySound: true/);
    expect(code('services/notifications.js')).toMatch(/foregroundPresentation\(/);
  });
  test('the Settings switch shows only where cues can play, is labelled, and starts off', () => {
    const settings = code('screens/SettingsScreen.js');
    expect(settings).toMatch(/useState\(false\);\s*useEffect\(\(\) => \{\s*if \(!soundCuesSupported\(Platform\.OS\)\) return undefined;/);
    expect(settings).toMatch(/\{soundCuesSupported\(Platform\.OS\) \? \(/);
    expect(settings).toMatch(/accessibilityLabel=\{t\('ui\.settings\.soundCuesA11y'\)\}/);
  });
  test('the strings exist in all 11 languages', () => {
    const ns = require('../i18n/ui/settings').default;
    expect(Object.keys(ns)).toHaveLength(11);
    for (const [lang, s] of Object.entries(ns)) {
      for (const k of ['soundCues', 'soundCuesHelp', 'soundCuesA11y']) expect([lang, k, typeof s[k], (s[k] ?? '').length > 0]).toEqual([lang, k, 'string', true]);
    }
  });
});

describe('the sound files: our own, tiny and quiet', () => {
  const dir = path.join(SRC, '../assets/sounds');
  test.each(['offer-arrived.wav', 'offer-accepted.wav', 'visit-confirmed.wav'])('%s is mono 16-bit, under 0.6 s, peak at most -12 dBFS', (name) => {
    const b = fs.readFileSync(path.join(dir, name));
    expect(b.toString('ascii', 0, 4)).toBe('RIFF');
    expect(b.readUInt16LE(22)).toBe(1); // mono
    const rate = b.readUInt32LE(24);
    expect(b.readUInt16LE(34)).toBe(16);
    const dataAt = b.indexOf('data') + 8;
    const samples = (b.length - dataAt) / 2;
    expect(samples / rate).toBeLessThan(0.6);
    let peak = 0;
    for (let i = dataAt; i + 1 < b.length; i += 2) peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
    expect(peak / 32767).toBeLessThanOrEqual(0.2512); // -12 dBFS
  });
  test('their provenance is recorded and the generator is in the repo', () => {
    expect(fs.readFileSync(path.join(dir, 'LICENSE.md'), 'utf8')).toMatch(/original works made for Nearby/);
    expect(fs.existsSync(path.join(SRC, '../scripts/sounds/generate-sound-cues.py'))).toBe(true);
  });
});
