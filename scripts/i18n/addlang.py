# Merge translations into scripts/i18n/strings/<ns>.json:  python3 scripts/i18n/addlang.py <ns> < rows.json
# rows.json = { "<key>": ["es", "de", "fr", "pt", "ht", "zh", "vi", "tl", "ru", "ko"], ... }  (a value may be a plural object)
import sys, json
ns = sys.argv[1]
LANGS = ['es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']
p = f'scripts/i18n/strings/{ns}.json'
store = json.load(open(p))
rows = json.load(sys.stdin)
for k, vals in rows.items():
    assert k in store['en'], ('unknown key', k)
    assert len(vals) == 10, ('need 10 languages', k)
    for l, v in zip(LANGS, vals):
        store.setdefault(l, {})[k] = v
json.dump(store, open(p, 'w'), ensure_ascii=False, indent=1)
open(p, 'a').write('\n')
left = [k for k in store['en'] if any(k not in store.get(l, {}) for l in LANGS)]
print('merged', len(rows), 'left', len(left), left[:30])
