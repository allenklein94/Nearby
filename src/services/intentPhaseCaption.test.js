const fs = require('fs'); const path = require('path');
const { intentPhaseCaption } = require('./intentResolverScoring');

test('phase captions follow the real pipeline and what the request was understood as', () => {
  expect(intentPhaseCaption('understanding')).toBe('Understanding your request…');
  expect(intentPhaseCaption('finding', { intent: 'gathering' })).toBe('Finding activities…');
  expect(intentPhaseCaption('finding', { intent: 'community' })).toBe('Finding communities…');
  expect(intentPhaseCaption('finding', { intent: 'business_availability' })).toBe('Checking availability…');
  expect(intentPhaseCaption('finding')).toBe('Finding activities…');
  expect(intentPhaseCaption('done')).toBeNull();
});

// No theatrical delay: phases are reported as the real work moves, never on a timer.
test('the intent pipeline reports phases without any artificial delay', () => {
  const src = fs.readFileSync(path.join(__dirname, 'intentResolver.js'), 'utf8');
  const body = src.slice(src.indexOf('export async function runIntentSearch'), src.indexOf('export async function runIntentSearch') + 900);
  expect(body).toMatch(/onPhase\?\.\(\{ phase: 'understanding' \}\)/);
  expect(body).toMatch(/onPhase\?\.\(\{ phase: 'finding', classifyResult \}\)/);
  expect(body).not.toMatch(/setTimeout|delay|sleep/i);
});
