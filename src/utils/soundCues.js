// Owner idea "169" (2026-10-18): three tiny OPTIONAL in-app sound cues for the customer's major offer moments. This file is
// the one rule (pure, no React Native imports); services/soundCues.js wires it to the real phone.
//   offerArrived    -- a business replied to one of your open requests while the app is open (services/offerArrivals.js
//                      decides "genuinely new", for both the arrival pill and the request already on screen)
//   offerAccepted   -- your own "I'll take this one" was booked (the accepted card's first play, after the server returned)
//   visitConfirmed  -- the business confirmed your visit (the "✓ Visit confirmed" line's first play)
// Never required to understand anything: each cue rides on a visual that already shows the same fact and never waits for it.
// Off by default; one Settings switch turns it on. Silent when: the switch is off, Reduce Motion is on (or unknown), the app
// is not in the foreground, a voice note is being recorded, the phone's own notification just sounded for the same reply, or
// the platform can't honour the silent switch. Never on the business side and never in place of a push's sound.
export const SOUND_CUES = Object.freeze({
  offerArrived: 'offerArrived',
  offerAccepted: 'offerAccepted',
  visitConfirmed: 'visitConfirmed',
});

// iOS only: its ambient audio session obeys the Ring/Silent switch. Android gives an app no way (without a new native module)
// to see silent/vibrate mode or Do Not Disturb, so the switch is hidden there and nothing plays.
export const SOUND_CUE_PLATFORMS = Object.freeze(['ios']);
export const SOUND_CUES_PREF_KEY = 'nearby.soundCues.enabled.v1';
// A foreground push for a reply already plays the phone's own sound (item 141, high tier); the cue never doubles it.
export const OS_OFFER_SOUND_WINDOW_MS = 10000;
// Several replies landing close together = one cue.
export const SAME_CUE_GAP_MS = 3000;

export function soundCuesSupported(platform) {
  return SOUND_CUE_PLATFORMS.includes(platform);
}

// The decision, from facts only. Anything unknown is silence.
export function soundCueDecision({ cue, platform, enabled, reduceMotion, appState, recording = false, now, lastPlayedAt = null, osOfferSoundAt = null }) {
  if (!Object.values(SOUND_CUES).includes(cue)) return { play: false, reason: 'unknown_cue' };
  if (!soundCuesSupported(platform)) return { play: false, reason: 'platform' };
  if (enabled !== true) return { play: false, reason: 'off' };
  if (reduceMotion !== false) return { play: false, reason: 'reduce_motion' };
  if (appState !== 'active') return { play: false, reason: 'background' };
  if (recording) return { play: false, reason: 'recording' };
  if (cue === SOUND_CUES.offerArrived && osOfferSoundAt != null && now - osOfferSoundAt < OS_OFFER_SOUND_WINDOW_MS) {
    return { play: false, reason: 'os_sound' };
  }
  if (lastPlayedAt != null && now - lastPlayedAt < SAME_CUE_GAP_MS) return { play: false, reason: 'just_played' };
  return { play: true, reason: null };
}

// The player, with every phone dependency passed in (services/soundCues.js passes the real ones; tests pass fakes).
// play() is fire-and-forget: it never throws, never blocks the caller, and anything failing is silence.
export function createSoundCuePlayer({
  platform,
  storage, // { getItem, setItem } (AsyncStorage)
  isReduceMotionEnabled, // async () => boolean, asked fresh at every cue
  getAppState, // () => 'active' | 'background' | 'inactive'
  isRecording = () => false,
  playAsset, // async (cue) => void: sets the silent-switch-respecting session and plays that cue's file once
  now = () => Date.now(),
}) {
  let enabled = false; // off by default, and until the stored choice is read
  let loaded = false;
  let osOfferSoundAt = null;
  const lastPlayed = {};
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => { try { l(enabled); } catch { /* a listener never breaks the others */ } });

  async function load() {
    try {
      enabled = (await storage.getItem(SOUND_CUES_PREF_KEY)) === 'true';
    } catch {
      enabled = false;
    }
    loaded = true;
    emit();
    return enabled;
  }

  async function setEnabled(next) {
    enabled = next === true;
    loaded = true; // the person's explicit choice wins over a read still to come
    emit();
    try { await storage.setItem(SOUND_CUES_PREF_KEY, enabled ? 'true' : 'false'); } catch { /* kept for this session */ }
    return enabled;
  }

  async function play(cue) {
    try {
      if (!soundCuesSupported(platform)) return false;
      if (!loaded) await load();
      let reduceMotion = true;
      try { reduceMotion = (await isReduceMotionEnabled()) !== false; } catch { reduceMotion = true; }
      const at = now();
      const decision = soundCueDecision({
        cue, platform, enabled, reduceMotion, appState: getAppState(), recording: !!isRecording(),
        now: at, lastPlayedAt: lastPlayed[cue] ?? null, osOfferSoundAt,
      });
      if (!decision.play) return false;
      lastPlayed[cue] = at;
      await playAsset(cue);
      return true;
    } catch {
      return false;
    }
  }

  return {
    load,
    setEnabled,
    isEnabled: () => enabled,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // A push for a reply arrived while the app was open: the phone already played its own sound for it.
    noteOsOfferSound() { osOfferSoundAt = now(); },
    play,
  };
}
