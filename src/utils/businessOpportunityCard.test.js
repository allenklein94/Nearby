import { buildOpportunityCard } from './businessOpportunityCard';

describe('buildOpportunityCard', () => {
  it('builds the simple card from real fields', () => {
    const c = buildOpportunityCard(
      { category: 'Foodie', party_size: 6, date: '2026-09-25', time_window_start: '19:00:00', time_window_end: '20:00:00', budget_max: 80 },
      { occasionLabel: 'Anniversary', experienceLabel: 'Make it special', attributeLabels: ['Romantic'], cuisineLabel: 'Italian' }
    );
    expect(c.title).toBe('Anniversary · Foodie');
    expect(c.whenLine).toMatch(/^6 people · .+ · 7–8 PM$/);
    expect(c.feelLine).toBe('Make it special · Up to $80/person · $480 for the party · $$$');
    expect(c.lookingFor).toEqual(['Italian', 'Romantic']);
  });
  it('omits anything not actually set instead of inventing it', () => {
    const c = buildOpportunityCard({ category: 'Coffee', party_size: 1 }, {});
    expect(c.whenLine).toBe('1 person');
    expect(c.feelLine).toBe('');
    expect(c.lookingFor).toEqual([]);
  });
  it('labels add-ons and falls back to the safe summary', () => {
    expect(buildOpportunityCard({ category: 'Bakeries' }, { addonLabel: 'Dessert' }).title).toBe('Dessert add-on');
    expect(buildOpportunityCard({ summary: 'A request' }, {}).title).toBe('A request');
  });
});
