#!/bin/bash
# T-102 항목 체크 + 커밋 도우미
# usage: scripts/audit/tick.sh <항목> "<검증 결과>" "<커밋 요약>" [files...]
# - 티켓 docs/tickets/T-102.md의 `- [ ] <항목> `을 [x]로 바꾸고 결과 줄을 붙인다.
# - 넘긴 파일은 prettier로 정리(raw/ 제외) 후 티켓과 함께 커밋한다.
set -e
i=$1; r=$2; s=$3; shift 3
export PATH="$HOME/.local/hx-bin:$HOME/.nvm/versions/node/v22.23.4/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
cd "$(dirname "$0")/../.."
f=docs/tickets/T-102.md
fmt=()
for p in "$@"; do case "$p" in docs/audit/raw/*|*.sh|docs/tickets/*) ;; *) [ -f "$p" ] && fmt+=("$p");; esac; done
[ ${#fmt[@]} -gt 0 ] && pnpm exec prettier --write --log-level warn "${fmt[@]}" </dev/null || true
python3 - "$f" "$i" "$r" <<'PY'
import sys
f,i,r=sys.argv[1:]
L=open(f,encoding='utf8').read().split('\n')
for k,l in enumerate(L):
    if l.startswith(f'- [ ] {i} '):
        L[k]=l.replace('- [ ]','- [x]',1); L.insert(k+1,f'  - 결과: {r}'); break
else: sys.exit(f"item not found: {i}")
open(f,'w',encoding='utf8').write('\n'.join(L))
PY
git add "$f" "$@"
git commit -qm "T-102/$i: $s" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && echo "committed T-102/$i"
