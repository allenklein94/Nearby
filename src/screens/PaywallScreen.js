import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ActivityIndicator } from 'react-native';
import { getOfferings, purchasePackage, restorePurchases } from '../services/purchases';

export default function PaywallScreen({ navigation }) {
  const [offering, setOffering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    getOfferings()
      .then((result) => {
        setOffering(result);
        if (!result) {
          setErrorMessage('getOfferings() returned null/undefined — RevenueCat may not be configured, or no current offering exists.');
        }
      })
      .catch((err) => {
        setErrorMessage(err?.message || String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  async function handlePurchase(pkg) {
    try {
      const unlocked = await purchasePackage(pkg);
      if (unlocked) {
        Alert.alert('Welcome to Premium', 'You can now see who noticed you.');
        navigation.goBack();
      }
    } catch (e) {
      if (!e.userCancelled) Alert.alert('Purchase failed', e.message);
    }
  }

  async function handleRestore() {
    const restored = await restorePurchases();
    if (restored) {
      Alert.alert('Restored', 'Your premium access has been restored.');
      navigation.goBack();
    } else {
      Alert.alert('Nothing to restore', 'No active premium subscription found.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Nearby Premium</Text>
      <Text style={styles.subtitle}>See who's noticed you, and never miss a connection.</Text>

      <View style={styles.feature}><Text style={styles.featureText}>✓ See everyone who's noticed you</Text></View>
      <View style={styles.feature}><Text style={styles.featureText}>✓ Unlimited Notices</Text></View>
      <View style={styles.feature}><Text style={styles.featureText}>✓ Extended crossed-paths radius</Text></View>
      <View style={styles.feature}><Text style={styles.featureText}>✓ Weekly AI-suggested icebreaker</Text></View>

      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />
      ) : offering ? (
        offering.availablePackages.map((pkg) => (
          <TouchableOpacity key={pkg.identifier} style={styles.button} onPress={() => handlePurchase(pkg)}>
            <Text style={styles.buttonText}>
              {pkg.product.title} — {pkg.product.priceString}
            </Text>
          </TouchableOpacity>
        ))
      ) : (
        <View>
          <Text style={styles.empty}>
            Offerings not configured yet — set this up in RevenueCat + App Store Connect.
          </Text>
          {errorMessage && (
            <Text style={styles.errorDetail}>Debug: {errorMessage}</Text>
          )}
        </View>
      )}

      <TouchableOpacity onPress={handleRestore} style={{ marginTop: 16 }}>
        <Text style={styles.restoreText}>Restore Purchases</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, paddingTop: 40 },
  title: { fontSize: 30, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { color: '#c9c9e0', fontSize: 15, marginBottom: 24 },
  feature: { marginBottom: 10 },
  featureText: { color: '#fff', fontSize: 15 },
  button: { backgroundColor: '#e94560', borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  restoreText: { color: '#8888a8', textAlign: 'center', fontSize: 13 },
  empty: { color: '#8888a8', marginTop: 20, textAlign: 'center', lineHeight: 20 },
  errorDetail: { color: '#e94560', marginTop: 12, textAlign: 'center', fontSize: 12, fontFamily: 'monospace' },
});