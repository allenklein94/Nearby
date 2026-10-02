// Indoor / outdoor in a typed ask, in the app's other 10 languages (2026-10-02, owner: typed indoor/outdoor works in all 11).
// English keeps its own rules in askFacets.js (unchanged); this file adds the same five ideas for es, de, fr, pt, ht, zh, vi, tl,
// ru, ko, read by the ONE parser (askFacets.parseAskFacets), so every typed-ask path (Home, Discover, Surprise Me, restrictions,
// weather, capabilities) gets them at once:
//   outdoor / indoor : the side the person asks for
//   negation         : "nothing outdoors" (a negator then up to 3 words, or for zh/ko the negator around the word)
//   tentative / firm : how sure they sound (item 105: tentative = a preference that only ranks; firm or plain = a must)
//   seating          : sitting outside AT a place (a terrace) = the outdoor_seating attribute, never an environment must
// Deterministic word lists, never AI. Written by hand from common usage, not reviewed by native speakers. Matching is
// case-insensitive; space-separated languages use Unicode letter boundaries, Chinese and Korean match inside the text
// (no spaces; Korean particles attach: 야외에서).
const LANGS = {
  es: {
    outdoor: ['al aire libre', 'afuera', 'en el exterior', 'en exteriores'],
    indoor: ['bajo techo', 'adentro', 'en interiores', 'en el interior', 'techado', 'a cubierto'],
    neg: ['no', 'nada', 'sin', 'evitar', 'ni'],
    tentative: ['quizás', 'quizas', 'tal vez', 'a lo mejor', 'puede que', 'preferiblemente', 'de preferencia', 'idealmente', 'si se puede'],
    firm: ['tiene que', 'tienen que', 'sí o sí', 'si o si', 'definitivamente', 'solamente', 'únicamente', 'obligatoriamente', 'sin falta', 'debe'],
    seating: ['terraza', 'sentarnos afuera', 'sentarse afuera', 'mesas afuera'],
  },
  de: {
    outdoor: ['draußen', 'draussen', 'im freien', 'unter freiem himmel'],
    indoor: ['drinnen', 'im innenbereich', 'überdacht', 'ueberdacht'],
    neg: ['nicht', 'nichts', 'kein', 'keine', 'keinen', 'ohne'],
    tentative: ['vielleicht', 'eventuell', 'lieber', 'am liebsten', 'möglichst', 'idealerweise'],
    firm: ['unbedingt', 'muss', 'müssen', 'nur', 'auf jeden fall', 'definitiv'],
    seating: ['terrasse', 'draußen sitzen', 'draussen sitzen', 'biergarten'],
  },
  fr: {
    outdoor: ['dehors', 'en plein air', "à l'extérieur", "a l'exterieur", 'à l’extérieur', 'en extérieur', 'en exterieur'],
    indoor: ["à l'intérieur", "a l'interieur", 'à l’intérieur', 'en intérieur', 'en interieur'],
    neg: ['pas', 'rien', 'sans', 'éviter', 'jamais'],
    tentative: ['peut-être', 'peut être', 'peut-etre', 'éventuellement', 'de préférence', 'idéalement', 'si possible'],
    firm: ['absolument', 'obligatoirement', 'il faut', 'doit', 'seulement', 'uniquement', 'forcément'],
    seating: ['en terrasse', 'terrasse', "s'asseoir dehors"],
  },
  pt: {
    outdoor: ['ao ar livre', 'lá fora', 'la fora'],
    indoor: ['lá dentro', 'la dentro', 'ambiente fechado', 'local fechado', 'lugar fechado', 'coberto'],
    neg: ['não', 'nao', 'nada', 'sem', 'evitar'],
    tentative: ['talvez', 'quem sabe', 'de preferência', 'de preferencia', 'idealmente', 'se possível', 'se der'],
    firm: ['tem que', 'tem de', 'precisa', 'com certeza', 'somente', 'apenas', 'obrigatoriamente'],
    seating: ['esplanada', 'varanda', 'sentar lá fora', 'mesas lá fora'],
  },
  ht: {
    outdoor: ['deyò', 'deyo', 'an plen lè', 'an plen le'],
    indoor: ['anndan', 'andedan'],
    neg: ['pa', 'okenn', 'san'],
    tentative: ['petèt', 'petet', 'pito', 'si sa posib'],
    firm: ['fòk', 'fok', 'sèlman', 'selman', 'dwe', 'absoliman'],
    seating: ['teras'],
  },
  vi: {
    outdoor: ['ngoài trời', 'ngoai troi'],
    indoor: ['trong nhà', 'trong nha'],
    neg: ['không', 'khong', 'chẳng', 'đừng', 'tránh'],
    tentative: ['có lẽ', 'có thể', 'nếu được', 'tốt nhất là'],
    firm: ['nhất định', 'phải', 'chỉ', 'chắc chắn'],
    seating: ['bàn ngoài trời', 'ngồi ngoài trời', 'sân thượng'],
  },
  tl: {
    outdoor: ['sa labas'],
    indoor: ['sa loob'],
    neg: ['hindi', 'ayoko', 'ayaw', 'huwag', 'walang'],
    tentative: ['siguro', 'baka', 'kung pwede', 'kung puwede', 'mas maganda kung'],
    firm: ['dapat', 'talagang', 'lamang'],
    seating: ['umupo sa labas'],
  },
  ru: {
    outdoor: ['на улице', 'на свежем воздухе', 'на открытом воздухе', 'снаружи', 'на природе'],
    indoor: ['в помещении', 'в закрытом помещении', 'внутри', 'под крышей'],
    neg: ['не', 'ни', 'без'],
    tentative: ['может быть', 'возможно', 'наверное', 'лучше', 'желательно', 'если можно', 'по возможности'],
    firm: ['обязательно', 'только', 'должно', 'непременно', 'точно'],
    seating: ['на веранде', 'веранда', 'летняя терраса', 'терраса'],
  },
};
// Chinese and Korean: no word spaces, so the words match inside the text and negation is a short window around them.
const ZH = {
  outdoor: ['户外', '戶外', '室外', '露天'],
  indoor: ['室内', '室內', '屋里', '屋裡', '屋内'],
  negBefore: ['不要', '不想', '别', '別', '不在', '不去', '避免', '不是', '除了'],
  tentative: ['也许', '也許', '或许', '或許', '可能', '最好', '如果可以', '尽量', '儘量'],
  firm: ['一定', '必须', '必須', '非要', '只想'],
  seating: ['露天座位', '户外座位', '戶外座位', '露台'],
};
const KO = {
  outdoor: ['야외', '실외', '바깥', '밖에서'],
  indoor: ['실내', '안에서'],
  negAfter: ['말고', '싫', '빼고', '제외', '아닌', '아니', '안 돼', '안돼', '않'],
  tentative: ['아마', '혹시', '가능하면', '되도록', '웬만하면', '좋겠'],
  firm: ['꼭', '반드시', '무조건'],
  seating: ['테라스', '야외 좌석', '야외석'],
};

export const ENVIRONMENT_WORD_LANGUAGES = ['en', ...Object.keys(LANGS), 'zh', 'ko'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
const alt = (list) => list.map(esc).sort((a, b) => b.length - a.length).join('|');
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const all = (key) => Object.values(LANGS).flatMap((l) => l[key]);

const bounded = (list) => `${B}(?:${alt(list)})${E}`;
const negBounded = (side) => Object.values(LANGS)
  .map((l) => `${B}(?:${alt(l.neg)})\\s+(?:[\\p{L}'’-]+\\s+){0,3}(?:${alt(l[side])})${E}`).join('|');
const window4 = "[^,.;!?。，！？\\n]{0,4}";

// global + unicode + case-insensitive (the parser removes every match after testing, like the English rules)
const re = (src) => new RegExp(src, 'giu');

export const I18N_POS_OUTDOOR = re(`${bounded(all('outdoor'))}|${alt([...ZH.outdoor, ...KO.outdoor])}`);
export const I18N_POS_INDOOR = re(`${bounded(all('indoor'))}|${alt([...ZH.indoor, ...KO.indoor])}`);
export const I18N_NEG_OUTDOOR = re([negBounded('outdoor'),
  `(?:${alt(ZH.negBefore)})${window4}(?:${alt(ZH.outdoor)})`,
  `(?:${alt(KO.outdoor)})${window4}(?:${alt(KO.negAfter)})`].join('|'));
export const I18N_NEG_INDOOR = re([negBounded('indoor'),
  `(?:${alt(ZH.negBefore)})${window4}(?:${alt(ZH.indoor)})`,
  `(?:${alt(KO.indoor)})${window4}(?:${alt(KO.negAfter)})`].join('|'));
export const I18N_TENTATIVE = re(`${bounded(all('tentative'))}|${alt([...ZH.tentative, ...KO.tentative])}`);
export const I18N_FIRM = re(`${bounded(all('firm'))}|${alt([...ZH.firm, ...KO.firm])}`);
export const I18N_SEATING = re(`${bounded(all('seating'))}|${alt([...ZH.seating, ...KO.seating])}`);

// A stateless test for a global regex (a /g regex's .test() moves lastIndex).
export const hits = (regex, text) => { regex.lastIndex = 0; const ok = regex.test(text); regex.lastIndex = 0; return ok; };

// Sentence split that also knows CJK punctuation.
export const SENTENCE_SPLIT = /[.;!?\n。！？；]+/;
