#!/bin/bash
# usage: scripts/dev/check-and-tick.sh T-001 1.1 "결과 텍스트" [files to format...]
# prettier → 전체 pnpm lint → 티켓 항목 체크. git은 건드리지 않는다(커밋은 따로):
#   git add <files> docs/tickets/T-001.md && git commit -m "T-001/1.1: 요약" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
t=$1; i=$2; r=$3; shift 3
export PATH="$HOME/.local/hx-bin:$HOME/.nvm/versions/node/v22.23.4/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
cd "$(dirname "$0")/../.."
f=docs/tickets/$t.md
[ $# -gt 0 ] && pnpm exec prettier --write --log-level warn "$@" 2>/dev/null
pnpm lint >/dev/null 2>&1 || { pnpm lint 2>&1 | tail -20; echo "LINT FAIL"; exit 1; }
python3 - "$f" "$i" "$r" <<'PY'
import sys
f,i,r=sys.argv[1:]
L=open(f).read().split('\n')
for k,l in enumerate(L):
    if l.startswith(f'- [ ] {i} '):
        L[k]=l.replace('- [ ]','- [x]',1); L.insert(k+1,f'  - 결과: {r}'); break
else: sys.exit("item not found")
open(f,'w').write('\n'.join(L))
PY
echo "ticked $t/$i — now commit separately"
