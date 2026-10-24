// Idea "384": a chosen posting the server can no longer bind is refused (nothing sent) and reads as an input problem with the
// existing "No longer available", never a Try Again; every other server error keeps its own message.
// Idea "394": a request for a time already passed (stated day + time, or a started gathering) reads the same way, with the
// existing "That time window has already passed."; both request paths (general + gathering) go through it.
const fs = require('fs');
const path = require('path');
const { requestRefusal } = require('./requestRefusal');
const { recoverableErrorCopy } = require('./recoverableError');

test.each(['posting_unavailable', 'posting_mismatch'])('%s = "No longer available", no Try Again', (hint) => {
  const e = requestRefusal({ message: 'That posting is no longer available', hint });
  expect(e.message).toBe('No longer available');
  expect(e.code).toBe(hint);
  expect(recoverableErrorCopy({ what: 'send your request', error: e, draftKept: true }).canRetry).toBe(false);
});

test('request_time_passed = "That time window has already passed.", no Try Again', () => {
  for (const message of ['That time has already passed.', 'This gathering has already started.']) {
    const e = requestRefusal({ message, hint: 'request_time_passed' });
    expect(e.message).toBe('That time window has already passed.');
    expect(e.code).toBe('request_time_passed');
    expect(recoverableErrorCopy({ what: 'send your request', error: e, draftKept: true }).canRetry).toBe(false);
  }
});

test('any other server error keeps its message', () => {
  expect(requestRefusal({ message: 'That business could not be found' }).message).toBe('That business could not be found');
});

test('the general and the gathering request calls both go through it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/businessFulfillment.js'), 'utf8');
  for (const rpc of ["rpc('create_business_request',", "rpc('create_business_request_for_gathering',"]) {
    const call = src.slice(src.indexOf(rpc));
    expect(call.slice(0, call.indexOf('return ')).includes('throw requestRefusal(error)')).toBe(true);
  }
});
