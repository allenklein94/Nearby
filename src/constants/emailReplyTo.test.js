// The ONE Resend adapter (supabase/functions/_shared/email.ts): EMAIL_REPLY_TO is optional and only adds reply_to; with it
// unset the request body is exactly what it was. Runs the real file (types stripped by Babel's TypeScript preset).
import fs from 'fs';
import path from 'path';
import { transformSync } from '@babel/core';

const ENV = {};
const FILE = path.join(__dirname, '../../supabase/functions/_shared/email.ts');
const { code } = transformSync(fs.readFileSync(FILE, 'utf8'), {
  filename: FILE, babelrc: false, configFile: false,
  presets: ['@babel/preset-typescript'], plugins: ['@babel/plugin-transform-modules-commonjs'],
});
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'Deno', 'AbortSignal', code)(mod, mod.exports, { env: { get: (k) => ENV[k] } }, { timeout: () => undefined });
const { sendEmail, emailConfigured } = mod.exports;

function capture() {
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return { ok: true, status: 200 }; };
  return calls;
}
beforeEach(() => { for (const k of Object.keys(ENV)) delete ENV[k]; });

test('not configured: nothing is sent', async () => {
  const calls = capture();
  expect(emailConfigured()).toBe(false);
  expect(await sendEmail('o@example.com', 's', 't')).toEqual({ sent: false, reason: 'email_not_configured' });
  expect(calls).toEqual([]);
});

test('without EMAIL_REPLY_TO the body is unchanged (no reply_to)', async () => {
  Object.assign(ENV, { RESEND_API_KEY: 're_x', EMAIL_FROM: 'Nearby for Business <alerts@mail.example.com>' });
  const calls = capture();
  expect(await sendEmail('o@example.com', 'Subject', 'Body')).toEqual({ sent: true });
  expect(calls[0].url).toBe('https://api.resend.com/emails');
  expect(calls[0].body).toEqual({ from: 'Nearby for Business <alerts@mail.example.com>', to: ['o@example.com'], subject: 'Subject', text: 'Body' });
});

test('with EMAIL_REPLY_TO a reply goes to that address', async () => {
  Object.assign(ENV, { RESEND_API_KEY: 're_x', EMAIL_FROM: 'Nearby <alerts@mail.example.com>', EMAIL_REPLY_TO: ' support@example.com ' });
  const calls = capture();
  await sendEmail('o@example.com', 'S', 'T');
  expect(calls[0].body.reply_to).toBe('support@example.com');
});

test('a blank EMAIL_REPLY_TO adds nothing', async () => {
  Object.assign(ENV, { RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c', EMAIL_REPLY_TO: '  ' });
  const calls = capture();
  await sendEmail('o@example.com', 'S', 'T');
  expect('reply_to' in calls[0].body).toBe(false);
});

test('a provider error is reported, never thrown', async () => {
  Object.assign(ENV, { RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' });
  global.fetch = async () => ({ ok: false, status: 401 });
  expect(await sendEmail('o@example.com', 'S', 'T')).toEqual({ sent: false, reason: 'provider_error_401' });
  global.fetch = async () => { throw new Error('down'); };
  expect(await sendEmail('o@example.com', 'S', 'T')).toEqual({ sent: false, reason: 'provider_unreachable' });
});
