import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';

export default function OnboardingScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Nearby</Text>
        <Text style={styles.subtitle}>
          You've probably noticed someone nearby you wanted to talk to,
          but didn't. Nearby gives you a low-pressure way to let them
          know — and only if they feel the same way, you both find out.
        </Text>

        <View style={styles.step}>
          <Text style={styles.stepNum}>1</Text>
          <Text style={styles.stepText}>You cross paths with someone using the app</Text>
        </View>
        <View style={styles.step}>
          <Text style={styles.stepNum}>2</Text>
          <Text style={styles.stepText}>If you're interested, send a silent "Notice"</Text>
        </View>
        <View style={styles.step}>
          <Text style={styles.stepNum}>3</Text>
          <Text style={styles.stepText}>Nothing happens unless they notice you too</Text>
        </View>

        <Text style={styles.privacyNote}>
          Your exact location is never shown to other users. No one can
          see who you've noticed unless it's mutual.
        </Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.buttonText}>Get Started</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, justifyContent: 'space-between' },
  content: { marginTop: 40 },
  title: { fontSize: 42, fontWeight: '700', color: '#fff', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#c9c9e0', lineHeight: 22, marginBottom: 32 },
  step: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  stepNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#e94560',
    color: '#fff', textAlign: 'center', lineHeight: 28, fontWeight: '700', marginRight: 12,
  },
  stepText: { color: '#fff', fontSize: 15, flex: 1 },
  privacyNote: { color: '#8888a8', fontSize: 13, marginTop: 24, lineHeight: 18 },
  button: {
    backgroundColor: '#e94560', borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', marginBottom: 20,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});