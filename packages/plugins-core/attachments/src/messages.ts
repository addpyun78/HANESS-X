/** 사용자에게 보이는 첨부 안내 문구 (쉬운 말 검사기 통과 — 테스트가 전부 검사한다) */
export const MESSAGES = {
  fileTooBig: (mb: number) => `파일이 너무 커요. 한 파일은 ${mb}MB까지 넣을 수 있어요.`,
  batchTooBig: (mb: number) => `한 번에 너무 많이 넣었어요. 한 번에 ${formatMB(mb)}까지 넣을 수 있어요.`,
  noProject: '어디서 작업할까요? 먼저 프로젝트 폴더를 골라 주세요.',
  convertFailed: '내용을 바꾸지 못했어요. 원본 파일은 그대로 보낼 수 있어요.',
  scannedPdf: '글자가 거의 없는 PDF예요. 스캔한 종이 같아요.',
  ocrMissing: '글자 인식 도구가 없어서 페이지 그림으로만 보내요.',
  ocrDone: '페이지 그림에서 글자를 읽어 왔어요.',
  hwpToolMissing: 'HWP 파일을 읽을 도구가 없어요. 도구 찾기에서 골라 주세요.',
  videoToolMissing: '동영상을 나눌 도구가 없어요. 도구 찾기에서 골라 주세요.',
  sttMissing: '받아쓰기 도구가 없어서 소리 내용을 못 읽었어요.',
  exifRemoved: '사진에 있던 위치 정보를 지웠어요.',
  thumbnailSkipped: '줄인 그림을 만들 도구가 없어서 원본만 보내요.',
  archiveListOnly: '압축 파일은 안의 파일 목록만 보여 드려요. 풀려면 말씀해 주세요.',
  archiveNeedsTool: '이 압축 형식은 목록을 읽을 도구가 없어요.',
  archiveUnsafePath: '폴더 밖으로 나가는 파일이 들어 있어서 풀지 않았어요.',
  archiveBomb: '풀면 너무 커지는 압축 파일이라 풀지 않았어요.',
  archiveTooMany: '안에 파일이 너무 많아서 풀지 않았어요.',
  folderTooMany: (n: number) => `파일이 많아요(${n}개). 다 넣을까요?`,
  unknownFile: '내용은 읽을 수 없어요. 이름과 크기, 형식만 보내요.',
  notExecuted: '실행하지 않고 내용만 봐요.',
  secretFound: '비밀번호나 키가 들어 있어요.',
  secretMasked: '비밀번호와 키를 가리고 보내요.',
  secretSentAsIs: '비밀번호나 키가 들어 있는 채로 보내요.',
} as const;

export const SECRET_CHOICE_LABELS = {
  mask: '가리고 보내기(추천)',
  send: '그대로 보내기',
  remove: '빼기',
} as const;

export function formatMB(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024}GB` : `${mb}MB`;
}
