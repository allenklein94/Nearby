const fs = require('fs');
const path = require('path');
const { formatDistance, formatDistanceAway } = require('./formatDistance');

describe('formatDistance', () => {
  it('short distances read in feet, rounded to 50', () => {
    expect(formatDistance(0.15)).toBe('800 ft');
    expect(formatDistance(0.04)).toBe('200 ft');
    expect(formatDistance(0.005)).toBe('Under 100 ft');
    expect(formatDistance(0)).toBe('Under 100 ft');
  });
  it('mid distances read in one-decimal miles, never a raw float', () => {
    expect(formatDistance(1.23456)).toBe('1.2 mi');
    expect(formatDistance(3.4)).toBe('3.4 mi');
    expect(formatDistance(0.2)).toBe('0.2 mi');
    expect(formatDistance(0.19)).toBe('0.2 mi');
  });
  it('long distances read in whole miles', () => {
    expect(formatDistance(12.4)).toBe('12 mi');
    expect(formatDistance(9.96)).toBe('10 mi');
  });
  it('unknown is null, never an invented distance', () => {
    for (const v of [null, undefined, NaN, -1, '1.2', Infinity]) expect(formatDistance(v)).toBeNull();
    expect(formatDistanceAway(null)).toBeNull();
    expect(formatDistanceAway(0.15)).toBe('800 ft away');
  });
});

describe('no ad-hoc distance formatting', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  it('no source builds a distance string with its own toFixed + mi', () => {
    const offenders = walk(path.join(__dirname, '..'))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.endsWith('formatDistance.js'))
      .filter((f) => /distance[A-Za-z_]*(\?\.)?\)?\.toFixed\(\d\)/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
