// Owner item 193 (2026-10-04, LOCKED): weather is mentioned only when it materially changes the recommendation.
const fs = require('fs');
const path = require('path');
const { weatherMention, isWeatherOutdoorBiased } = require('./weatherBias');
const { translate } = require('../i18n/translate');

const H = 3600;
const now = new Date();
const nowS = Math.floor(now.getTime() / 1000);
const wx = (block = {}, extra = {}) => ({
  outdoor_favorable: true, rain_risk: 'low', heat_risk: false, cold_risk: false, forecast_label: 'Clear',
  forecast_blocks: [{ dt: nowS - H, temp: 72, pop: 0, id: 800, ...block }],
  sunrise: nowS - 3 * H, sunset: nowS + 3 * H, ...extra,
});
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('when weather is named', () => {
  it('no meaningful effect: an ordinary dry day re-ranks but is never mentioned', () => {
    const ordinary = wx({ temp: 88, pop: 0.05 });
    expect(isWeatherOutdoorBiased(ordinary)).toBe(true); // it still nudges outdoor plans up
    expect(weatherMention(ordinary, now)).toBeNull();
    expect(weatherMention(wx({ pop: 0.2 }), now)).toBeNull();
    expect(weatherMention(null, now)).toBeNull();
  });

  it('strong effect: bad weather and an exceptional outdoor window are explained', () => {
    expect(weatherMention(wx({}, { rain_risk: 'high', outdoor_favorable: false }), now)).toBe('indoor');
    expect(weatherMention(wx({}, { heat_risk: true, outdoor_favorable: false }), now)).toBe('indoor');
    expect(weatherMention(wx({ temp: 72, pop: 0 }), now)).toBe('outdoor');
  });

  it('an exceptional forecast at night is not "great weather" now', () => {
    expect(weatherMention(wx({}, { sunrise: nowS + 2 * H, sunset: nowS + 6 * H }), now)).toBeNull();
  });
});

describe('every weather-talking surface uses the one rule', () => {
  it('Discover banner + card reasons read weatherMention, never the raw bias', () => {
    const discover = read('src/screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/const weatherSaid = weatherMention\(weatherSignal\)/);
    expect(discover).toMatch(/if \(weatherSaid === 'indoor'\) fit\.reasons = \[\.\.\.fit\.reasons, reasonText\('goodForWeather'\)\]/);
    expect(discover).toMatch(/if \(weatherSaid === 'outdoor'\) fit\.reasons = \[\.\.\.fit\.reasons, reasonText\('greatWeatherForIt'\)\]/);
    expect(discover).toMatch(/const weatherBanner = weatherSaid === 'indoor'/);
  });

  it('Home already speaks only when material: its card needs bad or exceptional weather, its reason line only exceptional', () => {
    expect(read('src/constants/weatherRelevance.js')).toMatch(/filter\(\(\{ w \}\) => w\.exceptional\)/);
    expect(read('src/services/homeRecommendations.js')).toMatch(/exceptional/);
  });

  it('the banners never claim weather puts options "first" (it is a weak ranking tier)', () => {
    for (const lang of ['en', 'es', 'de', 'fr']) {
      for (const k of ['weatherIndoor', 'weatherOutdoor']) {
        expect(translate(lang, `ui.discover.${k}`)).toBe(translate(lang, `ui.gatherings.${k}`));
      }
    }
    expect(translate('en', 'ui.discover.weatherOutdoor')).not.toMatch(/first/i);
  });
});
