import fs from 'fs';
import path from 'path';
import { mergePlanRows } from './planRows';

const g = (id, at = '2026-10-10T19:00:00Z') => ({ id, scheduled_at: at });

describe('a plan list shows each gathering once, with its strongest role', () => {
  test('hosting wins over going and Interested for the same gathering', () => {
    const rows = mergePlanRows([
      { gathering: g('a'), status: 'going' },
      { gathering: g('a'), status: 'hosting' },
      { gathering: g('a'), status: 'maybe' },
      { gathering: g('b'), status: 'going' },
    ]);
    expect(rows.map((r) => [r.gathering.id, r.status])).toEqual([['a', 'hosting'], ['b', 'going']]);
  });
  test('going wins over Interested; hosted wins over attended', () => {
    expect(mergePlanRows([{ gathering: g('a'), status: 'maybe' }, { gathering: g('a'), status: 'going' }])[0].status).toBe('going');
    expect(mergePlanRows([{ gathering: g('a'), status: 'attended' }, { gathering: g('a'), status: 'hosted' }])[0].status).toBe('hosted');
  });
  test('distinct gatherings are all kept, in order; nothing is added', () => {
    const input = [{ gathering: g('a'), status: 'going' }, { gathering: g('b'), status: 'hosting' }, { gathering: g('c'), status: 'maybe' }];
    expect(mergePlanRows(input)).toEqual(input);
    expect(mergePlanRows([])).toEqual([]);
  });
  test('the Plans screen builds every tab through it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/PlansScreen.js'), 'utf8');
    expect(src).toMatch(/import \{ mergePlanRows \} from '\.\.\/utils\/planRows'/);
    expect((src.match(/return mergePlanRows\(\[/g) ?? []).length).toBe(3);
  });
});
