import fs from 'fs';
import { recoverableErrorCopy, isServiceFailure, presentRecoverableError, serviceError } from './recoverableError';

describe('errors always offer a way forward and never lose the draft (item 81)', () => {
  it('a screening outage says what happened, that the draft is saved, and offers Try Again', () => {
    const e = serviceError({ status: 503 }, { error: "We couldn't review this right now.", code: 'screening_unavailable' }, 'x');
    const alert = { alert: jest.fn() };
    const retry = jest.fn();
    const copy = presentRecoverableError(alert, { what: 'review this offer', error: e, draftKept: true, onRetry: retry });
    expect(copy.title).toBe("We couldn't review this offer right now.");
    expect(copy.message).toBe('Your draft is saved.');
    const buttons = alert.alert.mock.calls[0][2];
    expect(buttons.map((b) => b.text)).toEqual(['Not now', 'Try Again']);
    buttons[1].onPress();
    expect(retry).toHaveBeenCalled();
  });
  it('offline errors add the connection hint', () => {
    expect(recoverableErrorCopy({ what: 'send this offer', error: new TypeError('Network request failed'), draftKept: true }).message)
      .toBe('Check your connection. Your draft is saved.');
  });
  it('does not claim a draft when the caller did not keep one', () => {
    expect(recoverableErrorCopy({ what: 'do that', error: serviceError({ status: 500 }, {}, 'boom') }).message).toBe('Nothing was lost. Please try again.');
  });
  it('an input problem shows the fix and offers no retry (retrying would fail the same way)', () => {
    const e = serviceError({ status: 400 }, { error: 'Discount cannot exceed 20%.' }, 'x');
    expect(isServiceFailure(e)).toBe(false);
    const alert = { alert: jest.fn() };
    presentRecoverableError(alert, { what: 'send this offer', error: e, draftKept: true, onRetry: () => {} });
    expect(alert.alert).toHaveBeenCalledWith("That didn't go through", 'Discount cannot exceed 20%.');
  });
  it('the business screening handlers and the consumer create flows use it, not a bare Error alert', () => {
    const dash = fs.readFileSync(`${__dirname}/../screens/BusinessDashboardScreen.js`, 'utf8');
    for (const fn of ['handleSubmitOffer', 'submitQuickResponse', 'handleCreateOffer', 'handlePostAvailability', 'handlePostUpdate', 'handleSaveProfile', 'handleSaveExperience']) {
      const start = dash.indexOf(`async function ${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const next = dash.indexOf('\n  async function ', start + 10);
      expect(dash.slice(start, next > 0 ? next : undefined)).toContain('presentRecoverableError');
    }
    for (const f of ['AskBusinessScreen', 'CreateGatheringScreen', 'DateProposalScreen', 'EditGatheringScreen']) {
      expect(fs.readFileSync(`${__dirname}/../screens/${f}.js`, 'utf8')).toContain('presentRecoverableError');
    }
  });
  it('no bare "Error" + raw message alert is left anywhere in the app', () => {
    const path = require('path');
    const hits = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        if (/Alert\.alert\('(Error|Something went wrong)', (e|err|error)\.message/.test(src)) hits.push(full);
      }
    });
    walk(`${__dirname}/..`);
    expect(hits).toEqual([]);
  });
});
