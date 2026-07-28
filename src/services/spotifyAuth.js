import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const SPOTIFY_CLIENT_ID = Constants.expoConfig?.extra?.spotifyClientId;
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: 'nearby', path: 'spotify-callback' });

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

// PKCE flow — no client secret needed at all, by design, since
// mobile apps can't securely store one. expo-auth-session handles
// generating and verifying the code challenge/verifier automatically.
export function useSpotifyAuthRequest() {
  return AuthSession.useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID,
      scopes: ['user-top-read', 'user-read-private'],
      usePKCE: true,
      redirectUri: REDIRECT_URI,
    },
    discovery
  );
}

export async function exchangeCodeForToken(code, codeVerifier) {
  const result = await AuthSession.exchangeCodeAsync(
    {
      clientId: SPOTIFY_CLIENT_ID,
      code,
      redirectUri: REDIRECT_URI,
      extraParams: { code_verifier: codeVerifier },
    },
    discovery
  );
  return result;
}

export async function saveSpotifyTokens(userId, accessToken, refreshToken, expiresIn) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const { error } = await supabase
    .from('profiles')
    .update({
      spotify_access_token: accessToken,
      spotify_refresh_token: refreshToken,
      spotify_token_expires_at: expiresAt,
    })
    .eq('id', userId);
  if (error) throw error;
}

// Refreshes the access token if it's expired or close to expiring,
// using the stored refresh token — refresh tokens from PKCE flow
// don't require a client secret either, keeping this consistent
// with the rest of the auth setup.
export async function getValidAccessToken(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('spotify_access_token, spotify_refresh_token, spotify_token_expires_at')
    .eq('id', userId)
    .single();

  if (!profile?.spotify_access_token) {
    throw new Error('Spotify isn\'t connected. Connect it in Music Mode first.');
  }

  const expiresAt = new Date(profile.spotify_token_expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 5 * 60 * 1000;

  if (!isExpiringSoon) {
    return profile.spotify_access_token;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: profile.spotify_refresh_token,
      client_id: SPOTIFY_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error('Your Spotify connection expired. Reconnect it in Music Mode.');
  }

  const result = await response.json();
  await saveSpotifyTokens(userId, result.access_token, result.refresh_token ?? profile.spotify_refresh_token, result.expires_in);
  return result.access_token;
}

export async function searchSpotifyTracks(userId, query) {
  const accessToken = await getValidAccessToken(userId);
  const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=15`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Could not search Spotify right now.');
  const data = await response.json();
  return (data.tracks?.items ?? []).map((track) => ({
    id: track.id,
    name: track.name,
    artist: track.artists?.[0]?.name,
    albumArt: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url,
    previewUrl: track.preview_url,
  }));
}

export async function fetchTopTracks(accessToken) {
  const response = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Could not fetch your top tracks from Spotify.');
  const data = await response.json();
  return (data.items ?? []).map((track) => ({
    id: track.id,
    name: track.name,
    artist: track.artists?.[0]?.name,
    albumArt: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url,
    previewUrl: track.preview_url,
  }));
}