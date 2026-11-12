/**
 * T-101 0C.2 ESLint 사용자 규칙 `hx/no-dead-button` (로컬 규칙, 새 npm 패키지 없음).
 *
 * 눌러도 아무 일이 없는 화면 요소를 만들 때 막는다.
 * - 대상: <button>, <a>, role이 button·menuitem·menuitemradio·menuitemcheckbox·tab인 요소
 * - noHandler: 활성 요소에 클릭 처리(onClick 등)·링크(href)·제출(type="submit")이 없음
 * - disabledNoReason: 비활성(disabled / aria-disabled)인데 "왜 못 누르는지" 툴팁(title·aria-describedby)이 없음
 * - noAction (옵션 requireAction): 상호작용 계약(0C.1)의 `data-action` 또는 `{...act('id')}`가 없음
 *
 * 알 수 없는 펼침 속성(`{...props}`)이 있으면 판단할 수 없으므로 검사하지 않는다.
 */

const ROLES = new Set(['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tab']);
const HANDLERS = new Set([
  'onClick',
  'onMouseDown',
  'onMouseUp',
  'onPointerDown',
  'onPointerUp',
  'onKeyDown',
]);
const ACTION_HELPERS = new Set(['act', 'actionAttr']);
const REASONS = new Set(['title', 'aria-describedby', 'data-disabled-reason']);

function tagName(node) {
  return node.name.type === 'JSXIdentifier' ? node.name.name : undefined;
}

/** 속성 값이 문자 상수면 그 값, 식이면 undefined, 값 없음(<x disabled>)이면 true */
function literal(attr) {
  if (!attr.value) return true;
  if (attr.value.type === 'Literal') return attr.value.value;
  if (attr.value.type === 'JSXExpressionContainer') {
    const e = attr.value.expression;
    if (e.type === 'Literal') return e.value;
    if (e.type === 'TemplateLiteral' && e.expressions.length === 0) return e.quasis[0].value.cooked;
  }
  return undefined;
}

function isActionSpread(a) {
  return (
    a.type === 'JSXSpreadAttribute' &&
    a.argument.type === 'CallExpression' &&
    a.argument.callee.type === 'Identifier' &&
    ACTION_HELPERS.has(a.argument.callee.name)
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export const noDeadButton = {
  meta: {
    type: 'problem',
    docs: { description: '눌러도 아무 일 없는 버튼·메뉴 항목·링크 금지 (T-101 0C.2)' },
    schema: [
      {
        type: 'object',
        properties: { requireAction: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      noHandler:
        '<{{name}}>를 눌러도 아무 일이 없어요: onClick·href·type="submit" 중 하나를 붙이거나, 아직 기능이 없으면 disabled + title="준비 중이에요"로 두세요.',
      disabledNoReason: '비활성 <{{name}}>에는 왜 못 누르는지 알려 주는 title(툴팁)을 붙이세요.',
      noAction:
        "<{{name}}>에 상호작용 계약 data-action이 없어요: {...act('<id>')}를 붙이세요 (apps/web/src/actions/registry.ts).",
    },
  },
  create(context) {
    const requireAction = !!context.options[0]?.requireAction;
    return {
      JSXOpeningElement(node) {
        const name = tagName(node);
        if (!name) return;
        const attrs = new Map();
        let unknownSpread = false;
        let hasAction = false;
        for (const a of node.attributes) {
          if (a.type === 'JSXSpreadAttribute') {
            if (isActionSpread(a)) hasAction = true;
            else unknownSpread = true;
            continue;
          }
          if (a.name.type === 'JSXIdentifier') attrs.set(a.name.name, a);
        }
        const role = attrs.has('role') ? literal(attrs.get('role')) : undefined;
        const target = name === 'button' || name === 'a' || (typeof role === 'string' && ROLES.has(role));
        if (!target || unknownSpread) return;
        if (attrs.has('data-action')) hasAction = true;
        // <a>는 버튼 역할(role) 없이 이름표·앵커로만 쓰이는 경우(href도 onClick도 없음, name/id만)는 링크가 아니다
        if (name === 'a' && !role && !attrs.has('href') && !hasHandler(attrs)) {
          if (attrs.has('id') || attrs.has('name')) return;
        }

        const report = (messageId) => context.report({ node, messageId, data: { name } });
        if (requireAction && !hasAction) report('noAction');

        const disabledAttr = attrs.get('disabled') ?? attrs.get('aria-disabled');
        const disabledVal = disabledAttr ? literal(disabledAttr) : false;
        const disabled = disabledAttr && disabledVal !== false && disabledVal !== 'false';
        if (disabled && ![...REASONS].some((r) => attrs.has(r))) report('disabledNoReason');
        // 항상 비활성(disabled / disabled={true})이면 처리 함수가 없어도 된다
        if (disabled && (disabledVal === true || disabledVal === 'true')) return;

        const type = attrs.has('type') ? literal(attrs.get('type')) : undefined;
        const ok =
          hasHandler(attrs) ||
          (name === 'a' && attrs.has('href')) ||
          (name === 'button' &&
            (type === 'submit' || type === 'reset' || (type === undefined && attrs.has('form'))));
        if (!ok) report('noHandler');
      },
    };
  },
};

function hasHandler(attrs) {
  for (const h of HANDLERS) if (attrs.has(h)) return true;
  return false;
}

export const hxPlugin = { rules: { 'no-dead-button': noDeadButton } };
export default hxPlugin;
