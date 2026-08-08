// Curated cover photos: category -> a real, verified image, used as the
// hero fallback wherever a host hasn't uploaded a real cover_photo_path.
// Not AI-generated (locked decision #2 in the Create 2.0 plan) -- static
// stock imagery, one per category. Every URL here was checked with a real
// HTTP request (200 + image/* content-type) and visually inspected before
// being hardcoded, not guessed -- two initial candidates (for Dancing) were
// dropped after visual inspection turned out to be a mountain-silhouette
// yoga pose and a neon sign, not dancing. Categories not listed here
// deliberately have no verified image sourced this pass -- they fall back
// to the existing icon/color block, never a broken or mismatched photo.
export const CATEGORY_COVER_PHOTOS = {
  Coffee: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80',
  Foodie: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80',
  Outdoors: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80',
  Sports: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80',
  Gaming: 'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=1200&q=80',
  Music: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&q=80',
  Volunteering: 'https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?w=1200&q=80',
  Movies: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200&q=80',
  Hiking: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=1200&q=80',
  Yoga: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1200&q=80',
  Wine: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1200&q=80',
  Dancing: 'https://images.unsplash.com/photo-1535525153412-5a42439a210d?w=1200&q=80',
  Fitness: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1200&q=80',
  Travel: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200&q=80',
  Reading: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=1200&q=80',
};

export function curatedCoverPhotoFor(interestTag) {
  return CATEGORY_COVER_PHOTOS[interestTag] ?? null;
}
