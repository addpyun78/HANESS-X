// 플러그인 매니페스트(harness-plugin.json) 검사
//  dyn      (B.15) entry(main)·hooks·commands·skills·agents 경로 수집 → raw/dyn-plugins.json
//  files    (C2.11) 매니페스트가 가리키는 파일이 실제로 있는지 → raw/manifest-files.json
//  registered (C2.12) 매니페스트 provides vs 실제 등록 결과(snapshots/plugins.json·mcp-tools.json) → raw/manifest-registered.json
import { join, dirname } from 'node:path';
import { auditDir, existsSync, listFiles, rawDir, readJson, rel, root, writeJson } from './lib.mjs';

const manifests = listFiles(root, (p) => p.endsWith('harness-plugin.json'), {
  skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev', 'docs'],
}).map((p) => ({ file: rel(p), dir: dirname(p), m: readJson(p, {}) }));
const PATH_KEYS = ['main', 'hooks', 'commands', 'skills', 'agents', 'panel', 'ui', 'entry', 'settings'];
function paths(x) {
  const out = [];
  const add = (kind, v) => {
    if (typeof v === 'string' && /[./]/.test(v)) out.push({ kind, path: v });
    else if (Array.isArray(v))
      v.forEach((y) => add(kind, typeof y === 'object' ? (y.path ?? y.file ?? y.entry) : y));
    else if (v && typeof v === 'object')
      Object.values(v).forEach((y) =>
        add(kind, typeof y === 'object' ? (y?.path ?? y?.file ?? y?.entry) : y),
      );
  };
  for (const k of PATH_KEYS) if (x.m[k] !== undefined) add(k, x.m[k]);
  return out;
}
const mode = process.argv[2];
if (mode === 'dyn') {
  const out = [];
  for (const x of manifests) {
    out.push({ path: x.file, kind: 'manifest', plugin: x.m.id });
    for (const p of paths(x)) {
      out.push({ path: rel(join(x.dir, p.path)), kind: p.kind, plugin: x.m.id });
      // dist/index.js → 원본 src/index.ts도 진입점
      if (p.kind === 'main' && p.path.startsWith('dist/'))
        out.push({
          path: rel(join(x.dir, p.path.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'))),
          kind: 'main-src',
          plugin: x.m.id,
        });
    }
  }
  writeJson(join(rawDir, 'dyn-plugins.json'), out);
  console.log(`dyn-plugins: 매니페스트 ${manifests.length}개, 경로 ${out.length}개`);
} else if (mode === 'files') {
  const out = [];
  for (const x of manifests)
    for (const p of paths(x)) {
      const abs = join(x.dir, p.path);
      const src = p.path.startsWith('dist/')
        ? join(x.dir, p.path.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'))
        : null;
      out.push({
        plugin: x.m.id,
        manifest: x.file,
        kind: p.kind,
        path: p.path,
        exists: existsSync(abs),
        srcExists: src ? existsSync(src) : null,
      });
    }
  writeJson(join(rawDir, 'manifest-files.json'), out);
  console.log(
    `manifest-files: ${out.length}개 중 없음 ${out.filter((o) => !o.exists).length}개, 원본 없음 ${out.filter((o) => o.srcExists === false).length}개`,
  );
} else if (mode === 'registered') {
  const snap = readJson(join(auditDir, 'snapshots', 'plugins.json'), { plugins: [], rejected: [] });
  const tools = readJson(join(auditDir, 'snapshots', 'mcp-tools.json'), []);
  const byId = new Map(snap.plugins.map((p) => [p.id, p]));
  const out = [];
  for (const x of manifests) {
    const r = byId.get(x.m.id);
    const rej = snap.rejected.find((y) => y.id === x.m.id);
    const declared = Object.entries(x.m.provides ?? {}).flatMap(([slot, ids]) =>
      (ids ?? []).map((id) => `${slot}:${id}`),
    );
    const got = r
      ? Array.isArray(r.slots)
        ? r.slots.map((s) => (typeof s === 'string' ? s : s.slot)) // /api/plugins slots = 슬롯 이름만
        : []
      : [];
    const id = String(x.m.id);
    out.push({
      plugin: id,
      manifest: x.file,
      loaded: !!r,
      state: r?.state ?? (rej ? `rejected: ${rej.reason}` : 'not-loaded'),
      declared,
      registeredSlots: got,
      missingSlots: r
        ? [...new Set(declared.map((d) => d.split(':')[0]))].filter((s) => !got.includes(s))
        : [],
      // 로드 안 된 이유: 엔진·판정기·비교기·STT는 커널·다른 플러그인이 라이브러리로 직접 불러 쓰고, SDK 템플릿은 틀
      notLoadedReason: r
        ? null
        : id.startsWith('{{')
          ? 'SDK 템플릿(틀)'
          : id.startsWith('engine-')
            ? '엔진 어댑터: 커널 엔진 레지스트리가 직접 사용'
            : /comparator|judge|ladder|verifier/.test(id)
              ? '판정 라이브러리: 커널·checklist-ledger가 직접 사용'
              : id.startsWith('stt-')
                ? 'STT 라이브러리: 웹·attachments가 직접 사용'
                : x.file.startsWith('examples/')
                  ? '예시 플러그인'
                  : '확인 필요',
    });
  }
  writeJson(join(rawDir, 'manifest-registered.json'), { plugins: out, mcpToolCount: tools.length });
  console.log(`manifest-registered: ${out.length}개, 로드 안 됨 ${out.filter((o) => !o.loaded).length}개`);
}
