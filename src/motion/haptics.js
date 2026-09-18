import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Item 129 ("Haptics could complement the animations"): motion + haptic + visual state change,
// for IMPORTANT state changes only -- never every tap (chip/toggle selection ticks that already
// exist elsewhere are input feedback, not this). One shared vocabulary so every moment feels the
// same and a new animated moment picks a named beat instead of reaching for expo-haptics directly:
//
//   match           -> subtle   (light impact)         a dating match
//   friendAccepted  -> subtle   (light impact)         a friendship becoming real
//   success         -> success  (notification success) plan confirmed / reservation confirmed /
//                                                      plan created / surprise revealed
//
// Haptics are independent of Reduce Motion (that setting governs on-screen movement, not touch
// feedback), and fail safe: any platform without a haptic engine, or a rejected call, is silently
// ignored -- feedback must never break or delay the real action. Web has no haptics.
export const HAPTIC_MOMENTS = {
  match: 'match',
  friendAccepted: 'friendAccepted',
  success: 'success',
};

export function playHaptic(moment) {
  if (Platform.OS === 'web') return;
  try {
    let result;
    if (moment === HAPTIC_MOMENTS.match || moment === HAPTIC_MOMENTS.friendAccepted) {
      result = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (moment === HAPTIC_MOMENTS.success) {
      result = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    result?.catch?.(() => {});
  } catch {
    // ignore -- see above
  }
}
