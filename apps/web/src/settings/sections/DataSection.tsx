import { useCallback, useEffect, useState } from 'react';
import { errorMessage, type SettingsApi } from '../form/api.js';
import type { SettingsExtrasApi } from './api.js';

/**
 * T-101 6B.11 설정 > 데이터·보안 탭의 덧붙임 화면
 *  - 저장된 키 목록: 키체인에 있는 키만, 가린 값(끝 4자)으로. 원래 값은 서버가 화면에 보내지 않는다. [지우기]
 *  - [지금 정리하기]: 보관 기간·첨부 정리 설정을 지금 적용
 */

export interface EngineKeySource {
  /** GET /api/engines 의 keys + 엔진 이름 */
  list(): Promise<{ id: string; label: string; masked: string }[]>;
  remove(id: string): Promise<unknown>;
}

export interface DataSectionProps {
  api: SettingsApi;
  extras?: Pick<SettingsExtrasApi, 'cleanup'>;
  engineKeys?: EngineKeySource;
}

interface KeyRow {
  id: string;
  title: string;
  masked: string;
  remove: () => Promise<unknown>;
}

export function DataSection({ api, extras, engineKeys }: DataSectionProps) {
  const [rows, setRows] = useState<KeyRow[]>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  const load = useCallback(async () => {
    try {
      const r = await api.load();
      const own: KeyRow[] = r.fields
        .filter((f) => f.storage === 'keychain' && r.values[f.key]?.masked)
        .map((f) => ({
          id: f.key,
          title: f.title,
          masked: r.values[f.key]!.masked!,
          remove: () => api.deleteSecret(f.key),
        }));
      const eng: KeyRow[] = engineKeys
        ? (await engineKeys.list().catch(() => [])).map((k) => ({
            id: `engine:${k.id}`,
            title: `${k.label} 키`,
            masked: k.masked,
            remove: () => engineKeys.remove(k.id),
          }))
        : [];
      setRows([...eng, ...own]);
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e).replace('저장하지', '키 목록을 불러오지'));
    }
  }, [api, engineKeys]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <section className="hx-settings-screen__card" aria-label="저장된 키">
        <h3>저장된 키</h3>
        <p>키는 컴퓨터의 안전한 보관함에만 있어요. 여기에는 끝 네 글자만 보여요.</p>
        {error && <p role="alert">{error}</p>}
        {rows && rows.length === 0 && <p>저장된 키가 없어요.</p>}
        <ul className="hx-settings-screen__list">
          {rows?.map((k) => (
            <li key={k.id} className="hx-settings-screen__row" data-secret-id={k.id}>
              <span>
                {k.title} <code data-testid="secret-masked">{k.masked}</code>
              </span>
              <button
                type="button"
                data-action="settings.secret-delete"
                onClick={() =>
                  void k
                    .remove()
                    .then(load)
                    .catch((e: unknown) => setError(errorMessage(e)))
                }
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      </section>
      {extras && (
        <section className="hx-settings-screen__card" aria-label="기록 정리">
          <h3>기록 정리</h3>
          <p>위에서 정한 날수가 지난 기록과 첨부 사본을 지금 정리해요. 서버를 켤 때도 정리해요.</p>
          <div className="hx-settings-screen__row">
            <button
              type="button"
              data-action="settings.data-cleanup"
              onClick={() =>
                void extras
                  .cleanup()
                  .then((r) => setDone(`기록 ${r.logs}개, 첨부 ${r.attachments}개를 정리했어요.`))
                  .catch((e: unknown) => setDone(errorMessage(e).replace('저장하지', '정리하지')))
              }
            >
              지금 정리하기
            </button>
            {done && <span role="status">{done}</span>}
          </div>
        </section>
      )}
    </>
  );
}
