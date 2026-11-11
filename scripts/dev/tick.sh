#!/bin/bash
# usage: scripts/dev/tick.sh T-001 1.1 "결과 텍스트" "커밋 요약" files...
t=$1; i=$2; r=$3; s=$4; shift 4
f=docs/tickets/$t.md
[ $# -gt 0 ] && pnpm exec prettier --write --log-level warn "$@" 2>/dev/null </dev/null; pnpm lint >/dev/null 2>&1 || { pnpm lint 2>&1 | tail -20; echo "LINT FAIL"; exit 1; }
python3 - "$f" "$i" "$r" <<'PY'
import sys,re
f,i,r=sys.argv[1:]
L=open(f).read().split('\n')
for k,l in enumerate(L):
    if l.startswith(f'- [ ] {i} '):
        L[k]=l.replace('- [ ]','- [x]',1); L.insert(k+1,f'  - 결과: {r}'); break
else: sys.exit("item not found")
open(f,'w').write('\n'.join(L))
PY
git add "$f" "$@" && git commit -qm "$t/$i: $s" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && echo "committed $t/$i"
