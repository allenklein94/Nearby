// fetch for edge-function calls (functionUrl(...)): sends this build's version headers like every Supabase request, and
// switches the app to its update screen when the function answers that this build is too old (426 + hint
// app_update_required, from supabase/functions/_shared/appVersion.ts). Kept apart from services/supabase.js so screens
// and services that mock the Supabase client still send real headers.
// appVersion (react-native, expo-application) loads on the first call, not at import: plain-Node unit tests of the
// services that import this file never load React Native. In the app the require always succeeds.
let wrapped = null;
export function functionFetch(...args) {
  if (!wrapped) {
    // eslint-disable-next-line global-require
    const { withAppVersion } = require('./appVersion');
    wrapped = withAppVersion((...a) => fetch(...a));
  }
  return wrapped(...args);
}
