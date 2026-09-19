import fs from 'fs';
import path from 'path';
import { findMatchingOccasionPackage } from '../utils/occasionPackageFormatting';

const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');

describe('one-tap smart offer pre-fill', () => {
  it('openOfferModal starts from the owner\'s own matching package, only', () => {
    const body = src.slice(src.indexOf('function openOfferModal('), src.indexOf('function applyOccasionPackageToOffer('));
    expect(body).toContain('findMatchingOccasionPackage');
    expect(body).toContain('applyOccasionPackageToOffer(pkg)');
    // Nearby never writes a price of its own here: the only price setter is the reset to ''.
    expect(body.match(/setOfferPriceInput\(([^)]*)\)/g)).toEqual(["setOfferPriceInput('')"]);
  });
  it('the package apply only copies the owner\'s own real fields', () => {
    const body = src.slice(src.indexOf('function applyOccasionPackageToOffer('), src.indexOf('function addOfferIncludedItem('));
    expect(body).toContain('pkg.price_per_person');
    expect(body).toContain('pkg.included_items');
  });
  it('only a package that fits the request (occasion + min guests, active) is used', () => {
    const pkgs = [
      { name: 'Birthday', occasion_type: 'birthday', min_guests: 6, active: true, price_per_person: 60 },
      { name: 'Paused', occasion_type: 'birthday', min_guests: 2, active: false },
    ];
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 6, packages: pkgs }).name).toBe('Birthday');
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 3, packages: pkgs })).toBeNull();
    expect(findMatchingOccasionPackage({ occasion: 'anniversary', partySize: 6, packages: pkgs })).toBeNull();
    expect(findMatchingOccasionPackage({ occasion: null, partySize: 6, packages: pkgs })).toBeNull();
  });
});
