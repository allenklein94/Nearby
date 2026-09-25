const fs = require('fs');
const path = require('path');
const { NEARBY_ONTOLOGY, ONTOLOGY_KEYS, ontologyLayer } = require('./nearbyOntology');

const SRC = path.join(__dirname, '..');

describe('Nearby ontology (item 60)', () => {
  it('has the thirteen layers in the owner\'s order', () => {
    expect(ONTOLOGY_KEYS).toEqual([
      'category', 'subcategory', 'activity', 'tags', 'occasion', 'group', 'time',
      'location', 'budget', 'availability', 'social_signal', 'business_signal', 'action',
    ]);
  });

  it('every layer asks one question and names a real, existing client source', () => {
    for (const layer of NEARBY_ONTOLOGY) {
      expect(layer.question).toMatch(/\?$/);
      const file = path.join(SRC, layer.client.file);
      expect(fs.existsSync(file)).toBe(true);
      const text = fs.readFileSync(file, 'utf8');
      expect(text).toMatch(new RegExp(`export (const|function|async function) ${layer.client.export}\\b`));
    }
  });

  it('owns no data of its own (every layer points somewhere else)', () => {
    const text = fs.readFileSync(path.join(__dirname, 'nearbyOntology.js'), 'utf8');
    expect(text).not.toMatch(/^import /m);
  });

  it('keeps the locked privacy notes on the social layer', () => {
    expect(ontologyLayer('social_signal').note).toMatch(/friends only/);
    expect(ontologyLayer('social_signal').note).toMatch(/Interested is private/);
    expect(ontologyLayer('business_signal').db).toMatch(/floor 5/);
    expect(ontologyLayer('nope')).toBeNull();
  });
});
