-- Trust & safety fix 4, part 1 (owner, 2026-10-27; audit B4): ID + selfie uploads are limited to what the app sends.
-- Before: the private id-verification bucket accepted any file type and size (only the own-folder rule applied).
-- Now: images only (the app uploads camera JPEGs; PNG/WebP/HEIC allowed for other cameras), at most 10 MB each.
-- Retention is NOT automated here: the deletion periods are a proposal awaiting the owner's approval
-- (PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md). Account deletion's removal of the person's whole folder is in the
-- delete-account edge function (not a database change). 0 files and 0 submissions in production on 2026-10-27.

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'id-verification';
