import fs from 'fs';
import path from 'path';
import { offerAcceptButtonState } from './offerAcceptLock';

describe('offerAcceptButtonState (idea "193": one booking at a time, shown on every offer)', () => {
  test('nothing booking: a bookable offer is enabled and not dimmed', () => {
    expect(offerAcceptButtonState('a', null, true)).toEqual({ busy: false, disabled: false, dimmed: false });
  });
  test('nothing booking: an offer waiting for a time pick stays disabled and dimmed (item 119)', () => {
    expect(offerAcceptButtonState('a', null, false)).toEqual({ busy: false, disabled: true, dimmed: true });
  });
  test('the offer being booked: spinner, disabled, not dimmed', () => {
    expect(offerAcceptButtonState('a', 'a', true)).toEqual({ busy: true, disabled: true, dimmed: false });
  });
  test('another offer is booking: visibly disabled, no spinner', () => {
    expect(offerAcceptButtonState('b', 'a', true)).toEqual({ busy: false, disabled: true, dimmed: true });
    expect(offerAcceptButtonState('b', 'a', false)).toEqual({ busy: false, disabled: true, dimmed: true });
  });
  test('booking finished (success or failure clears the id): every button follows its own state again', () => {
    expect(offerAcceptButtonState('b', null, true).disabled).toBe(false);
  });
});

describe('wiring (request screen)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'BusinessRequestDetailScreen.js'), 'utf8');
  test('the accept button reads the one rule for disabled, dimmed and spinner', () => {
    expect(src).toMatch(/offerAcceptButtonState\(o\.id, actingOfferId, bookable\)/);
    expect(src).toMatch(/disabled=\{acceptState\.disabled\}/);
    expect(src).toMatch(/acceptState\.dimmed && styles\.acceptButtonWaiting/);
    expect(src).toMatch(/acceptState\.busy \? <ActivityIndicator/);
  });
  test('the in-flight id clears after the booking whatever the outcome (after the try/finally)', () => {
    const body = src.slice(src.indexOf('async function handleAccept'), src.indexOf('async function', src.indexOf('async function handleAccept') + 10));
    expect(body).toMatch(/finally \{\s*acceptingRef\.current = false;\s*\}\s*setActingOfferId\(null\);/);
  });
  test('no press-scale on the accept button (press compression skipped, owner)', () => {
    expect(src).not.toMatch(/ScaleButton/);
  });
});
