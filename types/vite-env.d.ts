// import.meta.env (웹 앱은 vite/client가 선언 — tsconfig.test.json 단독 검사용, T-101 0C.3)
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
