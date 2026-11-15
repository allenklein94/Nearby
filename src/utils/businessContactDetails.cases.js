// Shared cases for the business phone + website rules: run by utils/businessContactDetails.test.js (client) and by journey
// businessContactDetails (server functions private.normalize_business_phone / normalize_business_website). null = refused.
const CONTACT_CASES = {
  phone: [
    ['(561) 555-0100', '5615550100'],
    ['+1 561.555.0100', '+15615550100'],
    ['  +44 20 7946 0958 ', '+442079460958'],
    ['555-0100', '5550100'],
    ['123456', null], // 6 digits
    ['1234567890123456', null], // 16 digits
    ['561-555-0100 ext 2', null],
    ['call me', null],
    ['++15615550100', null],
    ['', null],
    [null, null],
  ],
  website: [
    ['coastalcoffee.com', 'https://coastalcoffee.com'],
    ['  CoastalCoffee.COM/Menu ', 'https://coastalcoffee.com/Menu'],
    ['HTTP://www.Example.com/a?b=C', 'http://www.example.com/a?b=C'],
    ['https://sub.example.co.uk', 'https://sub.example.co.uk'],
    ['ftp://example.com', null],
    ['javascript:alert(1)', null],
    ['https://user:pw@example.com', null],
    ['not a site', null],
    ['localhost', null],
    ['https://-bad.com', null],
    ['https://bad..com', null],
    [`example.com/${'a'.repeat(200)}`, null],
    ['', null],
    [null, null],
  ],
};

module.exports = { CONTACT_CASES };
