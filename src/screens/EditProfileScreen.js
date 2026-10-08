import React from 'react';
import ProfileScreen from './ProfileScreen';

// Item 35 (owner, 2026-10-08): editing your profile is a different task from looking at it, so it has its own screen. Same
// component as the Profile tab (one source for every field, load and save), rendered in its 'edit' mode: photos, prompts,
// voice intro, about you, details, basics, interests and dining preferences, then Save (which returns to where you came from).
export default function EditProfileScreen(props) {
  return <ProfileScreen {...props} mode="edit" />;
}
