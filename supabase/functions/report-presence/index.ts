import { secretKey } from '../_shared/supabaseKeys.ts';
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = secretKey()!;

const PRESENCE_WINDOW_MINUTES = 10;
const AREA_BUCKET_SIZE = 0.0001; // matches the 4-decimal rounding used when generating area strings client-side

// A generous ceiling above commercial flight speed (~600 mph) — real
// users can legitimately travel by plane between reports, but a jump
// implying faster-than-that travel is a strong signal of spoofed
// location data rather than genuine movement.
const MAX_PLAUSIBLE_MPH = 700;

// Free users only match people in their exact area bucket (~35 feet).
// Premium users search a 3x3 grid of neighboring buckets too, roughly
// tripling the effective radius — this is the "extended crossed-paths
// radius" promised on the Paywall screen.
function neighboringAreas(area: string, includeNeighbors: boolean): string[] {
  if (!includeNeighbors) return [area];

  const [latStr, lngStr] = area.split(',');
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  const areas: string[] = [];
  for (let latOffset = -1; latOffset <= 1; latOffset++) {
    for (let lngOffset = -1; lngOffset <= 1; lngOffset++) {
      const neighborLat = (lat + latOffset * AREA_BUCKET_SIZE).toFixed(4);
      const neighborLng = (lng + lngOffset * AREA_BUCKET_SIZE).toFixed(4);
      areas.push(`${neighborLat},${neighborLng}`);
    }
  }
  return areas;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), { status: 401 });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
    }
    const userId = userData.user.id;

    const { area } = await req.json();
    if (!area || typeof area !== 'string') {
      return new Response(JSON.stringify({ error: 'area is required' }), { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Partial anti-spoofing mitigation: compare this report against
    // the user's own previous one. A jump implying physically
    // impossible travel speed is rejected outright, rather than
    // silently trusting whatever area the client claims.
    const { data: previousReport } = await admin
      .from('presence_reports')
      .select('area, reported_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (previousReport) {
      const [prevLat, prevLng] = previousReport.area.split(',').map(parseFloat);
      const [newLat, newLng] = area.split(',').map(parseFloat);
      const distanceMiles = haversineMiles(prevLat, prevLng, newLat, newLng);
      const elapsedHours = (Date.now() - new Date(previousReport.reported_at).getTime()) / (1000 * 60 * 60);

      if (elapsedHours > 0 && distanceMiles / elapsedHours > MAX_PLAUSIBLE_MPH) {
        // 20270363: a private review-signal input (only the ~1-degree cell, kept 1 hour; off until the owner approves
        // numbers). Never blocks this reply; before that migration the call just fails and is ignored.
        try {
          await admin.rpc('record_location_jump', { p_user: userId, p_area: area });
        } catch (_) { /* ignored */ }
        return new Response(JSON.stringify({ error: 'Location update rejected — implausible travel speed.' }), { status: 400 });
      }
    }

    await admin.from('presence_reports').upsert({
      user_id: userId,
      area,
      reported_at: new Date().toISOString(),
    });

    const { data: myProfile } = await admin
      .from('profiles')
      .select('is_premium')
      .eq('id', userId)
      .single();

    const searchAreas = neighboringAreas(area, myProfile?.is_premium === true);

    const windowStart = new Date(Date.now() - PRESENCE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data: others, error: othersError } = await admin
      .from('presence_reports')
      .select('user_id')
      .in('area', searchAreas)
      .gte('reported_at', windowStart)
      .neq('user_id', userId);

    if (othersError) {
      return new Response(JSON.stringify({ error: othersError.message }), { status: 500 });
    }

    for (const other of others ?? []) {
      const { data: blocked } = await admin.rpc('is_blocked', {
        user_1: userId,
        user_2: other.user_id,
      });
      if (blocked) continue;

      const [userA, userB] = [userId, other.user_id].sort();

      await admin
        .from('sightings')
        .upsert(
          {
            user_a: userA,
            user_b: userB,
            approx_area: area,
            last_seen_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          },
          { onConflict: 'user_a,user_b' }
        );
    }

    return new Response(JSON.stringify({ ok: true, matchedCount: others?.length ?? 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});