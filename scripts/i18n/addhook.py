# Give a component t/language: python3 scripts/i18n/addhook.py <file> [FunctionName]
# Adds the LanguageContext import (right path for screens/components/motion) and `const { t, language } = useLanguage();`
# as the first line of the named function (default: the default export). No-op if already present in that function.
import sys, re, os
p = sys.argv[1]
fn = sys.argv[2] if len(sys.argv) > 2 else None
s = open(p).read()
rel = os.path.relpath('src/context/LanguageContext', os.path.dirname(p))
if not rel.startswith('.'): rel = './' + rel
if 'useLanguage' not in s.split('\n\n')[0] and not re.search(r"import \{[^}]*useLanguage[^}]*\} from '[./]+context/LanguageContext'", s):
    first_import_end = s.index('\n', s.index('import '))
    s = s[:first_import_end + 1] + f"import {{ useLanguage }} from '{rel}';\n" + s[first_import_end + 1:]
pat = rf"(export default function {fn or r'\w+'}\s*\([^)]*\)\s*\{{\n)" if not fn else rf"((?:export default )?function {fn}\s*\((?:[^()]|\([^()]*\))*\)\s*\{{\n)"
m = re.search(pat, s)
assert m, ('function not found', p, fn)
body_start = m.end()
nxt = s[body_start:body_start + 400]
if 'useLanguage()' not in nxt:
    s = s[:body_start] + "  const { t, language } = useLanguage();\n" + s[body_start:]
open(p, 'w').write(s)
