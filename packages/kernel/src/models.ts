import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  engineIdOfBin,
  ModelOptionSchema,
  type ModelInputs,
  type ModelOption,
  type ModelsResponse,
} from '@harness-x/protocol';
import { harnessHome } from './loader.js';

/**
 * T-101 5B 모델 목록 만들기 + 캐시.
 * 출처(5B.2): 엔진이 목록 기능을 주면 그것(Ollama /api/tags · OpenAI 호환 /v1/models — 스캐너가 이미 받아 둔 값,
 * Codex app-server 모델 목록 요청 — 어댑터 listModels), 없으면 엔진 플러그인의 기본 목록 + 사용자 추가 항목.
 * 상태 판정은 스캔 캐시(설치·버전·로그인 상태 명령 결과)만 본다 — 모델 호출 없음.
 */

/** 스캐너 캐시 모양 (커널은 스캐너 패키지에 의존하지 않으므로 구조적으로만 본다) */
export interface ModelScanLike {
  scannedAt?: string;
  engines: { name: string; status: string; version: string | null; error?: string; login?: string }[];
  localLlms?: unknown[];
}

interface LocalLlmLike {
  name: string;
  api?: string;
  models: string[];
}

/** 엔진 플러그인 기본 목록 (엔진이 목록 기능을 주지 않을 때). 'default' = 엔진 기본 모델 */
export const DEFAULT_ENGINE_MODELS: Readonly<Record<string, readonly string[]>> = {
  'claude-code': ['sonnet', 'opus', 'haiku'],
  codex: ['default'],
  antigravity: ['default'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
};

const ENGINE_LABEL: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  gemini: 'Gemini CLI',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  llamacpp: 'llama.cpp',
  vllm: 'vLLM',
  jan: 'Jan',
};
export const modelEngineLabel = (id: string): string => ENGINE_LABEL[id] ?? id;

const NONE: ModelInputs = { image: false, pdf: false, audio: false };
/** 엔진별로 넘길 수 있는 입력 (첨부 안내 문구·이미지 가능 아이콘에 쓴다) */
const ENGINE_INPUTS: Readonly<Record<string, ModelInputs>> = {
  'claude-code': { image: true, pdf: true, audio: false },
  codex: { image: true, pdf: false, audio: false },
  antigravity: { image: true, pdf: true, audio: true },
  gemini: { image: true, pdf: true, audio: true },
};
const VISION_RE = /(llava|vision|[-_.]vl\b|vl[-_:]|gemma3|minicpm-v|moondream|bakllava|pixtral)/i;

export function inputsFor(engineId: string, modelId: string, local: boolean): ModelInputs {
  if (local) return { ...NONE, image: VISION_RE.test(modelId) };
  return ENGINE_INPUTS[engineId] ?? NONE;
}

export function modelDisplayName(modelId: string): string {
  if (modelId === 'default') return '기본 모델';
  return /^[a-z]+$/.test(modelId) ? modelId[0]!.toUpperCase() + modelId.slice(1) : modelId;
}

export interface UserModel {
  engineId: string;
  modelId: string;
  displayName?: string;
}

export interface BuildModelsOptions {
  /** engines-settings.yaml 인증 모드 (apiKey면 [API]) */
  authMode?: (engineId: string) => 'subscription' | 'apiKey' | undefined;
  /** 엔진이 준 모델 목록 (예: Codex app-server). 없거나 빈 배열이면 기본 목록 */
  engineModels?: Readonly<Record<string, readonly string[] | undefined>>;
  /** 엔진 플러그인 기본 목록 (기본 DEFAULT_ENGINE_MODELS) */
  defaults?: Readonly<Record<string, readonly string[]>>;
  /** 사용자 추가 항목 (settings.json models.custom) */
  userModels?: readonly UserModel[];
}

function isLocal(v: unknown): v is LocalLlmLike {
  const o = v as LocalLlmLike;
  return !!o && typeof o.name === 'string' && Array.isArray(o.models);
}

/** 스캔 캐시 → 모델 목록 (엔진별 묶음 순서 유지, 중복 제거) */
export function buildModelOptions(
  scan: ModelScanLike | null | undefined,
  o: BuildModelsOptions = {},
): ModelOption[] {
  const out: ModelOption[] = [];
  const seen = new Set<string>();
  const push = (m: ModelOption) => {
    const k = `${m.engineId}\u0000${m.modelId}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(ModelOptionSchema.parse(m));
  };
  // CLI 엔진: 같은 엔진이 여러 위치(Windows·WSL)에 있으면 준비된 쪽을 쓴다
  const engines = new Map<string, ModelOption['status']>();
  for (const e of scan?.engines ?? []) {
    const id = engineIdOfBin(e.name);
    const st: ModelOption['status'] =
      e.version === null && e.error && e.status === 'unknown'
        ? 'unavailable'
        : e.login === 'loggedOut'
          ? 'needs-login'
          : 'ready';
    const prev = engines.get(id);
    if (!prev || (prev !== 'ready' && st === 'ready')) engines.set(id, st);
  }
  const defaults = o.defaults ?? DEFAULT_ENGINE_MODELS;
  for (const [engineId, status] of engines) {
    const mode = o.authMode?.(engineId);
    const auth = mode === 'apiKey' ? ('api' as const) : ('subscription' as const);
    // API 키 모드면 구독 로그인 상태와 무관
    const st = auth === 'api' && status === 'needs-login' ? 'ready' : status;
    const fromEngine = o.engineModels?.[engineId];
    const list = fromEngine?.length ? fromEngine : (defaults[engineId] ?? ['default']);
    const source = fromEngine?.length ? ('engine' as const) : ('default' as const);
    for (const modelId of list)
      push({
        engineId,
        modelId,
        displayName: modelDisplayName(modelId),
        auth,
        inputs: inputsFor(engineId, modelId, false),
        status: st,
        engineLabel: modelEngineLabel(engineId),
        source,
      });
    for (const u of o.userModels ?? [])
      if (u.engineId === engineId)
        push({
          engineId,
          modelId: u.modelId,
          displayName: u.displayName ?? u.modelId,
          auth,
          inputs: inputsFor(engineId, u.modelId, false),
          status: st,
          engineLabel: modelEngineLabel(engineId),
          source: 'user',
        });
  }
  // 로컬 LLM 서버: 서버가 준 목록 (무료 로컬)
  for (const l of (scan?.localLlms ?? []).filter(isLocal)) {
    for (const modelId of l.models)
      push({
        engineId: l.name,
        modelId,
        displayName: modelId,
        auth: 'local',
        inputs: inputsFor(l.name, modelId, true),
        status: 'ready',
        engineLabel: modelEngineLabel(l.name),
        source: 'local-server',
      });
    for (const u of o.userModels ?? [])
      if (u.engineId === l.name)
        push({
          engineId: l.name,
          modelId: u.modelId,
          displayName: u.displayName ?? u.modelId,
          auth: 'local',
          inputs: inputsFor(l.name, u.modelId, true),
          status: 'ready',
          engineLabel: modelEngineLabel(l.name),
          source: 'user',
        });
  }
  return out;
}

/** 어댑터가 모델 목록 기능을 주는지 (구조적으로) */
export interface ModelListingAdapter {
  id: string;
  listModels?(opts: { cwd: string }): Promise<string[]>;
}

export interface ModelCatalogOptions {
  scan: () => ModelScanLike | null | Promise<ModelScanLike | null>;
  adapters?: () => readonly ModelListingAdapter[];
  authMode?: BuildModelsOptions['authMode'];
  userModels?: () => readonly UserModel[];
  /** 기본 <home>/models.json */
  cacheFile?: string;
  cwd?: string;
  /** 엔진별 목록 요청 제한 (기본 5초) */
  listTimeoutMs?: number;
}

export function defaultModelsCacheFile(): string {
  return join(harnessHome(), 'models.json');
}

function readModelsCache(file: string): ModelsResponse | null {
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as ModelsResponse;
    return Array.isArray(v.models)
      ? { models: v.models.map((m) => ModelOptionSchema.parse(m)), scannedAt: v.scannedAt ?? null }
      : null;
  } catch {
    return null;
  }
}

/**
 * 5B.3 모델 목록 캐시: 스캔 시각이 같으면 다시 만들지 않고, 재스캔(scannedAt 변경) 때 갱신한다.
 * 엔진이 준 목록(어댑터 listModels)은 재스캔 때만 다시 묻는다. 파일(models.json)에도 남겨 다음 시작 때 바로 보여 준다
 */
export class ModelCatalog {
  private cached: ModelsResponse | null;
  private building: Promise<ModelsResponse> | undefined;
  readonly cacheFile: string;

  constructor(private readonly o: ModelCatalogOptions) {
    this.cacheFile = o.cacheFile ?? defaultModelsCacheFile();
    this.cached = readModelsCache(this.cacheFile);
  }

  /** 마지막으로 만든 목록 (없으면 null) — 기다리지 않는다 */
  peek(): ModelsResponse | null {
    return this.cached;
  }

  async get(): Promise<ModelsResponse> {
    const scan = await this.o.scan();
    const at = scan?.scannedAt ?? null;
    if (this.cached && this.cached.scannedAt === at) return this.cached;
    this.building ??= this.build(scan).finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  private async listFromEngines(): Promise<Record<string, string[]>> {
    const ms = this.o.listTimeoutMs ?? 5_000;
    const out: Record<string, string[]> = {};
    await Promise.all(
      (this.o.adapters?.() ?? [])
        .filter((a) => typeof a.listModels === 'function')
        .map(async (a) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const list = await Promise.race([
            a.listModels!({ cwd: this.o.cwd ?? process.cwd() }).catch(() => [] as string[]),
            new Promise<string[]>((r) => {
              timer = setTimeout(() => r([]), ms);
              (timer as { unref?: () => void }).unref?.();
            }),
          ]).finally(() => clearTimeout(timer));
          if (list.length) out[a.id] = list;
        }),
    );
    return out;
  }

  private async build(scan: ModelScanLike | null): Promise<ModelsResponse> {
    const installed = new Set((scan?.engines ?? []).map((e) => engineIdOfBin(e.name)));
    const engineModels = installed.size ? await this.listFromEngines() : {};
    const models = buildModelOptions(scan, {
      engineModels,
      ...(this.o.authMode ? { authMode: this.o.authMode } : {}),
      ...(this.o.userModels ? { userModels: this.o.userModels() } : {}),
    });
    const res: ModelsResponse = { models, scannedAt: scan?.scannedAt ?? null };
    this.cached = res;
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(res, null, 2) + '\n');
      renameSync(tmp, this.cacheFile);
    } catch {
      /* 캐시 기록 실패는 목록 응답을 막지 않는다 */
    }
    return res;
  }
}
