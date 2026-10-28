// Trust & safety N6 (owner, 2026-10-28): the profiles columns any signed-in person may read on a visible profile (the
// column grant in migration 20270348). Every other profiles column is private: the person's own come from readMyProfile
// (services/myProfile.js), other people's profile details only through people_visible_to_me / the Dating view.
export const PUBLIC_PROFILE_COLUMNS = [
  'id', 'display_name', 'bio', 'photo_url', 'photo_verified', 'is_premium', 'created_at', 'interests', 'pronouns',
  'profile_hidden', 'basics', 'prompts', 'relationship_intention', 'read_receipts_enabled', 'women_message_first',
  'favorite_tracks', 'voice_intro_path', 'connection_goal', 'open_to_friend_discovery',
];
