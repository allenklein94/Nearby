let Purchases = null;
try {
  Purchases = require('react-native-purchases').default;
} catch (e) {
  console.log('RevenueCat native module not available in this environment (expected in Expo Go).');
}

const REVENUECAT_IOS_API_KEY = 'appl_jOyJTTCDpRjErXfxqRrkpXScSwo';

export function initPurchases(appUserId) {
  if (!Purchases) return;
  Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY, appUserID: appUserId });
}

export async function getOfferings() {
  if (!Purchases) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export async function purchasePackage(pkg) {
  if (!Purchases) throw new Error('Purchases not available in this environment.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo.entitlements.active['premium'] !== undefined;
}

export async function isPremium() {
  if (!Purchases) return false;
  const customerInfo = await Purchases.getCustomerInfo();
  return customerInfo.entitlements.active['premium'] !== undefined;
}

export async function restorePurchases() {
  if (!Purchases) return false;
  const customerInfo = await Purchases.restorePurchases();
  return customerInfo.entitlements.active['premium'] !== undefined;
}