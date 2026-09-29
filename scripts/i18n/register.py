# Register a ui namespace and mark files localized: python3 scripts/i18n/register.py <ns> <file> [<file>...]
import sys, re
ns, files = sys.argv[1], sys.argv[2:]
p = 'src/i18n/ui/index.js'
s = open(p).read()
if f"import {ns} from './{ns}';" not in s:
    s = s.replace("import common from './common';", f"import common from './common';\nimport {ns} from './{ns}';")
    s = re.sub(r"export const UI_NAMESPACES = \{ ([^}]*) \};", lambda m: f"export const UI_NAMESPACES = {{ {m.group(1)}, {ns} }};", s)
open(p, 'w').write(s)
p = 'src/i18n/ui/coverage.js'
s = open(p).read()
m = re.search(r"export const LOCALIZED_FILES = \[(.*?)\];", s, re.S)
cur = [x.strip().strip("'") for x in m.group(1).split(',') if x.strip()]
for f in files:
    if f not in cur: cur.append(f)
body = '\n' + ''.join(f"  '{f}',\n" for f in cur)
s = s[:m.start()] + f"export const LOCALIZED_FILES = [{body}];" + s[m.end():]
open(p, 'w').write(s)
