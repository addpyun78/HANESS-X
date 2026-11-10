/**
 * 37.3 "터미널에서 로그인" — 엔진별 공식 로그인 명령.
 * 하네스는 토큰을 읽지도 저장하지도 않는다. 공식 CLI가 브라우저 로그인 흐름을 직접 연다.
 */
export const LOGIN_COMMANDS: Readonly<Record<string, string>> = {
  codex: 'codex login',
  'claude-code': 'claude /login',
};

export function loginCommand(engineId: string): string | undefined {
  return LOGIN_COMMANDS[engineId];
}
