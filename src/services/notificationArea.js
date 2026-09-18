// Keeps the server's coarse "notification area" (~0.7 mi) current so location-relevant pushes reach the user
// without them opening Discovery. Not presence: never shown to anyone, read only by push targeting.
import { supabase } from './supabase';

const MIN_INTERVAL_MS = 30 * 60 * 1000;

export function createNotificationAreaReporter({ send, now = () => Date.now() }) {
  let last = null; // { key, at }
  async function report(coords) {
    if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return;
    const key = `${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`;
    if (last && last.key === key && now() - last.at < MIN_INTERVAL_MS) return;
    last = { key, at: now() };
    try {
      await send(coords.latitude, coords.longitude);
    } catch {
      last = null; // best-effort; try again on the next fix
    }
  }
  report.reset = () => { last = null; };
  return report;
}

export const reportNotificationArea = createNotificationAreaReporter({
  send: async (lat, lng) => {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) throw new Error('signed out');
    const { error } = await supabase.rpc('set_my_notification_area', { lat_param: lat, lng_param: lng });
    if (error) throw error;
  },
});

// Removes the server's saved area now. While Discovery notifications are on, the next fresh fix saves it
// again; turning them off keeps it cleared (the RPC refuses to store while off).
export async function clearNotificationArea() {
  reportNotificationArea.reset();
  const { error } = await supabase.rpc('clear_my_notification_area');
  if (error) throw error;
}
