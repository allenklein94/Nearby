// One ordinary sentence in each of the 11 app languages (LanguageContext SUPPORTED_LANGUAGES), with the diacritics,
// scripts and punctuation each really uses. Used by journey ugcModeration (byte-exact binding + the app's trim rule in
// every language) and as the benign half of the calibration set (scripts/trust-safety/ugc-calibration.js).
const MULTILINGUAL_SAMPLES = [
  ['en', 'Anyone up for pickleball at the park on Saturday?'],
  ['es', '¿Alguien quiere jugar pickleball en el parque el sábado?'],
  ['de', 'Hat jemand Lust, am Samstag im Park Pickleball zu spielen?'],
  ['fr', 'Quelqu’un veut jouer au pickleball au parc samedi ?'],
  ['pt', 'Alguém topa jogar pickleball no parque no sábado?'],
  ['ht', 'Kiyès ki vle jwe pickleball nan pak la samdi?'],
  ['zh', '周六有人想去公园打匹克球吗？'],
  ['vi', 'Có ai muốn chơi pickleball ở công viên vào thứ Bảy không?'],
  ['tl', 'May gustong maglaro ng pickleball sa parke sa Sabado?'],
  ['ru', 'Кто-нибудь хочет сыграть в пиклбол в парке в субботу?'],
  ['ko', '토요일에 공원에서 피클볼 치실 분 있나요?'],
];
module.exports = { MULTILINGUAL_SAMPLES };
