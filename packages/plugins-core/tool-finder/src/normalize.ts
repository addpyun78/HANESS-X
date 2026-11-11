import { trustLevel } from '@harness-x/installer';
import { candidateKey, ToolCandidateSchema, type ToolCandidate } from './candidate.js';
import { decidePricing } from './pricing.js';
import type { RawHit } from './providers/types.js';

/**
 * P3-B.4 공급자 결과(RawHit) → ToolCandidate.
 * 출처 주소가 없으면 후보로 쓰지 않는다(B.5: 모든 pricing에 sourceUrl 필수).
 */
export function rawToCandidate(hit: RawHit, now: Date): ToolCandidate | undefined {
  const pricing = decidePricing(hit, now);
  if (!pricing || !hit.name.trim()) return undefined;
  const kind = hit.installMethod?.kind ?? 'direct-download';
  const trust = trustLevel({
    kind,
    ...(hit.verifiedPublisher ? { verifiedPublisher: true } : {}),
    // 저장소 정보는 패키지 저장소가 유지보수 날짜를 줄 때만 기준표에 넣는다
    ...(hit.packageRepo && (hit.lastRelease || hit.archived)
      ? {
          repo: {
            license: hit.license ?? '',
            archived: hit.archived ?? false,
            ...(hit.lastRelease ? { pushedAt: hit.lastRelease } : {}),
          },
        }
      : {}),
    now,
  });
  return ToolCandidateSchema.parse({
    id: candidateKey(hit.name),
    name: hit.name.trim(),
    summary: hit.summary.trim(),
    pricing,
    license: hit.license?.trim() || 'unknown',
    officialUrl: hit.officialUrl,
    installMethods: hit.installMethod ? [hit.installMethod] : [],
    os: hit.os ?? [],
    maintenance: { lastRelease: hit.lastRelease ?? null, archived: hit.archived ?? false },
    trust,
    pros: [],
    cons: [],
    sources: [hit.providerId],
  });
}

/** 여러 결과를 한 번에 (출처 없는 결과는 버린다) */
export function normalizeHits(hits: readonly RawHit[], now: Date): ToolCandidate[] {
  return hits.flatMap((h) => {
    const c = rawToCandidate(h, now);
    return c ? [c] : [];
  });
}
