/**
 * 24.2 쓰기형 Bash 판별기
 * 셸 명령 문자열을 단순 명령 단위(; && || | 줄바꿈)로 나누고, 각 명령이 파일 시스템(또는 저장소·의존성)을
 * 바꾸는지 판정한다. 알 수 있으면 쓰기 대상 경로도 모은다(경로 교정용). 모르는 명령은 읽기로 본다.
 */

export interface BashClassification {
  write: boolean;
  /** 쓰기 대상으로 보이는 경로 (알 수 없으면 비어 있음) */
  targets: string[];
  /** 판정 근거 (예: "redirect >", "rm", "git checkout") */
  reasons: string[];
}

type Token = { t: 'word'; v: string } | { t: 'op'; v: string };

/** 따옴표·이스케이프를 처리하는 최소 셸 토크나이저 */
export function tokenize(cmd: string): Token[] {
  const out: Token[] = [];
  let cur = '';
  let has = false;
  const push = () => {
    if (has) out.push({ t: 'word', v: cur });
    cur = '';
    has = false;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const end = j < 0 ? cmd.length : j;
      cur += cmd.slice(i + 1, end);
      has = true;
      i = end;
    } else if (c === '"') {
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) i++;
        cur += cmd[i];
        i++;
      }
      has = true;
    } else if (c === '\\' && i + 1 < cmd.length) {
      if (cmd[i + 1] === '\n') {
        i++;
        continue;
      }
      cur += cmd[++i];
      has = true;
    } else if (c === ' ' || c === '\t') {
      push();
    } else if (c === '\n' || c === ';') {
      push();
      out.push({ t: 'op', v: ';' });
    } else if (c === '&' || c === '|') {
      if (c === '&' && cmd[i + 1] === '>') {
        // &> file, &>> file
        push();
        const app = cmd[i + 2] === '>';
        out.push({ t: 'op', v: app ? '&>>' : '&>' });
        i += app ? 2 : 1;
      } else if (cmd[i + 1] === c) {
        push();
        out.push({ t: 'op', v: c + c });
        i++;
      } else {
        push();
        out.push({ t: 'op', v: c });
      }
    } else if (c === '>' || c === '<') {
      // 앞에 붙은 fd 번호(2>)는 연산자에 포함
      let fd = '';
      if (/^\d$/.test(cur)) {
        fd = cur;
        cur = '';
        has = false;
      }
      push();
      let op = fd + c;
      if (cmd[i + 1] === c) {
        op += c;
        i++;
      }
      if (c === '>' && cmd[i + 1] === '|') i++; // >| 강제 덮어쓰기
      if (cmd[i + 1] === '&') {
        // >&2, 2>&1 — fd 복제(파일 아님)
        let j = i + 2;
        let n = '';
        while (j < cmd.length && /[\d-]/.test(cmd[j]!)) n += cmd[j++];
        if (n) {
          out.push({ t: 'op', v: `${op}&${n}` });
          i = j - 1;
          continue;
        }
      }
      out.push({ t: 'op', v: op });
    } else if (c === '(' || c === ')' || c === '{' || c === '}') {
      // 서브셸·그룹: 구분자로 취급
      if (c === '{' || c === '}') {
        if (has) {
          cur += c;
          continue;
        }
      }
      push();
      out.push({ t: 'op', v: ';' });
    } else {
      cur += c;
      has = true;
    }
  }
  push();
  return out;
}

const SEPARATORS = new Set([';', '&&', '||', '|', '&']);
const NULL_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', 'nul', 'NUL']);

/** 명령 앞에 붙는 래퍼 (뒤의 실제 명령을 본다) */
const WRAPPERS = new Set([
  'sudo',
  'env',
  'command',
  'nohup',
  'time',
  'nice',
  'exec',
  'builtin',
  'doas',
  'xargs',
]);

/** 인자 전부가 쓰기 대상인 명령 */
const ALL_ARGS_WRITE = new Set([
  'rm',
  'rmdir',
  'mkdir',
  'touch',
  'tee',
  'truncate',
  'shred',
  'unlink',
  'chmod',
  'chown',
  'chgrp',
  'mkfifo',
]);
/** 마지막 인자가 쓰기 대상 (대상 디렉터리) */
const DEST_LAST = new Set(['cp', 'ln', 'install', 'rsync', 'scp']);
/** 대상은 모르지만 쓰기 */
const OPAQUE_WRITE = new Set(['dd', 'patch', 'unzip', 'gunzip', 'bunzip2', 'unxz', 'mktemp', 'wget']);

const GIT_WRITE = new Set([
  'checkout',
  'switch',
  'restore',
  'reset',
  'apply',
  'am',
  'merge',
  'rebase',
  'pull',
  'cherry-pick',
  'revert',
  'stash',
  'clean',
  'rm',
  'mv',
  'commit',
  'add',
  'init',
  'clone',
  'worktree',
  'submodule',
]);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx']);
const PKG_WRITE = new Set([
  'install',
  'i',
  'add',
  'ci',
  'remove',
  'rm',
  'uninstall',
  'un',
  'update',
  'up',
  'upgrade',
  'link',
  'unlink',
  'prune',
  'dedupe',
  'init',
  'create',
]);

function base(cmd: string): string {
  const b = cmd.split('/').pop() ?? cmd;
  return b.replace(/\.exe$/i, '');
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  let end = false;
  for (const a of args) {
    if (!end && a === '--') {
      end = true;
      continue;
    }
    if (!end && a.startsWith('-') && a !== '-') continue;
    out.push(a);
  }
  return out;
}

/** 단순 명령 1개 (리다이렉션 제외한 단어들) */
function classifySimple(words: string[], res: BashClassification): void {
  const w = [...words];
  // VAR=value 접두 할당 건너뛰기
  while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!)) w.shift();
  while (w.length && WRAPPERS.has(base(w[0]!))) {
    const wr = base(w.shift()!);
    // env/sudo 옵션과 할당 건너뛰기
    while (w.length && (w[0]!.startsWith('-') || (wr === 'env' && w[0]!.includes('=')))) w.shift();
  }
  if (!w.length) return;
  const name = base(w[0]!);
  const args = w.slice(1);
  const mark = (reason: string, targets: string[] = []) => {
    res.write = true;
    res.reasons.push(reason);
    res.targets.push(...targets);
  };

  if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash') {
    const k = args.indexOf('-c');
    const inner = k >= 0 ? args[k + 1] : undefined;
    if (inner !== undefined) {
      const r = classifyBash(inner);
      if (r.write) mark(`${name} -c: ${r.reasons.join(', ')}`, r.targets);
    }
    return;
  }
  if (ALL_ARGS_WRITE.has(name)) {
    let pos = positional(args);
    if (name === 'chmod' || name === 'chown' || name === 'chgrp') pos = pos.slice(1);
    if (name === 'truncate') pos = positional(args.filter((a, i) => !(args[i - 1] === '-s')));
    return mark(name, pos);
  }
  if (name === 'mv') return mark('mv', positional(args));
  if (DEST_LAST.has(name)) {
    const pos = positional(args);
    return mark(name, pos.length ? [pos.at(-1)!] : []);
  }
  if (OPAQUE_WRITE.has(name)) {
    if (name === 'dd') {
      const of = args.find((a) => a.startsWith('of='));
      return mark('dd', of ? [of.slice(3)] : []);
    }
    return mark(name);
  }
  if (name === 'sed' || name === 'perl') {
    const inplace = args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'));
    if (!inplace) return;
    // sed -i 's/a/b/' f1 f2 / sed -i -e 's/a/b/' f1 / perl -pi -e '…' f1 → 스크립트 뒤가 파일
    const files: string[] = [];
    let script = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (/^-[a-zA-Z]*[ef]$/.test(a)) {
        script = true;
        i++;
      } else if (!a.startsWith('-')) files.push(a);
    }
    return mark(`${name} -i`, script ? files : files.slice(1));
  }
  if (name === 'curl') {
    const k = args.findIndex((a) => a === '-o' || a === '--output');
    if (k >= 0) return mark('curl -o', args[k + 1] ? [args[k + 1]!] : []);
    if (args.some((a) => a === '-O' || a === '--remote-name')) return mark('curl -O');
    return;
  }
  if (name === 'tar') {
    // tar xzf a.tgz / tar -czf out.tgz dir / tar --extract …
    const short = args.filter((a, i) => /^-[a-zA-Z]+$/.test(a) || (i === 0 && /^[a-zA-Z]+$/.test(a)));
    if (args.some((a) => a === '--extract' || a === '--create') || short.some((a) => /[xc]/.test(a)))
      return mark('tar');
    return;
  }
  if (name === 'find') {
    if (args.includes('-delete')) return mark('find -delete');
    const k = args.findIndex((a) => a === '-exec' || a === '-execdir' || a === '-ok');
    if (k >= 0) {
      const end = args.findIndex((a, i) => i > k && (a === ';' || a === '+'));
      const inner = args.slice(k + 1, end < 0 ? undefined : end);
      const sub: BashClassification = { write: false, targets: [], reasons: [] };
      classifySimple(inner, sub);
      if (sub.write) mark(`find -exec ${sub.reasons.join(', ')}`);
    }
    return;
  }
  if (name === 'git') {
    // git -C dir … / git -c k=v … 건너뛰기
    let k = 0;
    while (k < args.length && args[k]!.startsWith('-')) k += args[k] === '-C' || args[k] === '-c' ? 2 : 1;
    const sub = args[k];
    if (sub && GIT_WRITE.has(sub)) {
      if (sub === 'stash' && (args[k + 1] === 'list' || args[k + 1] === 'show')) return;
      if (sub === 'worktree' && args[k + 1] === 'list') return;
      return mark(`git ${sub}`, sub === 'mv' || sub === 'rm' ? positional(args.slice(k + 1)) : []);
    }
    return;
  }
  if (PKG_MANAGERS.has(name)) {
    const sub = positional(args)[0];
    if (sub && PKG_WRITE.has(sub)) return mark(`${name} ${sub}`);
    return;
  }
  if (
    name === 'pip' ||
    name === 'pip3' ||
    name === 'uv' ||
    name === 'poetry' ||
    name === 'cargo' ||
    name === 'go'
  ) {
    const sub = positional(args)[0];
    if (sub && ['install', 'uninstall', 'add', 'remove', 'get', 'init', 'new', 'mod'].includes(sub))
      return mark(`${name} ${sub}`);
    if (name === 'uv' && sub === 'pip' && ['install', 'uninstall'].includes(positional(args)[1] ?? ''))
      return mark('uv pip install');
    return;
  }
  if (name === 'python' || name === 'python3' || name === 'node') {
    // -m pip install
    const k = args.indexOf('-m');
    if (k >= 0 && args[k + 1] === 'pip' && ['install', 'uninstall'].includes(args[k + 2] ?? ''))
      return mark(`${name} -m pip ${args[k + 2]}`);
  }
}

/** 명령 문자열 전체 판정 */
export function classifyBash(command: string): BashClassification {
  const res: BashClassification = { write: false, targets: [], reasons: [] };
  const toks = tokenize(command);
  let words: string[] = [];
  const flush = () => {
    if (words.length) classifySimple(words, res);
    words = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]!;
    if (tk.t === 'word') {
      words.push(tk.v);
      continue;
    }
    if (SEPARATORS.has(tk.v)) {
      flush();
      continue;
    }
    // 리다이렉션
    if (/^\d*>>?$|^&>>?$/.test(tk.v)) {
      const next = toks[i + 1];
      if (next?.t === 'word') {
        i++;
        if (!NULL_SINKS.has(next.v)) {
          res.write = true;
          res.reasons.push(`redirect ${tk.v}`);
          res.targets.push(next.v);
        }
      }
      continue;
    }
    if (/^\d*<<?$/.test(tk.v)) {
      const next = toks[i + 1];
      if (next?.t === 'word') i++; // 입력 리다이렉션·heredoc 구분자
      continue;
    }
    // fd 복제(2>&1) 등은 무시
  }
  flush();
  res.targets = [...new Set(res.targets)];
  return res;
}

/** 쓰기형 Bash 인가 */
export function isWriteBash(command: string): boolean {
  return classifyBash(command).write;
}
