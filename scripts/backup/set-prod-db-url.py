#!/usr/bin/env python3
"""Store production's Session pooler URI for the backup script, without it ever being shown, logged or committed.

Run it YOURSELF in a terminal (not through Claude):  python3 scripts/backup/set-prod-db-url.py
- input is hidden (getpass): nothing is echoed and nothing reaches shell history;
- the file is created with mode 0600 from its first byte (this workspace's default ACLs make a normal create 666);
- it refuses to overwrite an existing file (delete it first to replace it);
- it prints only pass/fail checks, never the URI or the password. `.claude/` is gitignored.
"""
import getpass, os, re, subprocess, sys
from urllib.parse import urlsplit

PATH = '/workspaces/Nearby/.claude/prod-db-url'
REF = 'enmosvippabmuqslzrox'

uri = getpass.getpass('Paste the Session pooler URI (hidden): ').strip()
u = urlsplit(uri)
checks = {
    'scheme is postgresql://': u.scheme in ('postgresql', 'postgres'),
    'user is postgres.<this project>': (u.username or '') == f'postgres.{REF}',
    'host is a Supabase pooler': bool(re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', u.hostname or '')),
    'port 5432 (Session mode, not 6543 Transaction)': u.port == 5432,
    'password present, no [YOUR-PASSWORD] placeholder': bool(u.password) and 'YOUR-PASSWORD' not in uri.upper(),
}
for k, ok in checks.items():
    print(('ok   ' if ok else 'FAIL ') + k)
if not all(checks.values()):
    sys.exit('Nothing written.')
os.makedirs(os.path.dirname(PATH), exist_ok=True)
try:
    fd = os.open(PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    sys.exit(f'{PATH} already exists: delete it first if you want to replace it. Nothing written.')
with os.fdopen(fd, 'w') as f:
    f.write(uri + '\n')
del uri
mode = oct(os.stat(PATH).st_mode & 0o777)
ignored = subprocess.run(['git', '-C', '/workspaces/Nearby', 'check-ignore', '-q', PATH]).returncode == 0
print(f'written: mode {mode} (want 0o600), gitignored: {ignored}')
sys.exit(0 if mode == '0o600' and ignored else 1)
