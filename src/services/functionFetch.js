// fetch for edge-function calls (functionUrl(...)): sends this build's version headers like every Supabase request, and
// switches the app to its update screen when the function answers that this build is too old (426 + hint
// app_update_required, from supabase/functions/_shared/appVersion.ts). Kept apart from services/supabase.js so screens
// and services that mock the Supabase client still send real headers.
import { withAppVersion } from './appVersion';

export const functionFetch = withAppVersion((...args) => fetch(...args));
