// Typed indoor / outdoor in all 11 languages (2026-10-02, owner). Every language: the side, its negation, tentative vs firm,
// and a terrace / sitting outside = the outdoor_seating attribute (never an environment must). English is unchanged.
const { parseAskFacets, attributesFromAsk, askFacetsEligible } = require('./askFacets');
const { ENVIRONMENT_WORD_LANGUAGES } = require('./environmentWords');
const { translations } = require('../i18n/translations');

// [lang, outdoor (firm/plain), indoor (plain), tentative outdoor, firm despite a maybe, nothing outdoors, terrace]
const CASES = [
  ['en', 'something outside tonight', 'something indoors tonight', 'maybe something outdoors?', 'maybe dinner, but it has to be outside', 'nothing outdoors tonight', 'coffee on a patio'],
  ['es', 'algo al aire libre esta noche', 'algo bajo techo esta noche', 'quizás algo al aire libre', 'tal vez cenar, pero tiene que ser al aire libre', 'no quiero nada al aire libre', 'un café con terraza'],
  ['de', 'etwas draußen heute Abend', 'etwas drinnen heute Abend', 'vielleicht etwas draußen', 'vielleicht essen, aber es muss draußen sein', 'heute nichts draußen', 'Kaffee auf der Terrasse'],
  ['fr', 'quelque chose en plein air ce soir', "quelque chose à l'intérieur ce soir", 'peut-être quelque chose dehors', 'peut-être dîner, mais il faut que ce soit dehors', 'je ne veux pas être dehors', 'un café en terrasse'],
  ['pt', 'algo ao ar livre hoje à noite', 'algo em ambiente fechado hoje', 'talvez algo ao ar livre', 'talvez jantar, mas tem que ser ao ar livre', 'não quero nada ao ar livre', 'um café na esplanada'],
  ['ht', 'yon bagay deyò aswè a', 'yon bagay anndan aswè a', 'petèt yon bagay deyò', 'petèt manje, men fòk li deyò', 'mwen pa vle deyò', 'yon kafe sou teras'],
  ['zh', '今晚户外活动', '今晚室内活动', '也许去户外走走', '也许吃饭，但一定要在户外', '不要户外的', '有露天座位的咖啡店'],
  ['vi', 'tối nay đi chơi ngoài trời', 'tối nay chơi trong nhà', 'có lẽ đi đâu ngoài trời', 'có lẽ ăn tối, nhưng phải ngoài trời', 'không muốn ở ngoài trời', 'cà phê ngồi ngoài trời'],
  ['tl', 'isang bagay sa labas ngayong gabi', 'isang bagay sa loob ngayong gabi', 'siguro sa labas', 'siguro kumain, pero dapat sa labas', 'ayoko sa labas', 'kape, umupo sa labas'],
  ['ru', 'что-нибудь на улице сегодня вечером', 'что-нибудь в помещении сегодня', 'может быть что-нибудь на улице', 'может быть ужин, но обязательно на улице', 'не хочу на улице', 'кофе на веранде'],
  ['ko', '오늘 밤 야외에서 할 거', '오늘 밤 실내에서 할 거', '아마 야외에서 뭐 할까', '아마 저녁, 근데 꼭 야외에서', '야외는 싫어', '테라스 있는 카페'],
];

describe('every app language is covered', () => {
  test('the case table and the word lists name all 11 languages', () => {
    expect(CASES.map((c) => c[0]).sort()).toEqual([...ENVIRONMENT_WORD_LANGUAGES].sort());
    expect(ENVIRONMENT_WORD_LANGUAGES).toHaveLength(11);
    expect([...ENVIRONMENT_WORD_LANGUAGES].sort()).toEqual(Object.keys(translations).sort());
  });
});

describe.each(CASES)('%s', (lang, outdoor, indoor, tentative, firmDespiteMaybe, negated, terrace) => {
  test('outdoor, plain = a must', () => expect(parseAskFacets(outdoor)).toMatchObject({ environment: 'outdoor', environmentRequired: true }));
  test('indoor, plain = a must', () => expect(parseAskFacets(indoor)).toMatchObject({ environment: 'indoor', environmentRequired: true }));
  test('tentative = a preference only', () => expect(parseAskFacets(tentative)).toMatchObject({ environment: 'outdoor', environmentRequired: false }));
  test('firm wording beats a maybe', () => expect(parseAskFacets(firmDespiteMaybe)).toMatchObject({ environment: 'outdoor', environmentRequired: true }));
  test('negated = an exclusion, never an outdoor ask', () => {
    const f = parseAskFacets(negated);
    expect(f.environment).toBeNull();
    expect(f.exclude).toContain('outdoor');
  });
  test('a terrace / sitting outside = the outdoor_seating attribute, not an environment must', () => {
    expect(parseAskFacets(terrace).environmentRequired).toBe(false);
    expect(attributesFromAsk(terrace)).toContain('outdoor_seating');
  });
  test('the strict rule applies: a firm ask keeps only the known asked side', () => {
    const items = [{ id: 'u' }, { id: 'in', env: 'indoor' }, { id: 'out', env: 'outdoor' }];
    const envOf = (c) => c.env ?? null;
    expect(askFacetsEligible(items, parseAskFacets(outdoor), envOf).items.map((c) => c.id)).toEqual(['out']);
    expect(askFacetsEligible(items, parseAskFacets(indoor), envOf).items.map((c) => c.id)).toEqual(['in']);
  });
});

describe('ordinary asks in every language stay broad', () => {
  test.each([
    ['en', 'coffee right now'], ['es', 'un café ahora'], ['de', 'Kaffee jetzt'], ['fr', 'un café maintenant'], ['pt', 'um café agora'],
    ['ht', 'yon kafe kounye a'], ['zh', '现在喝咖啡'], ['vi', 'cà phê bây giờ'], ['tl', 'kape ngayon'], ['ru', 'кофе сейчас'], ['ko', '지금 커피'],
    // look-alikes that are not an indoor/outdoor ask
    ['es', 'no sé, algo divertido'], ['de', 'nur Kaffee'], ['fr', 'pas cher'], ['ru', 'не знаю'], ['ko', '안녕 커피'],
  ])('%s: %s', (_l, text) => {
    const f = parseAskFacets(text);
    expect(f.environment).toBeNull();
    expect(f.exclude).not.toContain('outdoor');
    expect(f.exclude).not.toContain('indoor');
  });
});

