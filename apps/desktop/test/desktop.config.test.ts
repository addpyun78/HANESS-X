// @features F-054
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAURI = join(ROOT, 'src-tauri');
const readJson = (p: string) => JSON.parse(readFileSync(join(TAURI, p), 'utf8'));

describe('Tauri 2 데스크톱 설정 (T-063)', () => {
  it('63.1 웹 앱 번들(apps/web/dist) 임베드, 아이콘은 브랜드 에셋', () => {
    const conf = readJson('tauri.conf.json');
    expect(conf.build.frontendDist).toBe('../../web/dist');
    expect(conf.identifier).toMatch(/^[a-z0-9.-]+$/);
    for (const icon of conf.bundle.icon as string[]) expect(existsSync(join(TAURI, icon)), icon).toBe(true);
    // icon.ico = assets/brand/harness-x.ico
    expect(readFileSync(join(TAURI, 'icons', 'icon.ico'))).toEqual(
      readFileSync(join(ROOT, '..', '..', 'assets', 'brand', 'harness-x.ico')),
    );
    const cargo = readFileSync(join(TAURI, 'Cargo.toml'), 'utf8');
    expect(cargo).toMatch(/^tauri = \{ version = "2"/m);
  });

  it('63.3 dialog 플러그인 + capability dialog:allow-open', () => {
    const cap = readJson('capabilities/default.json');
    expect(cap.windows).toEqual(['main']);
    expect(cap.permissions).toContain('dialog:allow-open');
    expect(readFileSync(join(TAURI, 'Cargo.toml'), 'utf8')).toContain('tauri-plugin-dialog = "2"');
    expect(readFileSync(join(TAURI, 'src', 'lib.rs'), 'utf8')).toContain('tauri_plugin_dialog::init()');
  });

  it('63.4 Windows 설치 파일 대상: MSI + NSIS', () => {
    expect(readJson('tauri.conf.json').bundle.targets).toEqual(['msi', 'nsis']);
  });

  it('63.2 사이드카: 서버를 --exit-with-stdin으로 띄우고 앱 종료 시 stop', () => {
    const sidecar = readFileSync(join(TAURI, 'src', 'sidecar.rs'), 'utf8');
    expect(sidecar).toContain('--exit-with-stdin');
    const lib = readFileSync(join(TAURI, 'src', 'lib.rs'), 'utf8');
    expect(lib).toMatch(/RunEvent::Exit[\s\S]*s\.stop\(/);
  });
});
