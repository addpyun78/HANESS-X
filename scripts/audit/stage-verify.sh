#!/bin/bash
# 단계 마감 검증 묶음(E.9·F.6·I.7): 빌드 → 전체 테스트 → 기능 고정 → E2E → 전부 눌러 보기 → 엔진 스모크 4종
# usage: scripts/audit/stage-verify.sh <이름>   → docs/audit/raw/stage-<이름>/*.json, 요약 raw/stage-<이름>.txt
# CPU 부담을 줄이려고 하나씩, 일꾼 4개, nice
set -u
cd "$(dirname "$0")/../.."
source scripts/dev/env.sh
N=$1; D=docs/audit/raw/stage-$N; mkdir -p $D; OUT=docs/audit/raw/stage-$N.txt; : > $OUT
step() { local name=$1; shift; local t0=$(date +%s); "$@" > $D/$name.log 2>&1; local rc=$?; echo "$name exit=$rc sec=$(( $(date +%s)-t0 ))" | tee -a $OUT; }
step build nice -n 15 pnpm -r --workspace-concurrency=2 build
step tests nice -n 15 pnpm vitest run --maxWorkers=4 --reporter=json --outputFile=$D/tests.json
node -e "const r=require('./$D/tests.json');console.log('tests total',r.numTotalTests,'passed',r.numPassedTests,'failed',r.numFailedTests,'skipped',r.numPendingTests);for(const f of r.testResults)for(const a of f.assertionResults)if(a.status==='failed')console.log('  FAIL',f.name.replace(process.cwd()+'/',''),'>',a.fullName.slice(0,100))" | tee -a $OUT
step features nice -n 15 pnpm test:features
grep -E "Test Files|Tests " $D/features.log | tee -a $OUT
step e2e nice -n 15 pnpm exec vitest run --maxWorkers=2 --reporter=json --outputFile=$D/e2e.json e2e/
step crawler nice -n 15 pnpm check:dead-buttons
grep -E "Test Files|Tests " $D/crawler.log | tail -2 | tee -a $OUT
for e in claude codex agy local; do node --no-warnings scripts/audit/smoke-engine.mjs $e --out $D/smoke-$e.json | tail -1 | tee -a $OUT; done
echo "done $(date -Iseconds)" | tee -a $OUT
