import { Platform, Linking } from 'react-native';
import { supabase } from './supabase';

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

// Every free-tier daily-limit check in this app (Notices, Waves, Browse
// views, gathering-interest expressions, voice notes) used to trust a
// client-supplied `isPremium()` boolean — local RevenueCat SDK/cache
// state, not verified against anything server-side — to bypass its rate
// limit entirely. A stale cache or spoofed client state silently
// defeated every one of those caps with no backstop, unlike this app's
// AI-generation Edge Functions, which already gate on a real server-side
// `profiles.is_premium` read. This is the real column, reliably kept in
// sync by the `revenuecat-webhook` function (see CLAUDE.md's "Consumer
// Billing" section) — querying it directly here closes that gap for all
// five limit checks in one place instead of duplicating the same query
// five times.
export async function isPremiumOnServer(userId) {
  if (!userId) return false;
  const { data } = await supabase.from('profiles').select('is_premium').eq('id', userId).maybeSingle();
  return !!data?.is_premium;
}

export async function restorePurchases() {
  if (!Purchases) return false;
  const customerInfo = await Purchases.restorePurchases();
  return customerInfo.entitlements.active['premium'] !== undefined;
}

// Real subscription detail for a Billing screen — everything here comes
// straight from RevenueCat's own CustomerInfo, nothing invented. There is
// no itemized receipt/payment-method data available to this app at all
// (Apple/Google own that, not RevenueCat), so callers should show an
// honest "managed by the store" message rather than trying to fabricate
// a receipts list from this.
export async function getSubscriptionDetails() {
  if (!Purchases) return { unavailable: true, active: false, managementURL: null };
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const entitlement = customerInfo.entitlements.active['premium'];
    return {
      unavailable: false,
      active: !!entitlement,
      store: entitlement?.store ?? null,
      willRenew: entitlement?.willRenew ?? null,
      latestPurchaseDate: entitlement?.latestPurchaseDate ?? null,
      expirationDate: entitlement?.expirationDate ?? null,
      isSandbox: entitlement?.isSandbox ?? false,
      managementURL: customerInfo.managementURL ?? null,
    };
  } catch (e) {
    return { unavailable: true, active: false, managementURL: null, error: e?.message };
  }
}

// Prefers RevenueCat's own managementURL (correct even for non-App-Store/
// Play-Store cases, e.g. web checkout) and only falls back to the plain
// per-platform subscriptions page when RevenueCat doesn't have one.
export function openSubscriptionManagement(managementURL) {
  const url = managementURL || (Platform.OS === 'ios'
    ? 'itms-apps://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions');
  return Linking.openURL(url);
}