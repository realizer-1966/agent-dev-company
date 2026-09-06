// bun:sqlite 스텁 — Workers 런타임에서는 D1 바인딩을 사용하므로
// 이 모듈은 번들 만족용이며 실제로 로드되면 안 된다.
export const Database = class {
  constructor() {
    throw new Error("bun:sqlite is not available in Cloudflare Workers runtime");
  }
};
