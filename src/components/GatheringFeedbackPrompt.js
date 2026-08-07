import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { submitGatheringFeedback, hasSubmittedFeedback } from '../services/gatherings';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Self-contained, same pattern as NewcomerBadge — only renders for
// past gatherings you actually attended, and only if you haven't
// already left feedback. Two honest yes/no questions, not a public
// star rating or comment that could feel exposing to leave.
export default function GatheringFeedbackPrompt({ gatheringId }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [alreadySubmitted, setAlreadySubmitted] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasSubmittedFeedback(gatheringId).then((result) => {
      if (!cancelled) setAlreadySubmitted(result);
    });
    return () => { cancelled = true; };
  }, [gatheringId]);

  async function handleAnswer(feltWelcoming, wouldAttendAgain) {
    try {
      await submitGatheringFeedback(gatheringId, { feltWelcoming, wouldAttendAgain });
      setSubmitted(true);
    } catch (e) {
      // fail quietly, this is a nice-to-have, not critical
    }
  }

  if (alreadySubmitted === null || alreadySubmitted || submitted) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.question}>Did this feel welcoming?</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.button} onPress={() => handleAnswer(true, true)} accessibilityLabel="Yes, welcoming, would attend again" accessibilityRole="button">
          <Text style={styles.buttonText}>👍 Yes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => handleAnswer(false, false)} accessibilityLabel="No, not welcoming" accessibilityRole="button">
          <Text style={styles.buttonText}>👎 Not really</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  question: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.xs },
  button: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
});