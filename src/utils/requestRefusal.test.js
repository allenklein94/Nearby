// Idea "384": a chosen posting the server can no longer bind is refused (nothing sent) and reads as an input problem with the
// existing "No longer available", never a Try Again; every other server error keeps its own message.
const { requestRefusal } = require('./requestRefusal');
const { recoverableErrorCopy } = require('./recoverableError');

test.each(['posting_unavailable', 'posting_mismatch'])('%s = "No longer available", no Try Again', (hint) => {
  const e = requestRefusal({ message: 'That posting is no longer available', hint });
  expect(e.message).toBe('No longer available');
  expect(e.code).toBe(hint);
  expect(recoverableErrorCopy({ what: 'send your request', error: e, draftKept: true }).canRetry).toBe(false);
});

test('any other server error keeps its message', () => {
  expect(requestRefusal({ message: 'That business could not be found' }).message).toBe('That business could not be found');
});
