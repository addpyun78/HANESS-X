import { useState } from 'react';
import { errorMessage } from '../form/api.js';
import { downloadText, type SettingsExtrasApi } from './api.js';

/**
 * T-101 6C.3 설정 내보내기/가져오기 `settings.yaml` (키 제외). 가져올 때 서버가 모든 값을 먼저 검사하고,
 * 하나라도 틀리면 아무것도 바꾸지 않은 채 쉬운 말 목록을 돌려준다.
 */

export interface TransferSectionProps {
  extras: Pick<SettingsExtrasApi, 'exportYaml' | 'importYaml'>;
  download?: (file: string, text: string) => void;
  /** 가져온 뒤 (화면 다시 읽기) */
  onImported?: () => void;
}

function readText(f: Blob): Promise<string> {
  if (typeof f.text === 'function') return f.text();
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result ?? ''));
    r.onerror = () => fail(r.error);
    r.readAsText(f);
  });
}

export function TransferSection({ extras, download = downloadText, onImported }: TransferSectionProps) {
  const [msg, setMsg] = useState<string>();
  const [issues, setIssues] = useState<{ key: string; message: string }[]>([]);

  const importText = async (text: string) => {
    setIssues([]);
    try {
      const r = await extras.importYaml(text);
      setMsg(`설정 ${r.imported.length}개를 가져왔어요.`);
      onImported?.();
    } catch (e) {
      const body = (e as { body?: { issues?: { key: string; message: string }[] } }).body;
      setIssues(body?.issues ?? []);
      setMsg(errorMessage(e));
    }
  };

  return (
    <section className="hx-settings-screen__card" aria-label="설정 파일">
      <h3>설정 파일</h3>
      <p>설정을 settings.yaml 파일로 내보내거나 가져와요. 키는 파일에 넣지 않아요.</p>
      <div className="hx-settings-screen__row">
        <button
          type="button"
          data-action="settings.export"
          onClick={() =>
            void extras
              .exportYaml()
              .then((r) => {
                download(r.file, r.text);
                setIssues([]);
                setMsg('settings.yaml 파일로 내보냈어요.');
              })
              .catch((e: unknown) => setMsg(errorMessage(e)))
          }
        >
          설정 내보내기
        </button>
        <label className="hx-settings-screen__file">
          설정 가져오기
          <input
            type="file"
            accept=".yaml,.yml,text/yaml"
            data-action="settings.import"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void readText(f).then(importText);
            }}
          />
        </label>
      </div>
      {msg && <p role="status">{msg}</p>}
      {issues.length > 0 && (
        <ul className="hx-settings-screen__issues" aria-label="고칠 값">
          {issues.map((i) => (
            <li key={i.key}>
              {i.key ? <code>{i.key}</code> : null} {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
