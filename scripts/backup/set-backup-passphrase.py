#!/usr/bin/env python3
"""Owner types the backup encryption passphrase (hidden, twice). Stored only in a 0600 file outside the repo so
encrypt-backup.sh can use it; delete it once the passphrase is in your password manager and the download is confirmed.
Never paste the passphrase into chat.

    python3 /workspaces/.nearby-verify/wt-catchup/scripts/backup/set-backup-passphrase.py
"""
import getpass, os, sys

PATH = '/workspaces/.nearby-verify/backups/.passphrase'
p1 = getpass.getpass('Backup passphrase (hidden, at least 16 characters): ')
p2 = getpass.getpass('Type it again: ')
if p1 != p2:
    sys.exit('The two entries differ. Nothing saved; run it again.')
if len(p1) < 16:
    sys.exit('Use at least 16 characters (a few random words works well). Nothing saved.')
os.makedirs(os.path.dirname(PATH), mode=0o700, exist_ok=True)
fd = os.open(PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(p1)
os.chmod(PATH, 0o600)
print('Saved (mode 600). Put the same passphrase in your password manager now: without it the backup cannot be opened.')
