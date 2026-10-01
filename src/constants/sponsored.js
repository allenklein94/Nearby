// Sponsored placement (item 44, design: PRODUCT_AUDIT/SPONSORED_PLACEMENT_DESIGN_2026-09-20.md). The label lives HERE
// and in SponsoredCard as a constant, never in data, so a served paid placement cannot render without it.
export const SPONSORED_LABEL = 'Sponsored';

// The label in each app language, kept here as a constant for the same reason (never data, never a missing key):
// an unknown language falls back to English, so a paid placement always carries a disclosure. Machine-authored; the
// wording follows each language's usual ad disclosure (Russian and Korean apps say "advertising").
const SPONSORED_LABELS = {
  en: 'Sponsored', es: 'Patrocinado', de: 'Gesponsert', fr: 'Sponsorisé', pt: 'Patrocinado', ht: 'Sponsorize',
  zh: '赞助', vi: 'Được tài trợ', tl: 'Inisponsor', ru: 'Реклама', ko: '광고',
};
export function sponsoredLabel(language) {
  return SPONSORED_LABELS[language] || SPONSORED_LABEL;
}

// The paid-placement disclosure, one whole sentence per language (with and without a category), same rules as the label:
// fixed here, English fallback. Every version must say it was PAID and is NOT based on the person's activity (guarded).
// {name} = the business's own name (as stored), {category} = the category name already shown in the viewer's language.
const SPONSORED_WHY = {
  en: { cat: '{name} paid to be shown to people browsing {category} near them. It isn\'t based on your activity.', any: '{name} paid to be shown to people browsing nearby. It isn\'t based on your activity.', someone: 'This business' },
  es: { cat: '{name} pagó para aparecer ante personas que buscan {category} cerca. No se basa en tu actividad.', any: '{name} pagó para aparecer ante personas que buscan cerca. No se basa en tu actividad.', someone: 'Este negocio' },
  de: { cat: '{name} hat dafür bezahlt, Leuten angezeigt zu werden, die in der Nähe nach {category} suchen. Es basiert nicht auf deiner Aktivität.', any: '{name} hat dafür bezahlt, Leuten in der Nähe angezeigt zu werden. Es basiert nicht auf deiner Aktivität.', someone: 'Dieses Geschäft' },
  fr: { cat: '{name} a payé pour être montré aux personnes qui parcourent {category} près de chez elles. Ce n\'est pas basé sur votre activité.', any: '{name} a payé pour être montré aux personnes qui parcourent les lieux à proximité. Ce n\'est pas basé sur votre activité.', someone: 'Ce commerce' },
  pt: { cat: '{name} pagou para aparecer para pessoas que procuram {category} por perto. Não é baseado na sua atividade.', any: '{name} pagou para aparecer para pessoas que procuram lugares por perto. Não é baseado na sua atividade.', someone: 'Este estabelecimento' },
  ht: { cat: '{name} peye pou moun k ap chèche {category} toupre yo wè l. Sa pa baze sou aktivite w.', any: '{name} peye pou moun k ap chèche toupre yo wè l. Sa pa baze sou aktivite w.', someone: 'Biznis sa a' },
  zh: { cat: '{name} 付费向在附近浏览{category}的人展示。这与你的活动无关。', any: '{name} 付费向在附近浏览的人展示。这与你的活动无关。', someone: '这家商家' },
  vi: { cat: '{name} đã trả tiền để được hiển thị cho những người đang xem {category} gần họ. Nội dung này không dựa trên hoạt động của bạn.', any: '{name} đã trả tiền để được hiển thị cho những người đang xem quanh đây. Nội dung này không dựa trên hoạt động của bạn.', someone: 'Doanh nghiệp này' },
  tl: { cat: 'Nagbayad ang {name} para maipakita sa mga taong naghahanap ng {category} malapit sa kanila. Hindi ito batay sa aktibidad mo.', any: 'Nagbayad ang {name} para maipakita sa mga taong nagba-browse sa malapit. Hindi ito batay sa aktibidad mo.', someone: 'negosyong ito' },
  ru: { cat: '{name}: оплаченный показ для людей, которые смотрят категорию «{category}» поблизости. Это не основано на вашей активности.', any: '{name}: оплаченный показ для людей, которые смотрят места поблизости. Это не основано на вашей активности.', someone: 'Это заведение' },
  ko: { cat: '{name} 측에서 근처의 {category} 장소를 둘러보는 사람들에게 표시되도록 비용을 지불했어요. 내 활동을 기반으로 한 것이 아니에요.', any: '{name} 측에서 근처를 둘러보는 사람들에게 표시되도록 비용을 지불했어요. 내 활동을 기반으로 한 것이 아니에요.', someone: '이 업체' },
};
export const SPONSORED_WHY_LANGUAGES = Object.keys(SPONSORED_WHY);
export function sponsoredWhyText(businessName, categoryLabel, language = 'en') {
  const lines = SPONSORED_WHY[language] || SPONSORED_WHY.en;
  const name = businessName || lines.someone;
  return (categoryLabel ? lines.cat : lines.any).replace('{name}', name).replace('{category}', categoryLabel || '');
}

// Organic-response language a paid placement must never use (guarded in sponsoredPlacementGuard.test.js).
export const ORGANIC_ONLY_PHRASES = [
  'made you an offer',
  'Our pick',
  'Why this matches',
  'Because you like',
  'Trending',
  'Nearby found',
  'is going',
  'are going',
];
