import { supabase } from './supabase';
import { classifyBusinessCategory } from '../constants/businessCategoryClassifier';

// "Can't find your category?" -- a suggestion for a business that described itself in its own words. Order:
// (1) phrases an admin already mapped (category_aliases, the expansion loop), then (2) the deterministic keyword
// classifier. Rule-based, never AI, and only ever a SUGGESTION the applicant taps to accept.
export async function suggestBusinessCategory(text) {
  const clean = (text ?? '').trim();
  if (clean.length < 3) return null;
  try {
    const { data } = await supabase.rpc('suggest_category_from_aliases', { text_param: clean });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.category) return { category: row.category, subcategory: row.subcategory ?? null, source: 'remembered' };
  } catch (e) {
    // fall through to the keyword classifier
  }
  const guess = classifyBusinessCategory({ description: clean });
  return guess?.category ? { category: guess.category, subcategory: null, source: 'keywords' } : null;
}
