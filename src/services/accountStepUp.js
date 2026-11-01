// 20270375 step-up (see utils/accountStepUp.js). Order matters: begin FIRST (the server then binds the next session created
// for this account to this step-up), then the code, then complete.
import { supabase, createIsolatedAuthClient } from './supabase';
import { sessionIdFromAccessToken, stepUpTarget, stepUpUnavailable } from '../utils/accountStepUp';
import { authCaptchaOptions } from '../utils/captcha';

// -> { status: 'sent', stepUpId, target, client } | { status: 'unavailable' } (0375 not live) | throws the server's error.
// captchaToken: Auth checks CAPTCHA on every code request (/otp) once enforcement is on, this one included (utils/captcha.js).
export async function beginStepUp(purpose, newPhone = null, captchaToken = null) {
  const { data: userData } = await supabase.auth.getUser();
  const target = stepUpTarget(userData?.user);
  const { data, error } = await supabase.rpc('begin_account_step_up', { purpose_param: purpose, new_phone_param: newPhone });
  if (error) {
    if (stepUpUnavailable(error)) return { status: 'unavailable' };
    throw error;
  }
  if (!target) throw Object.assign(new Error('No phone or email on this account'), { hint: 'step_up_failed' });
  const client = createIsolatedAuthClient();
  const sent = await client.auth.signInWithOtp({ ...target, options: { shouldCreateUser: false, ...authCaptchaOptions(captchaToken) } });
  if (sent.error) throw sent.error;
  return { status: 'sent', stepUpId: data.step_up_id, target, client };
}

// -> true when the server confirmed the step-up; false = start again
export async function finishStepUp({ stepUpId, target, client }, code) {
  const v = await client.auth.verifyOtp({ ...target, token: String(code).trim(), type: target.phone ? 'sms' : 'email' });
  if (v.error) throw v.error;
  const freshSession = sessionIdFromAccessToken(v.data?.session?.access_token);
  const { data, error } = await supabase.rpc('complete_account_step_up', {
    step_up_id_param: stepUpId, fresh_session_param: freshSession,
  });
  if (error) throw error;
  return data?.verified === true;
}
