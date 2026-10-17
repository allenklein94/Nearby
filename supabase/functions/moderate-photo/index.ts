// Supabase Edge Function: moderate-photo

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID') ?? '';
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '';
const AWS_REGION = Deno.env.get('AWS_REGION') ?? 'us-east-1';

const NSFW_REJECT_THRESHOLD = 80;
const MINOR_AGE_FLAG_THRESHOLD = 18;

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, 'aws4_request');
}

async function callRekognition(action: string, body: Record<string, unknown>) {
  const service = 'rekognition';
  const host = `rekognition.${AWS_REGION}.amazonaws.com`;
  const endpoint = `https://${host}/`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payload = JSON.stringify(body);
  const payloadHash = await sha256Hex(payload);

  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:RekognitionService.${action}\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${AWS_REGION}/${service}/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await getSignatureKey(AWS_SECRET_ACCESS_KEY, dateStamp, AWS_REGION, service);
  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': `RekognitionService.${action}`,
      Authorization: authorizationHeader,
    },
    body: payload,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Rekognition ${action} failed: ${JSON.stringify(result)}`);
  }
  return result;
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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      return new Response(
        JSON.stringify({ error: 'AWS credentials not configured.' }),
        { status: 500 }
      );
    }

    let extraPhotoId: string | null = null;
    try {
      const body = await req.json();
      extraPhotoId = body?.extraPhotoId ?? null;
    } catch {
      // No body sent — that's fine, means "moderate the current primary photo."
    }

    let resolvedPath: string | null = null;

    if (extraPhotoId) {
      const { data: photoRow, error: photoRowError } = await admin
        .from('profile_photos')
        .select('photo_url, user_id')
        .eq('id', extraPhotoId)
        .single();

      if (photoRowError || !photoRow || photoRow.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Photo not found or not owned by this user' }), { status: 404 });
      }
      resolvedPath = photoRow.photo_url;
    } else {
      // Primary photo no longer uses a fixed filename — look up whatever
      // path is currently stored on the profile.
      const { data: profileRow, error: profileError } = await admin
        .from('profiles')
        .select('photo_url')
        .eq('id', userId)
        .single();

      if (profileError || !profileRow?.photo_url) {
        return new Response(JSON.stringify({ error: 'No primary photo found for this user' }), { status: 404 });
      }
      resolvedPath = profileRow.photo_url;
    }

    const { data: fileData, error: downloadError } = await admin.storage
      .from('profile-photos')
      .download(resolvedPath!);

    if (downloadError || !fileData) {
      return new Response(JSON.stringify({ error: 'Could not access uploaded photo' }), { status: 400 });
    }

    const imageBytes = new Uint8Array(await fileData.arrayBuffer());
    let binaryString = '';
    for (let i = 0; i < imageBytes.length; i++) {
      binaryString += String.fromCharCode(imageBytes[i]);
    }
    const imageBase64 = btoa(binaryString);

    const moderationResult = await callRekognition('DetectModerationLabels', {
      Image: { Bytes: imageBase64 },
      MinConfidence: 50,
    });

    const flaggedLabels = (moderationResult.ModerationLabels ?? []).filter(
      (label: { Confidence?: number }) => (label.Confidence ?? 0) >= NSFW_REJECT_THRESHOLD
    );
    const failedModeration = flaggedLabels.length > 0;

    // Critical: age-detection failures must fail CLOSED, not open.
    // Previously, if this specific check errored (network blip,
    // etc.), possibleMinorFlag silently stayed false and the photo
    // could still be marked "verified" — meaning the one check most
    // directly tied to child safety could fail to run at all
    // without anyone knowing. Now, a failure here blocks
    // verification entirely rather than defaulting to "safe."
    let possibleMinorFlag = false;
    let ageCheckSucceeded = false;
    try {
      const facesResult = await callRekognition('DetectFaces', {
        Image: { Bytes: imageBase64 },
        Attributes: ['AGE_RANGE'],
      });
      ageCheckSucceeded = true;
      for (const face of facesResult.FaceDetails ?? []) {
        if ((face.AgeRange?.Low ?? 99) < MINOR_AGE_FLAG_THRESHOLD) {
          possibleMinorFlag = true;
        }
      }
    } catch (faceErr) {
      console.error('MODERATION_FAIL_CLOSED moderate-photo age check failed:', faceErr);
    }

    const isSafe = !failedModeration && !possibleMinorFlag && ageCheckSucceeded;

    if (extraPhotoId) {
      await admin.from('profile_photos').update({ photo_verified: isSafe }).eq('id', extraPhotoId);
    } else {
      await admin.from('profiles').update({ photo_verified: isSafe }).eq('id', userId);
    }

    if (!isSafe) {
      await admin.from('reports').insert({
        reporter_id: userId,
        reported_id: userId,
        reason: possibleMinorFlag
          ? 'Automated: possible minor detected in profile photo'
          : !ageCheckSucceeded
            ? 'Automated: age-verification check failed to complete, treated as unverified'
            : 'Automated: photo failed content moderation',
        details: JSON.stringify({ flaggedLabels, possibleMinorFlag, ageCheckSucceeded, extraPhotoId }),
      });
    }

    return new Response(JSON.stringify({ ok: true, verified: isSafe }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('moderate-photo error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});