// The Nearby businesses Discover shows (owner, 2026-10-25): ONE rule for the search results' business rows AND the map's
// business pins, so List and Map respect the same intent. A search keeps only businesses matching its words (name or type,
// utils/unifiedSearch.js); Open now keeps only confirmed-open ones; Outdoor / Indoor keeps only what the business declared
// (constants/environmentMatch.js). Gathering-only filters (time, category, price, Local, ...) never apply to businesses.
import { filterByEnvironment } from '../constants/environmentMatch';
import { matchBusinesses, searchTopic } from './unifiedSearch';
import { filterOpenNow, businessEntity } from './operatingStatus';

export function discoverBusinesses(businesses, { searchTerm = null, topic, openNowAt = null, environment = null } = {}) {
  const matched = searchTerm ? matchBusinesses(businesses, searchTerm, topic ?? searchTopic(searchTerm)) : (businesses ?? []);
  const open = openNowAt ? filterOpenNow(matched, businessEntity, openNowAt) : matched;
  return filterByEnvironment(open, 'business', environment);
}
