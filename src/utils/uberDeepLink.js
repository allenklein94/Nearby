import { Linking } from 'react-native';

// A real, honest "Get an Uber there" link — not a ride-booking integration.
// Per the user's own explicit scope call: Nearby never books, pays for, or
// tracks the ride; it just opens the Uber app with a confirmed destination
// already filled in, using Uber's public, no-account-needed universal
// link (https://m.uber.com/ul/, documented deep-linking parameters, no
// client_id/API key required for this basic "set destination" case). Same
// category as the existing Google Maps/Spotify Linking.openURL() calls
// elsewhere in this codebase — a real external hand-off, not a new
// integration surface Nearby has to build or maintain.
//
// Real, previously-discussed alternative (Uber for Business / Guest
// Rides — Nearby books and pays server-side) was explicitly rejected for
// now: needs a real Uber for Business account/credentials and takes on
// real payment/ride-lifecycle responsibility for no validated user need
// yet. Revisit only if that's ever actually asked for.

function buildUberDestinationUrl({ latitude, longitude, nickname, address }) {
  const parts = [
    'action=setPickup',
    'pickup=my_location',
    `dropoff[latitude]=${encodeURIComponent(latitude)}`,
    `dropoff[longitude]=${encodeURIComponent(longitude)}`,
  ];
  if (nickname) parts.push(`dropoff[nickname]=${encodeURIComponent(nickname)}`);
  if (address) parts.push(`dropoff[formatted_address]=${encodeURIComponent(address)}`);
  return `https://m.uber.com/ul/?${parts.join('&')}`;
}

// destination: { latitude, longitude, nickname?, address? } — latitude/
// longitude are required (real, already-fetched coordinates from wherever
// the caller got them; this function never geocodes anything itself).
// Opens the Uber app if installed; falls back to Uber's own web page
// otherwise, same graceful-fallback behavior as any other https:// deep
// link (matches Google Maps/Spotify's own Linking.openURL usage in this
// app -- no app-store guessing on our end).
export function openUberToDestination(destination) {
  if (destination?.latitude == null || destination?.longitude == null) {
    return Promise.reject(new Error('Missing destination coordinates.'));
  }
  return Linking.openURL(buildUberDestinationUrl(destination));
}
