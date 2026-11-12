import { existsSync } from 'node:fs';
import { SettingValueError } from '../settings/registry.js';
import type { ProjectSettingsIO } from '../settings/store.js';
import type { ProjectStore } from './project-store.js';
import { readProjectMarker, writeProjectMarker } from './project-store.js';
import type { ProjectMarker } from './schema.js';

/**
 * T-101 6B.14 (0-1 × 0-2 연결) 프로젝트 범위 설정 저장소.
 * 0-1 SettingsStore의 주입 인터페이스 ProjectSettingsIO를 0-2 프로젝트 표식
 * `<프로젝트>/.harness-x/project.json`의 `settings` 칸으로 구현한다 (Git에 올려도 되는 파일 → 팀이 같은 값을 씀).
 * 프로젝트 폴더를 옮기거나 이름을 바꿔도 표식 id가 같으면 값이 따라간다(writeProjectMarker가 보존).
 */
export function projectSettingsIO(projects: Pick<ProjectStore, 'get'>): ProjectSettingsIO {
  return {
    read(projectId) {
      const p = projects.get(projectId);
      if (!p || p.missing) return {};
      const m = readProjectMarker(p.rootPath);
      return m && m.id === p.id && m.settings ? structuredClone(m.settings) : {};
    },
    write(projectId, values) {
      const p = projects.get(projectId);
      if (!p) throw new SettingValueError('', '프로젝트를 찾을 수 없어요.');
      if (p.missing || !existsSync(p.rootPath))
        throw new SettingValueError('', '프로젝트 폴더를 찾을 수 없어요. 먼저 폴더를 다시 연결해 주세요.');
      const m = readProjectMarker(p.rootPath);
      const base: ProjectMarker = m && m.id === p.id ? m : { id: p.id, name: p.name, createdAt: p.createdAt };
      const { settings: _old, ...rest } = base;
      // 값이 비면 settings 칸을 지운다 (undefined는 파일에 쓰이지 않음 — writeProjectMarker가 보존하지 않게 명시)
      writeProjectMarker(p.rootPath, { ...rest, settings: Object.keys(values).length ? values : undefined });
    },
  };
}
