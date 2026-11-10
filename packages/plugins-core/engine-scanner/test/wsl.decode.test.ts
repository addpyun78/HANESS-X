import { describe, expect, it } from 'vitest';
import { decodeWslOutput, listWslDistros, parseWslDistros } from '@harness-x/engine-scanner';
import { mockExec, ok } from './helpers.js';

/** wsl.exe -l -q 실제 출력 형태: UTF-16LE, CRLF, (버전에 따라) BOM */
function utf16(text: string, bom = false): Buffer {
  const body = Buffer.from(text, 'utf16le');
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
}

describe('11.1 wsl -l -q UTF-16LE 디코딩', () => {
  it('샘플 바이트(BOM 없음) → 배포판 목록', () => {
    // 실제 wsl.exe 출력에서 채취한 바이트: "Ubuntu\r\n"
    const sample = Buffer.from([0x55, 0, 0x62, 0, 0x75, 0, 0x6e, 0, 0x74, 0, 0x75, 0, 0x0d, 0, 0x0a, 0]);
    expect(decodeWslOutput(sample)).toBe('Ubuntu\r\n');
    expect(parseWslDistros(sample)).toEqual(['Ubuntu']);
  });

  it('BOM·여러 배포판·빈 줄·docker 내부 배포판 처리', () => {
    const buf = utf16('Ubuntu-24.04\r\nDebian\r\n\r\ndocker-desktop\r\nkali-linux\r\n', true);
    expect(parseWslDistros(buf)).toEqual(['Ubuntu-24.04', 'Debian', 'kali-linux']);
    expect(parseWslDistros(buf, { includeInternal: true })).toContain('docker-desktop');
  });

  it('UTF-8로 와도(WSL_UTF8=1) 디코딩', () => {
    expect(parseWslDistros(Buffer.from('Ubuntu\nDebian\n'))).toEqual(['Ubuntu', 'Debian']);
  });

  it('listWslDistros: wsl.exe -l -q 호출, 실패하면 빈 목록', async () => {
    const { exec, calls } = mockExec({ 'wsl.exe -l -q': ok(utf16('Ubuntu\r\nDebian\r\n')) });
    expect(await listWslDistros({ exec })).toEqual(['Ubuntu', 'Debian']);
    expect(calls[0]).toMatchObject({ file: 'wsl.exe', args: ['-l', '-q'] });
    expect(await listWslDistros({ exec: mockExec({}).exec })).toEqual([]);
  });
});
