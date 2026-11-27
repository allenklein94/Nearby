// N6: other people's profiles arrive with `age`, never the birthdate, on today's DB and after 20270348.
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getSession: jest.fn() } } }));
const { selectPeople, legacyColumns, shapeLegacyRow, ageFromBirthdate, isMissingAge } = require('./peopleRead');
const { readMyProfile, isMissingFunction } = require('./myProfile');
const { supabase } = require('./supabase');

const TODAY = new Date(2026, 9, 28);

describe('selectPeople', () => {
  test('after N6: one read, rows untouched', async () => {
    const run = jest.fn(async () => ({ data: [{ id: 'a', age: 30 }], error: null }));
    const res = await selectPeople(run, 'id, age');
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual([{ id: 'a', age: 30 }]);
  });

  test('before N6: 42703 on age -> the birthdate read, shaped like the new view', async () => {
    const run = jest.fn(async (cols) => (cols.includes('birthdate')
      ? { data: { id: 'a', birthdate: '1990-01-01', gender: 'Woman', gender_hidden: true, ethnicity: 'x', ethnicity_hidden: false, gender_identity: ['w'] }, error: null }
      : { data: null, error: { code: '42703', message: 'column people_visible_to_me.age does not exist' } }));
    const res = await selectPeople(run, 'id, age, gender, ethnicity, gender_identity');
    expect(run.mock.calls[1][0]).toBe('id, birthdate, gender, ethnicity, gender_identity, gender_hidden, ethnicity_hidden');
    expect(res.data).toEqual({ id: 'a', age: res.data.age, gender: null, ethnicity: 'x', gender_identity: null });
    expect(typeof res.data.age).toBe('number');
  });

  test('another error is returned as is, no retry', async () => {
    const run = jest.fn(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    const res = await selectPeople(run, 'id, age');
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.error.code).toBe('42501');
  });

  test('helpers', () => {
    expect(isMissingAge({ code: '42703', message: 'column "age" does not exist' })).toBe(true);
    expect(isMissingAge({ code: '42703', message: 'column "id_verified" does not exist' })).toBe(false);
    expect(legacyColumns('id, age')).toBe('id, birthdate');
    expect(ageFromBirthdate('1990-10-29', TODAY)).toBe(35);
    expect(ageFromBirthdate('1990-10-28', TODAY)).toBe(36);
    expect(ageFromBirthdate(null, TODAY)).toBeNull();
    expect(shapeLegacyRow({ id: 'a', birthdate: '1990-01-01' }, 'id', TODAY)).toEqual({ id: 'a' });
  });
});

describe('readMyProfile', () => {
  const chain = (result) => {
    const q = { select: jest.fn(() => q), eq: jest.fn(() => q), maybeSingle: jest.fn(async () => result) };
    return q;
  };
  beforeEach(() => jest.clearAllMocks());

  test('after N6: get_my_profile only, never a direct profiles read', async () => {
    supabase.rpc.mockReturnValue(chain({ data: { id: 'me', birthdate: '1990-01-01' }, error: null }));
    const res = await readMyProfile('id, birthdate');
    expect(supabase.rpc).toHaveBeenCalledWith('get_my_profile');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(res.data.id).toBe('me');
  });

  test('before N6 (PGRST202): the own row read directly, by the session id', async () => {
    supabase.rpc.mockReturnValue(chain({ data: null, error: { code: 'PGRST202' } }));
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
    const q = chain({ data: { id: 'me' }, error: null });
    supabase.from.mockReturnValue(q);
    const res = await readMyProfile('id');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(q.eq).toHaveBeenCalledWith('id', 'me');
    expect(res.data).toEqual({ id: 'me' });
  });

  test('signed out on the fallback = no row, no query', async () => {
    supabase.rpc.mockReturnValue(chain({ data: null, error: { code: 'PGRST202' } }));
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await readMyProfile('id')).toEqual({ data: null, error: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('isMissingFunction', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42501' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

// The 0347 Dating view (production today): no age AND no hide switches, gender / ethnicity raw. Found by the release
// compatibility run 2026-11-27 (build 87 + 88 Dating Browse came back empty on 0347).
describe('selectPeople on a view without hide switches (dating_candidates_visible_to_me before 20270348)', () => {
  const MISSING_AGE = { data: null, error: { code: '42703', message: 'column dating_candidates_visible_to_me.age does not exist' } };
  const MISSING_SWITCH = { data: null, error: { code: '42703', message: 'column dating_candidates_visible_to_me.ethnicity_hidden does not exist' } };
  const rows = [
    { id: 'shown', birthdate: '1990-01-01', ethnicity: 'e1', gender_identity: ['w'], interested_in_genders: ['m'] },
    { id: 'hid', birthdate: '1991-01-01', ethnicity: 'e2', gender_identity: ['m'], interested_in_genders: ['w'] },
    { id: 'unknown', birthdate: '1992-01-01', ethnicity: 'e3', gender_identity: ['w'], interested_in_genders: ['w'] },
  ];
  const run = jest.fn(async (cols) => {
    if (!cols.includes('birthdate')) return MISSING_AGE;
    if (cols.includes('_hidden')) return MISSING_SWITCH;
    return { data: rows, error: null };
  });

  test('switches read from people_visible_to_me; hidden fields emptied; a person with no switch row = hidden', async () => {
    const reader = jest.fn(async () => new Map([
      ['shown', { id: 'shown', gender_hidden: false, ethnicity_hidden: false }],
      ['hid', { id: 'hid', gender_hidden: true, ethnicity_hidden: true }],
    ]));
    const res = await selectPeople(run, 'id, age, ethnicity, gender_identity, interested_in_genders', reader);
    expect(run.mock.calls[2][0]).toBe('id, birthdate, ethnicity, gender_identity, interested_in_genders');
    expect(reader).toHaveBeenCalledWith(['shown', 'hid', 'unknown']);
    const by = Object.fromEntries(res.data.map((r) => [r.id, r]));
    expect(by.shown).toMatchObject({ ethnicity: 'e1', gender_identity: ['w'], interested_in_genders: ['m'] });
    expect(by.hid).toMatchObject({ ethnicity: null, gender_identity: null, interested_in_genders: null });
    expect(by.unknown).toMatchObject({ ethnicity: null, gender_identity: null, interested_in_genders: null });
    for (const r of res.data) { expect(r).not.toHaveProperty('birthdate'); expect(r).not.toHaveProperty('ethnicity_hidden'); expect(typeof r.age).toBe('number'); }
  });

  test('switch read fails = everyone treated as hidden (never shown by default)', async () => {
    const res = await selectPeople(run, 'id, age, ethnicity', async () => { throw new Error('offline'); });
    expect(res.data.map((r) => r.ethnicity)).toEqual([null, null, null]);
  });

  test('id is fetched for the switch lookup but not returned when the caller did not ask for it', async () => {
    const res = await selectPeople(run, 'age, ethnicity', async () => new Map());
    expect(res.data[0]).not.toHaveProperty('id');
  });
});
