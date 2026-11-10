#!/bin/bash
# usage: scripts/dev/gen-ticket.sh T-002  → docs/tickets/T-002.md (status: doing)
t=$1
python3 - "$t" <<'PY'
import sys,re
t=sys.argv[1]
L=open('docs/PLAN-v2.md').read().split('\n')
out=['status: doing','']; on=False
for l in L:
    if l.startswith('### '+t+' '): on=True; out.append('#'+l[3:]); continue
    if on and (l.startswith('### ') or l.startswith('## ')): break
    if on:
        if l.startswith('- '): out.append('- [ ] '+l[2:])
        elif l.strip(): out.append(''); out.append(l); out.append('')
open(f'docs/tickets/{t}.md','w').write('\n'.join(out).replace('\n\n\n','\n\n')+'\n')
PY
cat docs/tickets/$t.md
