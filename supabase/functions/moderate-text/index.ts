// Recovered 2026-10-28 from the LIVE bundle (moderate-text v9, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID') ?? '';
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '';
const AWS_REGION = Deno.env.get('AWS_REGION') ?? 'us-east-1';
const TOXICITY_THRESHOLD = 0.7;
async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [
    ...new Uint8Array(hashBuffer)
  ].map((b)=>b.toString(16).padStart(2, '0')).join('');
}
async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}
function toHex(bytes) {
  return [
    ...bytes
  ].map((b)=>b.toString(16).padStart(2, '0')).join('');
}
async function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, 'aws4_request');
}
async function callComprehend(action, body) {
  const service = 'comprehend';
  const host = `comprehend.${AWS_REGION}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payload = JSON.stringify(body);
  const payloadHash = await sha256Hex(payload);
  const canonicalHeaders = `content-type:application/x-amz-json-1.1\n` + `host:${host}\n` + `x-amz-date:${amzDate}\n` + `x-amz-target:Comprehend_20171127.${action}\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${AWS_REGION}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const signingKey = await getSignatureKey(AWS_SECRET_ACCESS_KEY, dateStamp, AWS_REGION, service);
  const signature = toHex(await hmac(signingKey, stringToSign));
  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, ` + `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': `Comprehend_20171127.${action}`,
      Authorization: authorizationHeader
    },
    body: payload
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Comprehend ${action} failed: ${JSON.stringify(result)}`);
  }
  return result;
}
async function callComprehendWithRetry(action, body) {
  try {
    return await callComprehend(action, body);
  } catch (firstErr) {
    console.error('moderate-text: first Comprehend attempt failed, retrying once:', firstErr);
    await new Promise((resolve)=>setTimeout(resolve, 500));
    return await callComprehend(action, body);
  }
}
serve(async (req)=>{
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Missing auth'
      }), {
        status: 401
      });
    }
    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({
        error: 'Invalid session'
      }), {
        status: 401
      });
    }
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      return new Response(JSON.stringify({
        error: 'AWS credentials not configured.'
      }), {
        status: 500
      });
    }
    const { text } = await req.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({
        error: 'text is required'
      }), {
        status: 400
      });
    }
    if (!text.trim()) {
      return new Response(JSON.stringify({
        safe: true
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const truncated = text.slice(0, 1000);
    const result = await callComprehendWithRetry('DetectToxicContent', {
      TextSegments: [
        {
          Text: truncated
        }
      ],
      LanguageCode: 'en'
    });
    const segmentResult = result.ResultList?.[0];
    const flaggedCategories = (segmentResult?.Labels ?? []).filter((label)=>(label.Score ?? 0) >= TOXICITY_THRESHOLD);
    const safe = flaggedCategories.length === 0;
    return new Response(JSON.stringify({
      safe,
      categories: flaggedCategories.map((l)=>({
          name: l.Name,
          score: l.Score
        }))
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    // Loud, explicitly-tagged failure log — after a retry has
    // already been attempted and also failed, this is a genuine,
    // ongoing issue worth being able to search Supabase's function
    // logs for, rather than a silent, invisible fallback.
    console.error('MODERATION_FAIL_OPEN moderate-text:', err);
    return new Response(JSON.stringify({
      safe: true,
      error: String(err)
    }), {
      status: 200
    });
  }
});
