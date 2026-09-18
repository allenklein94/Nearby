import { buildPlanCalendarEvent, buildDirectionsUrl } from './planLogisticsActions';

describe('buildPlanCalendarEvent', () => {
  test('no real date -> null', () => {
    expect(buildPlanCalendarEvent({ title: 'Dinner', rawDate: null, rawTime: '19:30' })).toBeNull();
    expect(buildPlanCalendarEvent({ title: 'Dinner', rawDate: 'not-a-date', rawTime: '19:30' })).toBeNull();
  });

  test('a real date and time build a timed event with a 2-hour default duration', () => {
    const event = buildPlanCalendarEvent({ title: "Sarah's Birthday 🎂", rawDate: '2026-09-19', rawTime: '19:30', businessAddress: '123 Main St' });
    expect(event.allDay).toBe(false);
    expect(event.title).toBe("Sarah's Birthday 🎂");
    expect(event.location).toBe('123 Main St');
    expect(event.startDate.getFullYear()).toBe(2026);
    expect(event.startDate.getMonth()).toBe(8); // 0-indexed September
    expect(event.startDate.getDate()).toBe(19);
    expect(event.startDate.getHours()).toBe(19);
    expect(event.startDate.getMinutes()).toBe(30);
    expect(event.endDate.getTime() - event.startDate.getTime()).toBe(120 * 60000);
  });

  test('no real time known -> an honest all-day event, never a fabricated hour', () => {
    const event = buildPlanCalendarEvent({ title: 'Dinner', rawDate: '2026-09-19', rawTime: null });
    expect(event.allDay).toBe(true);
    expect(event.startDate.getDate()).toBe(19);
  });

  test('falls back to a generic title and omits location when neither is known', () => {
    const event = buildPlanCalendarEvent({ rawDate: '2026-09-19', rawTime: '19:30' });
    expect(event.title).toBe('Your Plan');
    expect(event.location).toBeUndefined();
  });

  test('location falls back to the business name when no address is known', () => {
    const event = buildPlanCalendarEvent({ rawDate: '2026-09-19', rawTime: '19:30', location: 'Il Forno' });
    expect(event.location).toBe('Il Forno');
  });
});

describe('buildDirectionsUrl', () => {
  test('prefers real coordinates', () => {
    expect(buildDirectionsUrl({ latitude: 40.7, longitude: -74.0, address: '123 Main St' }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=40.7,-74');
  });

  test('falls back to a real address when no coordinates are known', () => {
    expect(buildDirectionsUrl({ address: '123 Main St, NYC' }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=123%20Main%20St%2C%20NYC');
  });

  test('neither known -> null, never a fabricated destination', () => {
    expect(buildDirectionsUrl({})).toBeNull();
  });
});
