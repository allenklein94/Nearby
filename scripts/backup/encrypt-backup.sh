#!/bin/bash
# Encrypt one database backup + one Storage backup into a single file for the owner to download (owner, 2026-11-26).
#   bash scripts/backup/encrypt-backup.sh <prod-…dump> <storage-… dir>
# gpg symmetric AES256 with the passphrase the owner set (set-backup-passphrase.py). Then PROVES the file opens:
# decrypts to a scratch dir and compares every file's sha256 with the originals. Never deletes the originals.
set -euo pipefail
set +x
DUMP=$1; SDIR=$2
OUT=$(dirname "$DUMP"); PASS="$OUT/.passphrase"; TS=$(basename "$DUMP" .dump | sed 's/^prod-//')
umask 077
[ -f "$PASS" ] && [ "$(stat -c %a "$PASS")" = 600 ] || { echo "missing $PASS (run set-backup-passphrase.py first)"; exit 2; }
STAGE=$(mktemp -d "$OUT/.stage.XXXXXX"); CHK=$(mktemp -d "$OUT/.check.XXXXXX")
trap 'rm -rf "$STAGE" "$CHK"' EXIT
mkdir -p "$STAGE/nearby-backup-$TS"
cp -p "$DUMP" "$DUMP.sha256" "$STAGE/nearby-backup-$TS/"
for f in "$OUT"/cron-"$TS".sql "$OUT"/fp-source-"$TS".txt "$OUT"/schema-source-"$TS".sql; do [ -f "$f" ] && cp -p "$f" "$STAGE/nearby-backup-$TS/"; done
cp -rp "$SDIR" "$STAGE/nearby-backup-$TS/storage"
(cd "$STAGE" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$OUT/.inner.sha256"
ENC="$OUT/nearby-backup-$TS.tar.gpg"
tar -C "$STAGE" -cf - "nearby-backup-$TS" | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASS" \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 -o "$ENC"
chmod 600 "$ENC"; sha256sum "$ENC" | tee "$ENC.sha256"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS" -d "$ENC" | tar -C "$CHK" -xf -
(cd "$CHK" && find . -type f -print0 | sort -z | xargs -0 sha256sum) | diff -q - "$OUT/.inner.sha256" >/dev/null \
  || { echo "FAIL: decrypted contents differ"; exit 1; }
echo "PASS: $ENC decrypts and every file matches ($(wc -l < "$OUT/.inner.sha256") files, $(du -h "$ENC" | cut -f1))"
printf '{"ts":"%s","encrypted_at":"%s","file":"%s","sha256":"%s"}\n' "$TS" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$ENC")" \
  "$(sha256sum "$ENC" | cut -d' ' -f1)" > "$OUT/encrypted-$TS.json"; chmod 600 "$OUT/encrypted-$TS.json"  # read by the backup gate
rm -f "$OUT/.inner.sha256"
