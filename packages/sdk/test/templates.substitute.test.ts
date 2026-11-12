// @features F-047
import { describe, expect, it } from 'vitest';
import { TemplateVarError, TemplateVarsSchema, renderTemplate, substitute } from '../src/templates.js';

const VARS = {
  id: 'commit-guard',
  displayName: '커밋 가드',
  description: '커밋 전에 "비밀" 값이 없는지 검사한다',
  permissions: { fs: ['workspace:read' as const], net: ['api.example.com'], shell: true },
};

describe('50.2 템플릿 변수 치환기', () => {
  it('스냅샷: hook 템플릿 렌더링', () => {
    const files = renderTemplate('hook', VARS);
    expect(files).toMatchSnapshot();
  });

  it('스냅샷: skill 템플릿 렌더링', () => {
    expect(renderTemplate('skill', VARS)).toMatchSnapshot();
  });

  it('{{x}}는 그대로, 따옴표째 {{json:x}}는 JSON 리터럴로', () => {
    const vars = TemplateVarsSchema.parse(VARS);
    expect(substitute(`id={{id}} name='{{json:displayName}}' perm="{{json:permissions}}"`, vars)).toBe(
      `id=commit-guard name="커밋 가드" perm={"fs":["workspace:read"],"net":["api.example.com"],"shell":true}`,
    );
  });

  it('권한 기본값, 모르는 변수·잘못된 값 거부', () => {
    const vars = TemplateVarsSchema.parse({ id: 'x', displayName: 'X', description: 'd' });
    expect(vars.permissions).toEqual({ fs: [], net: [], shell: false });
    expect(() => substitute('{{nope}}', vars)).toThrow(TemplateVarError);
    expect(() => substitute('{{permissions}}', vars)).toThrow(/json:permissions/);
    expect(TemplateVarsSchema.safeParse({ ...VARS, id: 'Bad Id' }).success).toBe(false);
    expect(TemplateVarsSchema.safeParse({ ...VARS, displayName: 'a */ b' }).success).toBe(false);
    expect(TemplateVarsSchema.safeParse({ ...VARS, permissions: { fs: ['root'] } }).success).toBe(false);
  });
});
