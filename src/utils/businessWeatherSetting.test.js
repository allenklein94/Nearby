import { businessWeatherAdjustment as adj, BUSINESS_WEATHER_SETTINGS } from './weatherBias';
import { buildHomeRecommendations } from '../services/homeRecommendations';

const rain = { forecast_label: 'Quiet', rain_risk: 'high' };
const nice = { outdoor_favorable: true, forecast_label: 'Excellent' };
const unknown = { outdoor_favorable: null };

describe('business weather setting (item 63)', () => {
  it('outdoor: down in rain, up in a known good window', () => {
    expect(adj('outdoor', rain, 3)).toBe(-3);
    expect(adj('outdoor', nice, 3)).toBe(3);
  });
  it('weather dependent: down in bad weather, never promoted', () => {
    expect(adj('weather_dependent', rain, 3)).toBe(-3);
    expect(adj('weather_dependent', nice, 3)).toBe(0);
  });
  it('indoor: up in bad weather, never penalized', () => {
    expect(adj('indoor', rain, 3)).toBe(3);
    expect(adj('indoor', nice, 3)).toBe(0);
  });
  it('not said or unknown weather = no effect', () => {
    expect(adj(null, rain, 3)).toBe(0);
    expect(adj('outdoor', null, 3)).toBe(0);
    expect(adj('outdoor', unknown, 3)).toBe(0);
    expect(adj('sunny', rain, 3)).toBe(0);
    expect(BUSINESS_WEATHER_SETTINGS).toEqual(['indoor', 'outdoor', 'weather_dependent']);
  });
  it('ranks but never hides: a rained-out outdoor perk drops below an indoor one and both are still returned', () => {
    const offer = (id, weather_setting) => ({ id, title: id, brand_partners: { name: id, weather_setting } });
    const out = buildHomeRecommendations({ offers: [offer('out', 'outdoor'), offer('in', 'indoor'), offer('none', null)], weather: rain });
    expect(out.map((r) => r.id)).toEqual(['in', 'none', 'out']);
    const fine = buildHomeRecommendations({ offers: [offer('out', 'outdoor'), offer('in', 'indoor'), offer('none', null)], weather: nice });
    expect(fine[0].id).toBe('out');
    expect(fine).toHaveLength(3);
  });
});
