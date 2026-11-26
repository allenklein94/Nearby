// Calibration set + pass rule for user-content screening (migration 20270373). A language counts as screened (a "low"
// result publishes at once) only after a run on the REAL classifier passes for it here; until then every result in that
// language is held for a person. The runner is scripts/trust-safety/ugc-calibration.js; the rule below is pure so it is
// tested offline. Numbers are PROPOSED (owner approves them with the activation migration; nothing is calibrated today).
//
// Per language: 3 benign texts (an ordinary sentence, mild slang not aimed at anyone, light dating-profile flirting: all
// must stay publishable) and 3 harmful ones (spam/scam, a threat, someone else's private details). Names ('names') and
// no-language text ('und') have their own short sets. The translations are machine-authored (native review pending);
// phone numbers are reserved fiction (555-01xx), addresses and people invented.
const { MULTILINGUAL_SAMPLES } = require('./ugcMultilingualSamples');

const SAMPLE = Object.fromEntries(MULTILINGUAL_SAMPLES);

// [language, slang (benign), flirt (benign), spam_scam, violence_threats, personal_information]
const ROWS = [
  ['en',
    'This week has been so damn long, I need tacos and a beach walk.',
    'Looking for someone who laughs at my bad jokes and likes sunsets 😉',
    'Make $5,000 a week from home with crypto! Message me on WhatsApp +1 561 555 0147 to start today.',
    "I know where you live and I'm going to hurt you if you show up Saturday.",
    'Maria Lopez lives at 412 Palm Way, apartment 3B, her number is 561-555-0182, go pay her a visit.'],
  ['es',
    'Esta semana ha sido larguísima, joder, necesito tacos y un paseo por la playa.',
    'Busco a alguien que se ría de mis chistes malos y le gusten los atardeceres 😉',
    '¡Gana $5,000 a la semana desde casa con cripto! Escríbeme por WhatsApp al +1 561 555 0147 y empieza hoy.',
    'Sé dónde vives y te voy a hacer daño si apareces el sábado.',
    'María López vive en 412 Palm Way, apartamento 3B, su número es 561-555-0182, vayan a visitarla.'],
  ['de',
    'Diese Woche war verdammt lang, ich brauche Tacos und einen Strandspaziergang.',
    'Suche jemanden, der über meine schlechten Witze lacht und Sonnenuntergänge mag 😉',
    'Verdiene 5.000 $ pro Woche von zu Hause mit Krypto! Schreib mir auf WhatsApp +1 561 555 0147 und starte heute.',
    'Ich weiß, wo du wohnst, und ich werde dir wehtun, wenn du am Samstag auftauchst.',
    'Maria Lopez wohnt in 412 Palm Way, Wohnung 3B, ihre Nummer ist 561-555-0182, besucht sie mal.'],
  ['fr',
    'Cette semaine a été sacrément longue, j’ai besoin de tacos et d’une balade sur la plage.',
    'Je cherche quelqu’un qui rit à mes blagues nulles et qui aime les couchers de soleil 😉',
    'Gagnez 5 000 $ par semaine depuis chez vous avec la crypto ! Écrivez-moi sur WhatsApp au +1 561 555 0147 pour commencer.',
    'Je sais où tu habites et je vais te faire du mal si tu viens samedi.',
    'Maria Lopez habite au 412 Palm Way, appartement 3B, son numéro est le 561-555-0182, allez lui rendre visite.'],
  ['pt',
    'Essa semana foi longa pra caramba, preciso de tacos e de uma caminhada na praia.',
    'Procuro alguém que ria das minhas piadas ruins e goste de pôr do sol 😉',
    'Ganhe US$ 5.000 por semana em casa com cripto! Me chama no WhatsApp +1 561 555 0147 e comece hoje.',
    'Eu sei onde você mora e vou te machucar se você aparecer no sábado.',
    'Maria Lopez mora na 412 Palm Way, apartamento 3B, o número dela é 561-555-0182, vão fazer uma visita a ela.'],
  ['ht',
    'Semèn sa a te long anpil, monchè, mwen bezwen tako ak yon ti mache sou plaj la.',
    'M ap chèche yon moun ki ri pou blag mwen yo e ki renmen kouche solèy 😉',
    'Fè $5,000 chak semèn lakay ou ak kripto! Ekri m sou WhatsApp +1 561 555 0147 pou kòmanse jodi a.',
    'Mwen konnen kote w rete e m ap fè w mal si w parèt samdi.',
    'Maria Lopez rete 412 Palm Way, apatman 3B, nimewo li se 561-555-0182, ale vizite l.'],
  ['zh',
    '这周真是长得要命，我需要吃点塔可再去海边走走。',
    '想找一个会被我的冷笑话逗笑、也喜欢看日落的人 😉',
    '在家用加密货币每周赚5000美元！加我WhatsApp +1 561 555 0147，今天就开始。',
    '我知道你住在哪里，你周六要是敢来，我就让你好看，我会伤害你。',
    'Maria Lopez 住在 412 Palm Way 3B 公寓，她的电话是 561-555-0182，大家去找她吧。'],
  ['vi',
    'Tuần này dài kinh khủng, tôi cần ăn taco và đi dạo biển.',
    'Tìm người cười với mấy câu đùa dở của tôi và thích ngắm hoàng hôn 😉',
    'Kiếm 5.000 đô mỗi tuần tại nhà với tiền điện tử! Nhắn tôi qua WhatsApp +1 561 555 0147 để bắt đầu hôm nay.',
    'Tao biết mày sống ở đâu và tao sẽ làm mày bị thương nếu mày đến vào thứ Bảy.',
    'Maria Lopez sống ở 412 Palm Way, căn hộ 3B, số điện thoại của cô ấy là 561-555-0182, mọi người đến thăm cô ấy đi.'],
  ['tl',
    'Grabe ang haba ng linggong ito, kailangan ko ng tacos at lakad sa beach.',
    'Naghahanap ng taong tatawa sa mga corny kong biro at mahilig sa paglubog ng araw 😉',
    'Kumita ng $5,000 kada linggo sa bahay gamit ang crypto! I-message ako sa WhatsApp +1 561 555 0147 para magsimula ngayon.',
    'Alam ko kung saan ka nakatira at sasaktan kita kapag nagpakita ka sa Sabado.',
    'Si Maria Lopez ay nakatira sa 412 Palm Way, apartment 3B, ang numero niya ay 561-555-0182, puntahan ninyo siya.'],
  ['ru',
    'Эта неделя была чертовски длинной, мне нужны тако и прогулка по пляжу.',
    'Ищу того, кто смеётся над моими глупыми шутками и любит закаты 😉',
    'Зарабатывай $5000 в неделю из дома на криптовалюте! Пиши мне в WhatsApp +1 561 555 0147 и начни сегодня.',
    'Я знаю, где ты живёшь, и сделаю тебе больно, если ты появишься в субботу.',
    'Мария Лопес живёт по адресу 412 Palm Way, квартира 3B, её номер 561-555-0182, сходите к ней в гости.'],
  ['ko',
    '이번 주 진짜 너무 길었어, 타코 먹고 해변 산책 좀 해야겠어.',
    '제 썰렁한 농담에 웃어주고 노을 좋아하는 분 찾아요 😉',
    '집에서 암호화폐로 일주일에 5,000달러 벌기! WhatsApp +1 561 555 0147로 연락 주시면 오늘 바로 시작합니다.',
    '네가 어디 사는지 알아. 토요일에 나타나면 다치게 해 줄 거야.',
    'Maria Lopez는 412 Palm Way 3B호에 살고, 전화번호는 561-555-0182야. 다들 찾아가 봐.'],
];

const CALIBRATION_SET = [];
for (const [language, slang, flirt, spam, threat, personal] of ROWS) {
  CALIBRATION_SET.push(
    { language, kind: 'bio', expect: 'benign', label: 'ordinary', text: SAMPLE[language] },
    { language, kind: 'bio', expect: 'benign', label: 'slang', text: slang },
    { language, kind: 'bio', expect: 'benign', label: 'flirt', text: flirt },
    { language, kind: 'bio', expect: 'harmful', label: 'spam_scam', text: spam },
    { language, kind: 'gathering_description', expect: 'harmful', label: 'violence_threats', text: threat },
    { language, kind: 'comment', expect: 'harmful', label: 'personal_information', text: personal },
  );
}
// Names: judged language-neutral by the database ('names'), so one set in several scripts.
for (const [label, text] of [['latin', 'Ana Sofía'], ['hangul', '김지민'], ['cyrillic', 'Дмитрий'], ['han', '王小明'],
  ['creole', 'Jean-Wesly Pierre-Louis'], ['community', 'Palm Beach Pickleball Crew']]) {
  CALIBRATION_SET.push({ language: 'names', kind: label === 'community' ? 'community_name' : 'name', expect: 'benign', label, text });
}
for (const [label, text] of [['impersonation', 'Nearby Official Support Team'], ['spam_scam', 'Crypto Profits DM 561-555-0147'],
  ['impersonation_brand', 'Apple Customer Service Verified']]) {
  CALIBRATION_SET.push({ language: 'names', kind: 'name', expect: 'harmful', label, text });
}
// No language (emoji, numbers): what the classifier reports as 'und'.
for (const [label, text] of [['emoji', '🏓🌴☀️'], ['score', '10/10 🙌 🎉']]) {
  CALIBRATION_SET.push({ language: 'und', kind: 'comment', expect: 'benign', label, text });
}
CALIBRATION_SET.push({ language: 'und', kind: 'comment', expect: 'harmful', label: 'spam_scam', text: '💰💰💰 📲 +1 561 555 0147 💸 $$$ 💸' });

const CALIBRATION_LANGUAGES = Array.from(new Set(CALIBRATION_SET.map((s) => s.language)));

// PROPOSED pass rule (owner approval needed):
//  - every call answered (a service failure = the language is not calibrated by this run);
//  - ZERO harmful runs scored "low" (a calibrated low publishes at once: a miss is the failure that matters);
//  - at least 80% of benign runs scored "low" (more holds only cost review time, but a language that holds most
//    ordinary text isn't really screened either);
//  - for a real language, the expected code among the reported languages in at least 90% of runs (otherwise the
//    database would look up the wrong calibration row).
const PASS_RULE = { maxHarmfulLow: 0, minBenignLowShare: 0.8, minLanguageMatchShare: 0.9, repeats: 3 };

function evaluateCalibration(runs, rule = PASS_RULE) {
  // runs: [{ language, expect, label, verdict: { riskTier, languages } | null }]
  const out = {};
  for (const language of CALIBRATION_LANGUAGES) {
    const mine = runs.filter((r) => r.language === language);
    const failed = mine.filter((r) => !r.verdict).length;
    const answered = mine.filter((r) => r.verdict);
    const harmful = answered.filter((r) => r.expect === 'harmful');
    const benign = answered.filter((r) => r.expect === 'benign');
    const harmfulLow = harmful.filter((r) => r.verdict.riskTier === 'low');
    const benignLow = benign.filter((r) => r.verdict.riskTier === 'low').length;
    const realLanguage = language !== 'names' && language !== 'und';
    const languageMatch = realLanguage
      ? answered.filter((r) => (r.verdict.languages || []).includes(language)).length : answered.length;
    const benignLowShare = benign.length ? benignLow / benign.length : 0;
    const languageMatchShare = answered.length ? languageMatch / answered.length : 0;
    const reasons = [];
    if (!mine.length) reasons.push('no runs');
    if (failed) reasons.push(`${failed} call(s) failed`);
    if (harmfulLow.length > rule.maxHarmfulLow) {
      reasons.push(`harmful scored low: ${Array.from(new Set(harmfulLow.map((r) => r.label))).join(', ')}`);
    }
    if (benignLowShare < rule.minBenignLowShare) reasons.push(`benign low ${benignLow}/${benign.length}`);
    if (realLanguage && languageMatchShare < rule.minLanguageMatchShare) {
      reasons.push(`language reported as ${language} in ${languageMatch}/${answered.length}`);
    }
    out[language] = {
      passed: reasons.length === 0, reasons, runs: mine.length, failed,
      harmfulLow: harmfulLow.length, harmfulHigh: harmful.filter((r) => r.verdict.riskTier === 'high').length,
      harmful: harmful.length, benignLow, benign: benign.length, languageMatch, answered: answered.length,
    };
  }
  return out;
}

// The activation migration a passing run PROPOSES (written to a file for the owner; never applied by the runner).
function activationSql(results, evidence) {
  const passed = Object.keys(results).filter((l) => results[l].passed).sort();
  if (!passed.length) return null;
  const quoted = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return [
    '-- PROPOSED by scripts/trust-safety/ugc-calibration.js; owner approval + deploy.js only. Languages not listed stay held for a person.',
    `update private.ugc_language_calibration set status = 'calibrated', calibrated_at = now(), evidence = ${quoted(evidence)}`,
    `  where language in (${passed.map(quoted).join(', ')}) and status = 'pending';`,
    '',
  ].join('\n');
}

module.exports = { CALIBRATION_SET, CALIBRATION_LANGUAGES, PASS_RULE, evaluateCalibration, activationSql };
