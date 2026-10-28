// Recovered 2026-10-28 from the LIVE bundle (moderate-chat-image v2, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
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
    const { imagePath } = await req.json();
    if (!imagePath) {
      return new Response(JSON.stringify({
        error: 'Missing imagePath'
      }), {
        status: 400
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: signedData, error: signError } = await admin.storage.from('chat-media').createSignedUrl(imagePath, 60);
    if (signError || !signedData?.signedUrl) {
      return new Response(JSON.stringify({
        error: 'Could not access image'
      }), {
        status: 500
      });
    }
    const imageResponse = await fetch(signedData.signedUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: contentType,
                  data: imageBase64
                }
              },
              {
                type: 'text',
                text: 'Does this image contain nudity, sexual content, graphic violence or gore, weapons being used to threaten or harm, hate symbols, or content depicting or endorsing self-harm? Reply with ONLY one word: SAFE or UNSAFE.'
              }
            ]
          }
        ]
      })
    });
    const data = await response.json();
    const verdict = data?.content?.[0]?.text?.trim().toUpperCase();
    if (!verdict) {
      console.error('moderate-chat-image: unexpected Anthropic response', JSON.stringify(data));
      // Fail closed on ambiguous responses — better to block a false
      // positive than let something genuinely harmful through.
      return new Response(JSON.stringify({
        safe: false,
        reason: 'Could not verify this image right now.'
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const safe = verdict.includes('SAFE') && !verdict.includes('UNSAFE');
    return new Response(JSON.stringify({
      safe
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('moderate-chat-image error:', err);
    return new Response(JSON.stringify({
      safe: false,
      error: String(err)
    }), {
      status: 500
    });
  }
});
