import { bestTimeLine } from './bestTime';
test('states its basis in the local clock', () => {
  const sample = new Date(2026, 7, 29, 17, 42).toISOString(); // local 5:42 PM
  expect(bestTimeLine({ best_time_sample: sample, best_time_gatherings: 1 })).toBe('Most attended start time: 5 PM (from 1 gathering)');
  expect(bestTimeLine({ best_time_sample: sample, best_time_gatherings: 3 })).toMatch(/from 3 gatherings/);
});
test('no basis, no line', () => {
  expect(bestTimeLine(null)).toBeNull();
  expect(bestTimeLine({ best_time_sample: null, best_time_gatherings: null })).toBeNull();
  expect(bestTimeLine({ best_time_sample: 'x', best_time_gatherings: 2 })).toBeNull();
});
