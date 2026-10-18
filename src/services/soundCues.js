import { AccessibilityInfo, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio, InterruptionModeIOS } from 'expo-av';
import { isRecordingVoiceNote } from './voiceNotes';
import { createSoundCuePlayer, SOUND_CUES } from '../utils/soundCues';

// Owner idea "169": the real phone wiring for utils/soundCues.js (the rules live there). Customer side only: never imported
// by a business screen (guard utils/soundCues.test.js).
const FILES = {
  [SOUND_CUES.offerArrived]: require('../../assets/sounds/offer-arrived.wav'),
  [SOUND_CUES.offerAccepted]: require('../../assets/sounds/offer-accepted.wav'),
  [SOUND_CUES.visitConfirmed]: require('../../assets/sounds/visit-confirmed.wav'),
};

async function playAsset(cue) {
  // Ambient session: obeys the Ring/Silent switch and mixes with whatever else is playing (never pauses music).
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    staysActiveInBackground: false,
  });
  const { sound } = await Audio.Sound.createAsync(FILES[cue], { shouldPlay: true, volume: 1 });
  sound.setOnPlaybackStatusUpdate((status) => {
    if (!status?.isLoaded || status.didJustFinish) sound.unloadAsync().catch(() => {});
  });
}

const player = createSoundCuePlayer({
  platform: Platform.OS,
  storage: AsyncStorage,
  isReduceMotionEnabled: () => AccessibilityInfo.isReduceMotionEnabled(),
  getAppState: () => AppState.currentState,
  isRecording: isRecordingVoiceNote,
  playAsset,
});

export { SOUND_CUES };
export const playSoundCue = (cue) => { player.play(cue); };
export const loadSoundCuesEnabled = player.load;
export const setSoundCuesEnabled = player.setEnabled;
export const subscribeSoundCuesEnabled = player.subscribe;
export const noteOsOfferSound = player.noteOsOfferSound;
