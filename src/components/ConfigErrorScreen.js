import React from 'react';
import { SafeAreaView, Text, StyleSheet } from 'react-native';

// Shown instead of the whole app when the build's environment configuration is missing or mixed
// (src/config/environments.js). Nothing else renders, so no screen can make a request. Developer-facing: a store build
// never reaches it (app.config.js refuses the build first); English only on purpose.
export default function ConfigErrorScreen({ message }) {
  return (
    <SafeAreaView style={styles.wrap}>
      <Text style={styles.title}>This build of Nearby can't start</Text>
      <Text style={styles.body}>{message}</Text>
      <Text style={styles.body}>It has not connected to any server.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#FFF6F0' },
  title: { fontSize: 20, fontWeight: '600', color: '#1A1A1A', marginBottom: 12 },
  body: { fontSize: 15, color: '#444444', marginBottom: 8 },
});
