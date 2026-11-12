// C-3 용량 진단(읽기만). usage: node scripts/audit/size-scan.mjs <검사>
//  src(C3.1) deps(C3.2) dist(C3.3) fixtures(C3.4) logs(C3.5) userdata(C3.6) models(C3.7) git(C3.8)
//  git-large(C3.9) git-generated(C3.10) git-history(C3.11) dup(C3.12) heavy(C3.13) bundle(C3.14)
//  retention-keys(C3.15)
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, statSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { auditDir, dirSize, mb, rawDir, readJson, root, run, sh, writeJson } from './lib.mjs';

const tracked = () => sh('git ls-files -z').split('\0').filter(Boolean);
const size = (p) => {
  try {
    return statSync(join(root, p)).size;
  } catch {
    return 0;
  }
};
const du = (p) => Number((run('du', ['-sb', p]).stdout || '0').split('\t')[0]) || 0;
const pkgDirs = () =>
  tracked()
    .filter((f) => f.endsWith('package.json'))
    .map((f) => dirname(f))
    .filter((d) => d !== '.');
const save = (name, v, msg) => {
  writeJson(join(rawDir, `${name}.json`), v);
  console.log(`${name}: ${msg}`);
};
const home = process.env.HARNESS_X_HOME ?? join(homedir(), '.harness-x');

const checks = {
  src() {
    const files = tracked();
    const out = pkgDirs()
      .map((d) => {
        const fs = files.filter((f) => f.startsWith(`${d}/src/`));
        return { package: d, files: fs.length, bytes: fs.reduce((s, f) => s + size(f), 0) };
      })
      .filter((x) => x.files)
      .sort((a, b) => b.bytes - a.bytes);
    const total = out.reduce((s, x) => s + x.bytes, 0);
    save(
      'size-src',
      { totalBytes: total, totalMB: mb(total), packages: out },
      `패키지 ${out.length}개 src 합계 ${mb(total)}MB`,
    );
  },
  deps() {
    const nm = sh(
      `find . -path ./.claude -prune -o -path ./.git -prune -o -name node_modules -type d -prune -print`,
    )
      .split('\n')
      .filter(Boolean);
    const dirs = nm
      .map((d) => ({ dir: d.replace(/^\.\//, ''), bytes: du(join(root, d)) }))
      .sort((a, b) => b.bytes - a.bytes);
    const store = (run('pnpm', ['store', 'path']).stdout || '').trim();
    const storeBytes = store && existsSync(store) ? du(store) : null;
    const total = dirs.reduce((s, x) => s + x.bytes, 0);
    save(
      'size-deps',
      {
        nodeModulesBytes: total,
        nodeModulesMB: mb(total),
        dirs: dirs.slice(0, 40),
        dirCount: dirs.length,
        note: 'du -sb는 심볼릭 링크를 따라가지 않음(pnpm 링크 기준)',
        pnpmStore: store,
        pnpmStoreBytes: storeBytes,
        pnpmStoreMB: storeBytes && mb(storeBytes),
      },
      `node_modules ${dirs.length}곳 ${mb(total)}MB, pnpm 저장소 ${storeBytes ? mb(storeBytes) + 'MB' : '없음'}`,
    );
  },
  dist() {
    const out = pkgDirs()
      .filter((d) => existsSync(join(root, d, 'dist')))
      .map((d) => ({ package: d, bytes: dirSize(join(root, d, 'dist')).bytes }))
      .sort((a, b) => b.bytes - a.bytes);
    const tauri = join(root, 'apps', 'desktop', 'src-tauri', 'target');
    const tauriBytes = existsSync(tauri) ? du(tauri) : 0;
    const total = out.reduce((s, x) => s + x.bytes, 0);
    save(
      'size-dist',
      {
        totalBytes: total,
        totalMB: mb(total),
        packages: out,
        tauriTargetBytes: tauriBytes,
        tauriTargetMB: mb(tauriBytes),
      },
      `dist ${out.length}곳 ${mb(total)}MB, Tauri target ${mb(tauriBytes)}MB`,
    );
  },
  fixtures() {
    const fs = tracked().filter(
      (f) =>
        /(^|\/)(fixtures|__fixtures__|recordings?|__snapshots__)\//.test(f) || /\.(jsonl|ndjson)$/.test(f),
    );
    const list = fs.map((f) => ({ file: f, bytes: size(f) })).sort((a, b) => b.bytes - a.bytes);
    const total = list.reduce((s, x) => s + x.bytes, 0);
    save(
      'size-fixtures',
      { files: list.length, totalBytes: total, totalMB: mb(total), top20: list.slice(0, 20) },
      `테스트 데이터 ${list.length}개 ${mb(total)}MB`,
    );
  },
  logs() {
    const items = [];
    for (const base of [join(home, 'logs'), join(home, 'sessions'), join(home, 'run')]) {
      if (!existsSync(base)) continue;
      const walk = (p) => {
        for (const n of readdirSync(p, { withFileTypes: true })) {
          const q = join(p, n.name);
          if (n.isDirectory()) walk(q);
          else if (/events\.jsonl$|\.log$|\.sqlite(-wal|-shm)?$/.test(n.name))
            items.push({ file: q.replace(homedir(), '~'), bytes: lstatSync(q).size });
        }
      };
      walk(base);
    }
    const total = items.reduce((s, x) => s + x.bytes, 0);
    save(
      'size-logs',
      {
        home: home.replace(homedir(), '~'),
        totalBytes: total,
        totalMB: mb(total),
        files: items.sort((a, b) => b.bytes - a.bytes),
      },
      `하네스 로그·이벤트 ${items.length}개 ${mb(total)}MB`,
    );
  },
  userdata() {
    const parts = {};
    if (existsSync(home)) for (const n of readdirSync(home)) parts[n] = du(join(home, n));
    const projAtt = [];
    for (const d of [root]) {
      const a = join(d, '.harness-x');
      if (existsSync(a))
        for (const n of readdirSync(a))
          projAtt.push({ dir: `<저장소>/.harness-x/${n}`, bytes: du(join(a, n)) });
    }
    const total = Object.values(parts).reduce((s, x) => s + x, 0);
    save(
      'size-userdata',
      {
        note: '보고만 — 삭제 대상 아님(세션·첨부·임시 작업 공간·모델)',
        home: home.replace(homedir(), '~'),
        totalBytes: total,
        totalMB: mb(total),
        parts,
        projectData: projAtt,
      },
      `사용자 데이터 ${mb(total)}MB (보고만)`,
    );
  },
  models() {
    const r = run('ollama', ['list']);
    const ok = r.status === 0;
    save(
      'size-models',
      {
        note: '보고만',
        ollama: ok ? 'installed' : '없음(명령 없음)',
        list: ok ? r.stdout : null,
        whisperModels: [],
      },
      ok ? 'ollama 목록 기록' : '로컬 모델 없음(ollama 미설치)',
    );
  },
  git() {
    const t = sh('git count-objects -vH');
    const o = Object.fromEntries(
      t
        .trim()
        .split('\n')
        .map((l) => l.split(': ')),
    );
    save(
      'size-git',
      { countObjects: o, gitDirBytes: du(join(root, '.git')), gitDirMB: mb(du(join(root, '.git'))) },
      `.git ${o['size-pack']} pack, 느슨한 객체 ${o.count}개`,
    );
  },
  'git-large'() {
    const list = tracked()
      .map((f) => ({ file: f, bytes: size(f) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20);
    save('git-large-tracked', list, `가장 큰 추적 파일 ${list[0]?.file} ${mb(list[0]?.bytes ?? 0)}MB`);
  },
  'git-generated'() {
    const re =
      /(^|\/)(dist|coverage|build|out|target|\.harness-x-dev|node_modules)\/|\.log$|(^|\/)\.harness-x\/(attachments|sessions|logs)\/|\.(rec|raw)\.(webm|wav|mp4)$|\.tsbuildinfo$/;
    const list = tracked()
      .filter((f) => re.test(f))
      .map((f) => ({ file: f, bytes: size(f) }));
    save('git-generated', list, `추적 중인 생성물 ${list.length}개`);
  },
  'git-history'() {
    const objs = sh('git rev-list --objects --all').split('\n').filter(Boolean);
    const input = objs.map((l) => l.split(' ')[0]).join('\n');
    const r = run('git', ['cat-file', '--batch-check=%(objecttype) %(objectname) %(objectsize)'], { input });
    const names = new Map(objs.map((l) => [l.split(' ')[0], l.slice(41)]));
    const blobs = r.stdout
      .split('\n')
      .filter((l) => l.startsWith('blob'))
      .map((l) => {
        const [, sha, s] = l.split(' ');
        return { sha, bytes: Number(s), path: names.get(sha) ?? '' };
      })
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20);
    save(
      'git-history-large',
      { note: '보고만 — Git 기록 다시 쓰기는 하지 않음', objects: objs.length, top20: blobs },
      `기록 속 큰 객체 1위 ${blobs[0]?.path} ${mb(blobs[0]?.bytes ?? 0)}MB`,
    );
  },
  dup() {
    const r = run('pnpm', ['ls', '-r', '--depth', 'Infinity', '--json'], { maxBuffer: 1024 * 1024 * 1024 });
    const data = JSON.parse(r.stdout || '[]');
    const versions = new Map();
    const visit = (deps) => {
      for (const [name, d] of Object.entries(deps ?? {})) {
        if (!d?.version || d.version.startsWith('link:')) continue;
        if (!versions.has(name)) versions.set(name, new Set());
        versions.get(name).add(d.version);
        visit(d.dependencies);
      }
    };
    for (const p of data) {
      visit(p.dependencies);
      visit(p.devDependencies);
    }
    const dups = [...versions]
      .filter(([, v]) => v.size > 1)
      .map(([name, v]) => ({ name, versions: [...v].sort() }))
      .sort((a, b) => b.versions.length - a.versions.length);
    save(
      'dup-versions',
      { packages: versions.size, duplicated: dups.length, list: dups },
      `라이브러리 ${versions.size}종 중 여러 버전 ${dups.length}종`,
    );
  },
  heavy() {
    const store = join(root, 'node_modules', '.pnpm');
    const list = readdirSync(store)
      .filter((n) => n.includes('@') && n !== 'node_modules')
      .map((n) => ({ entry: n, bytes: du(join(store, n)) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20);
    save('heavy-deps', list, `가장 큰 설치 패키지 ${list[0]?.entry} ${mb(list[0]?.bytes ?? 0)}MB`);
  },
  bundle() {
    // 웹 번들 큰 덩어리: dist/assets 파일별 크기 + (소스맵이 있으면) 모듈별 기여. 임시 설정 빌드 대신 현재 빌드 결과를 분석
    const dist = join(root, 'apps', 'web', 'dist');
    const files = [];
    const walk = (p) => {
      for (const n of readdirSync(p, { withFileTypes: true })) {
        const q = join(p, n.name);
        if (n.isDirectory()) walk(q);
        else files.push({ file: q.slice(dist.length + 1), bytes: lstatSync(q).size });
      }
    };
    walk(dist);
    const chunks = files.filter((f) => /\.(js|css|wasm)$/.test(f.file)).sort((a, b) => b.bytes - a.bytes);
    const top = chunks.slice(0, 10).map((c) => {
      const map = join(dist, c.file + '.map');
      let modules = null;
      if (existsSync(map)) {
        const m = JSON.parse(readFileSync(map, 'utf8'));
        const byPkg = {};
        (m.sources ?? []).forEach((s, i) => {
          const pkg =
            s.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/)?.[1] ??
            (s.includes('/src/') ? 'app src' : 'other');
          byPkg[pkg] = (byPkg[pkg] ?? 0) + (m.sourcesContent?.[i]?.length ?? 0);
        });
        modules = Object.entries(byPkg)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
      }
      const name =
        c.file.match(
          /(monaco|editor|worker|ts\.worker|json\.worker|css\.worker|html\.worker|index|vendor|react|xterm|flow)/i,
        )?.[1] ?? '';
      return { ...c, guess: name, modules };
    });
    save(
      'bundle-top',
      {
        totalFiles: files.length,
        totalBytes: files.reduce((s, f) => s + f.bytes, 0),
        top10: top,
        note: '현재 빌드 결과(apps/web/dist) 분석. 소스맵 없으면 파일 이름으로 추정',
      },
      `큰 덩어리 1위 ${top[0]?.file} ${mb(top[0]?.bytes ?? 0)}MB`,
    );
  },
  'retention-keys'() {
    const keys = readJson(join(auditDir, 'snapshots', 'settings-keys.json'), []);
    const hits = keys.filter((k) => /retention|keep|보관|cleanup|days|maxAge|ttl|prune/i.test(k.key));
    const code = sh(
      `git grep -n -I -E "retention|keepDays|maxAgeDays|cleanupOlderThan|pruneOlder|보관 기간" -- packages apps ':!*.test.*'`,
    )
      .split('\n')
      .filter(Boolean)
      .slice(0, 40);
    save(
      'retention-keys',
      { settingKeys: hits, codeRefs: code },
      `보관 관련 설정 키 ${hits.length}개, 코드 언급 ${code.length}곳`,
    );
  },
};
const name = process.argv[2];
if (!checks[name]) {
  console.error(`검사: ${Object.keys(checks).join(' | ')}`);
  process.exit(1);
}
checks[name]();
