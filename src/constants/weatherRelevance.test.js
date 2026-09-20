import { weatherLabel, homeWeatherCard } from './weatherRelevance';

const clear = { condition: 'Clear', temp_f: 70, forecast_label: 'Excellent', forecast_detail: 'Clear skies.', rain_risk: 'low', outdoor_favorable: true, heat_risk: false, cold_risk: false, is_daylight: true };
const g = [{ id: 'g', scheduled_at: new Date(Date.now() + 3600e3).toISOString() }];

describe('weatherLabel', () => {
  it('labels structured conditions', () => {
    expect(weatherLabel({ ...clear, condition: 'Rain', forecast_label: 'Quiet' }).label).toBe('Rain expected');
    expect(weatherLabel({ ...clear, condition: 'Thunderstorm', forecast_label: 'Quiet' }).label).toBe('Storms expected');
    expect(weatherLabel({ ...clear, rain_risk: 'high', outdoor_favorable: false }).label).toBe('Rain expected');
    expect(weatherLabel({ ...clear, temp_f: 99, forecast_label: 'Quiet' }).label).toBe('Very warm');
    expect(weatherLabel({ ...clear, temp_f: 30, forecast_label: 'Quiet' }).label).toBe('Cold out');
    expect(weatherLabel(clear).label).toBe('Good outdoor window');
  });
  it('never claims an outdoor window at night, in unknown daylight, or with an unknown/wet forecast', () => {
    expect(weatherLabel({ ...clear, is_daylight: false })).toBeNull();
    expect(weatherLabel({ ...clear, is_daylight: null })).toBeNull();
    expect(weatherLabel({ ...clear, rain_risk: null, outdoor_favorable: null })).toBeNull();
    expect(weatherLabel({ ...clear, rain_risk: 'medium', outdoor_favorable: false })).toBeNull();
    expect(weatherLabel(null)).toBeNull();
  });
});

describe('homeWeatherCard', () => {
  it('renders only with a real thing to point at', () => {
    expect(homeWeatherCard({ weather: clear, outdoorUpcoming: [] })).toBeNull();
    expect(homeWeatherCard({ weather: clear, outdoorUpcoming: g }).label).toBe('Good outdoor window');
  });
  it('uses indoor gatherings for indoor bias, never outdoor ones', () => {
    const rain = { ...clear, condition: 'Rain', forecast_label: 'Quiet' };
    expect(homeWeatherCard({ weather: rain, outdoorUpcoming: g })).toBeNull();
    expect(homeWeatherCard({ weather: rain, indoorUpcoming: g }).bias).toBe('indoor');
  });
  it('is suppressed while an intent result is active', () => {
    expect(homeWeatherCard({ weather: clear, outdoorUpcoming: g, intentActive: true })).toBeNull();
  });
});
