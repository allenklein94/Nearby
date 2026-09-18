jest.mock('./supabase', () => ({ supabase: {} }));
import { createNotificationAreaReporter } from './notificationArea';

test('reports once per coarse area per 30 minutes, again on a move, retries after failure', async () => {
  let t = 0;
  const send = jest.fn().mockResolvedValue();
  const report = createNotificationAreaReporter({ send, now: () => t });
  await report({ latitude: 40.711, longitude: -74.001 });
  await report({ latitude: 40.714, longitude: -74.004 }); // same 2-decimal area
  expect(send).toHaveBeenCalledTimes(1);
  t += 31 * 60 * 1000;
  await report({ latitude: 40.711, longitude: -74.001 });
  expect(send).toHaveBeenCalledTimes(2);
  await report({ latitude: 41.5, longitude: -74.001 });
  expect(send).toHaveBeenCalledTimes(3);
  send.mockRejectedValueOnce(new Error('x'));
  await report({ latitude: 42.5, longitude: -74.001 });
  await report({ latitude: 42.5, longitude: -74.001 });
  expect(send).toHaveBeenCalledTimes(5);
  await report(null);
  expect(send).toHaveBeenCalledTimes(5);
});
