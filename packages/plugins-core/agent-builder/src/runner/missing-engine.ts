/**
 * T-101 5D.6 고정 엔진이 나중에 없어졌을 때 실행 중 카드:
 * "이 단계의 AI(agy)를 못 찾았어요. 메인 AI로 대신할까요?" [메인 AI로 대신하기] [멈추기]
 */

export const MISSING_ENGINE_KIND = 'engine.missing';
export const MAIN_ENGINE_REF = 'main';

export type MissingEngineChoice = 'use-main' | 'stop';

export interface MissingEngineCard {
  kind: typeof MISSING_ENGINE_KIND;
  nodeId: string;
  engineId: string;
  /** 대신 쓸 메인 AI 엔진 (없으면 undefined — 카드에 대신하기 버튼이 없다) */
  mainEngine: string | undefined;
  title: string;
  options: { id: MissingEngineChoice; label: string }[];
}

export function missingEngineCard(
  nodeId: string,
  engineId: string,
  mainEngine: string | undefined,
): MissingEngineCard {
  return {
    kind: MISSING_ENGINE_KIND,
    nodeId,
    engineId,
    mainEngine,
    title: mainEngine
      ? `이 단계의 AI(${engineId})를 못 찾았어요. 메인 AI로 대신할까요?`
      : `이 단계의 AI(${engineId})를 못 찾았어요.`,
    options: [
      ...(mainEngine ? [{ id: 'use-main' as const, label: '메인 AI로 대신하기' }] : []),
      { id: 'stop', label: '멈추기' },
    ],
  };
}
