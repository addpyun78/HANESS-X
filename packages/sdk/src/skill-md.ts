import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

/**
 * SKILL.md 프런트매터 검증기
 * ---
 * name: kebab-case 이름 (필수)
 * description: 언제·무엇에 쓰는지 (필수)
 * ---
 * 본문...
 */

export const SkillFrontmatterSchema = z
  .object({
    name: z
      .string({ message: 'name은 필수' })
      .min(1, { message: 'name은 필수' })
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'name은 소문자 kebab-case' }),
    description: z
      .string({ message: 'description은 필수' })
      .trim()
      .min(1, { message: 'description은 필수' })
      .max(1024),
  })
  .passthrough();
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface SkillMdResult {
  ok: boolean;
  errors: string[];
  frontmatter?: SkillFrontmatter;
  body?: string;
}

const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** SKILL.md 텍스트 검증. 예외 대신 오류 목록을 돌려준다 */
export function validateSkillMd(text: string): SkillMdResult {
  const m = FM_RE.exec(text);
  if (!m) return { ok: false, errors: ['프런트매터(--- ... ---)가 없음'] };
  let raw: unknown;
  try {
    raw = parseYaml(m[1]!);
  } catch (err) {
    return {
      ok: false,
      errors: [`프런트매터 YAML 오류: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, errors: ['프런트매터는 키: 값 객체여야 함'] };
  const r = SkillFrontmatterSchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { ok: true, errors: [], frontmatter: r.data, body: text.slice(m[0].length) };
}

/** 검증 실패 시 예외 */
export function parseSkillMd(text: string): { frontmatter: SkillFrontmatter; body: string } {
  const r = validateSkillMd(text);
  if (!r.ok) throw new Error(`SKILL.md 검증 실패: ${r.errors.join('; ')}`);
  return { frontmatter: r.frontmatter!, body: r.body! };
}
