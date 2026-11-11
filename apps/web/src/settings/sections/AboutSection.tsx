import { useEffect, useState } from 'react';
import { errorMessage } from '../form/api.js';
import { downloadText, type SettingsExtrasApi } from './api.js';

/**
 * T-101 6B.13 설정 > 정보 탭: 버전 / [업데이트 확인] / [진단 파일 내보내기](키·첨부 내용 제외 — 서버가 만들고 키 모양 글자를 가림)
 */

export interface AboutSectionProps {
  extras: Pick<SettingsExtrasApi, 'about' | 'updateCheck' | 'diagnostics'>;
  /** 파일 내려받기 (기본: 브라우저 내려받기) */
  download?: (file: string, text: string) => void;
}

export function AboutSection({ extras, download = downloadText }: AboutSectionProps) {
  const [about, setAbout] = useState<{ version: string; platform: string; node: string }>();
  const [update, setUpdate] = useState<string>();
  const [diag, setDiag] = useState<string>();

  useEffect(() => {
    let live = true;
    extras.about().then(
      (a) => live && setAbout(a),
      () => live && setAbout(undefined),
    );
    return () => {
      live = false;
    };
  }, [extras]);

  return (
    <section className="hx-settings-screen__card" aria-label="하네스 정보">
      <h3>HARNESS-X</h3>
      <dl className="hx-settings-screen__about">
        <dt>버전</dt>
        <dd data-testid="about-version">{about?.version ?? '확인하는 중…'}</dd>
        {about && (
          <>
            <dt>운영체제</dt>
            <dd>{about.platform}</dd>
          </>
        )}
      </dl>
      <div className="hx-settings-screen__row">
        <button
          type="button"
          data-action="settings.update-check"
          onClick={() =>
            void extras
              .updateCheck()
              .then((r) => setUpdate(r.message))
              .catch((e: unknown) => setUpdate(errorMessage(e).replace('저장하지', '확인하지')))
          }
        >
          업데이트 확인
        </button>
        {update && <span role="status">{update}</span>}
      </div>
      <div className="hx-settings-screen__row">
        <button
          type="button"
          data-action="settings.diagnostics"
          onClick={() =>
            void extras
              .diagnostics()
              .then((r) => {
                download(r.file, r.text);
                setDiag('진단 파일을 내려받았어요. 키와 첨부 내용은 들어 있지 않아요.');
              })
              .catch((e: unknown) => setDiag(errorMessage(e).replace('저장하지', '만들지')))
          }
        >
          진단 파일 내보내기
        </button>
        {diag && <span role="status">{diag}</span>}
      </div>
    </section>
  );
}
