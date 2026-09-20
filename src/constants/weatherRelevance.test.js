import { homeWeatherCard } from './weatherRelevance';
import { gatheringWeatherWindow } from '../utils/weatherWindow';

const H = 3600;
const nowS = Math.floor(Date.now() / 1000);
const wx = (block = {}, extra = {}) => ({
  forecast_blocks: [{ dt: nowS - H, temp: 70, pop: 0, id: 800, ...block }],
  sunrise: nowS - 2 * H, sunset: nowS + 2 * H, ...extra,
});
const g = (id = 'g') => ({ id, scheduled_at: new Date().toISOString() });

describe('gatheringWeatherWindow', () => {
  it('labels structured conditions at the gathering time', () => {
    expect(gatheringWeatherWindow(wx({ pop: 0.7, id: 500 }), g().scheduled_at).label).toBe('Rain expected');
    expect(gatheringWeatherWindow(wx({ pop: 0.4, id: 211 }), g().scheduled_at).label).toBe('Storms expected');
    expect(gatheringWeatherWindow(wx({ pop: 0.4, id: 601 }), g().scheduled_at).label).toBe('Snow expected');
    expect(gatheringWeatherWindow(wx({ temp: 99 }), g().scheduled_at).label).toBe('Very warm');
    expect(gatheringWeatherWindow(wx({ temp: 30 }), g().scheduled_at).label).toBe('Cold out');
    expect(gatheringWeatherWindow(wx(), g().scheduled_at).label).toBe('Good outdoor window');
  });
  it('drizzle/medium precipitation is never a favorable window', () => {
    expect(gatheringWeatherWindow(wx({ pop: 0.35, id: 300 }), g().scheduled_at)).toBeNull();
  });
  it('unknown facts are never favorable', () => {
    expect(gatheringWeatherWindow(null, g().scheduled_at)).toBeNull();
    expect(gatheringWeatherWindow({ forecast_blocks: null }, g().scheduled_at)).toBeNull();
    expect(gatheringWeatherWindow(wx({}, { sunrise: null, sunset: null }), g().scheduled_at)).toBeNull();
    expect(gatheringWeatherWindow(wx({}, { sunrise: nowS + 5 * H, sunset: nowS + 9 * H }), g().scheduled_at)).toBeNull(); // night
    const later = new Date(Date.now() + 10 * H * 1000).toISOString(); // no covering block
    expect(gatheringWeatherWindow(wx(), later)).toBeNull();
  });
  it('judges the gathering time, not now: rain later does not taint an earlier gathering', () => {
    const weather = { ...wx(), forecast_blocks: [
      { dt: nowS - H, temp: 70, pop: 0, id: 800 },
      { dt: nowS + 2 * H, temp: 70, pop: 0.9, id: 501 },
    ] };
    expect(gatheringWeatherWindow(weather, new Date().toISOString()).bias).toBe('outdoor');
    expect(gatheringWeatherWindow(weather, new Date(Date.now() + 3 * H * 1000).toISOString()).bias).toBe('indoor');
  });
});

describe('homeWeatherCard', () => {
  it('renders only with a real thing to point at, from the gathering-time window', () => {
    expect(homeWeatherCard({ weather: wx(), outdoorUpcoming: [] })).toBeNull();
    expect(homeWeatherCard({ weather: wx(), outdoorUpcoming: [g()] }).label).toBe('Good outdoor window');
  });
  it('indoor gatherings only under an indoor window; outdoor ones never appear then', () => {
    const rain = wx({ pop: 0.8, id: 501 });
    expect(homeWeatherCard({ weather: rain, outdoorUpcoming: [g()] })).toBeNull();
    expect(homeWeatherCard({ weather: rain, indoorUpcoming: [g()] }).bias).toBe('indoor');
  });
  it('is suppressed while an intent result is active or the forecast is unknown', () => {
    expect(homeWeatherCard({ weather: wx(), outdoorUpcoming: [g()], intentActive: true })).toBeNull();
    expect(homeWeatherCard({ weather: null, outdoorUpcoming: [g()] })).toBeNull();
  });
});
