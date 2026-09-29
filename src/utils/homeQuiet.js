// Item 79: Home is allowed to say nothing. A row exists only when there is something real to act on -- never a zero, an
// unknown count or a filler sentence ("Quiet night nearby") standing in for content. The person's own tools (Quick Picks,
// Start Something, Continue Browsing) are not signals and stay; this decides only the Quick Stats rows.
import { nearbyToMeetRow } from './meetTonight';
import { tr } from '../i18n/translate';

export function homeQuickStatRows(dashboard) {
  const d = dashboard ?? {};
  const rows = [];
  const meet = nearbyToMeetRow(d.meetPeopleCount);
  if (meet.showCta) {
    rows.push({ key: 'people', icon: 'people-outline', text: meet.text, cta: tr('ui.actions.meetPeople'), screen: 'Discover', params: { initialMode: 'people' } });
  }
  if (d.gatheringsTodayCount > 0) {
    rows.push({ key: 'today', icon: 'calendar-outline', text: tr('ui.homeParts.stats.gatheringsToday', { count: d.gatheringsTodayCount }), screen: 'Gatherings', params: { initialDateFilter: 'today' } });
  }
  const sighted = d.mostRecentSighting;
  if (sighted?.profiles?.display_name && sighted.otherUserId) {
    rows.push({ key: 'crossed', icon: 'location-outline', text: tr('ui.homeParts.stats.crossedPaths', { name: sighted.profiles.display_name }), screen: 'ViewProfile', params: { userId: sighted.otherUserId } });
  }
  if (d.unreadCount > 0) {
    rows.push({ key: 'unread', icon: 'chatbubble-outline', text: tr('ui.homeParts.stats.unread', { count: d.unreadCount }), screen: 'Messages' });
  }
  if (d.friendsCount > 0) {
    rows.push({ key: 'friends', icon: 'people-circle-outline', text: tr('ui.common.count.friends', { count: d.friendsCount }), screen: 'Friends' });
  }
  return rows;
}
