// Turnstile settings from app.json `extra` (turnstileSiteKey = the widget's PUBLIC site key; turnstileHost = the allowed
// page origin). The secret never lives in the app: it is the Supabase Auth setting that verifies tokens server-side.
import Constants from 'expo-constants';
import { turnstileConfig } from '../utils/captcha';

export const TURNSTILE = turnstileConfig(Constants.expoConfig?.extra);
