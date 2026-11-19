#!/usr/bin/env python3
"""Owner-only files for staging test sessions (2026-11-19).

/workspaces carries default ACLs, so on this codespace a file created the ordinary way comes out rw-rw-rw- and a directory
rwxrwxrwx WHATEVER the umask (umask 077 is ignored; checked 2026-11-19). Old session files were readable by other users
that way. Every file that holds a session, token, password or code is therefore created ONLY through this module:
  * private_dir(path)  -> mkdir with mode 0700 (refuses an existing directory that isn't owner-only)
  * write_private(path, data) -> O_CREAT|O_EXCL with mode 0600, so it is owner-only from the first byte (never chmod after)
Both re-read the mode and raise if group or other has any access. Prefer a folder under the session scratchpad
(/tmp/claude-1000/..., itself 0700) or a private_dir; delete the files when the run ends.

  python3 scripts/staging/private_files.py --self-test [dir]
"""
import os
import stat
import sys


def _check(path):
    mode = stat.S_IMODE(os.stat(path).st_mode)
    if mode & 0o077:
        raise PermissionError(f'{path} is not owner-only (mode {oct(mode)})')
    return mode


def private_dir(path):
    try:
        os.mkdir(path, 0o700)
    except FileExistsError:
        pass
    if os.stat(path).st_uid != os.getuid():
        raise PermissionError(f'{path} is owned by someone else')
    _check(path)
    return path


def write_private(path, data):
    _check(os.path.dirname(os.path.abspath(path)) or '.')
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        _check(path)
        os.write(fd, data.encode() if isinstance(data, str) else data)
    finally:
        os.close(fd)
    return path


if __name__ == '__main__' and sys.argv[1:2] == ['--self-test']:
    base = sys.argv[2] if len(sys.argv) > 2 else '/workspaces/.nearby-verify'
    d = os.path.join(base, f'private-files-selftest-{os.getpid()}')
    try:
        private_dir(d)
        write_private(os.path.join(d, 'session.json'), '{}')
        plain = os.path.join(d, 'plain')
        open(plain, 'w').close()
        print('dir', oct(_check(d)), 'file', oct(_check(os.path.join(d, 'session.json'))),
              'ordinary open() here', oct(stat.S_IMODE(os.stat(plain).st_mode)))
        try:
            write_private(os.path.join(d, 'session.json'), 'x')
            print('FAIL: overwrote an existing file'); sys.exit(1)
        except FileExistsError:
            pass
        os.chmod(d, 0o755)
        try:
            private_dir(d)
            print('FAIL: accepted a non-private directory'); sys.exit(1)
        except PermissionError:
            pass
        print('PASS')
    finally:
        for f in os.listdir(d) if os.path.isdir(d) else []:
            os.remove(os.path.join(d, f))
        if os.path.isdir(d):
            os.rmdir(d)
