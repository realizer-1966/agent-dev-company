# ohaeng-assets — 오행 자산 진단기 (FEAAS 1단계 MVP)

보유 자산을 오행 5자산군으로 분류·점수화하고, 포트폴리오의 오행 분포·균형도(EBI)를 진단하며,
경제 국면 프리셋(A~E)에 따른 목표 배분 제안과 리밸런싱 힌트를 제공하는 한국어 단일 페이지 정적 웹앱.

- **FEAAS**: Five Elements AI Asset Allocation System — 운용 기간 3~5년 중장기, 균형 성장형
- 철학: "자산을 예측하는 것이 아니라 경제의 변화를 예측하고, 경제의 변화에 맞춰 자산의 균형을 조절한다."
- **유일 근거문서**: [`docs/requirements.md`](docs/requirements.md) (v2.0) — 이 README는 그 요약이다
- v2 아이디어(실시간 경제데이터·ML 예측·백테스트·자동 리밸런싱·Python/DB 스택)는 MVP에 포함 금지 — [`docs/v2-ideas.md`](docs/v2-ideas.md) 기록 전용

## 실행 방법

빌드 도구·서버 불필요. 브라우저에서 바로 연다:

```bash
# 방법 1 — 파일 직접 열기
open projects/ohaeng-assets/index.html          # macOS
xdg-open projects/ohaeng-assets/index.html      # Linux

# 방법 2 — 정적 서버(선택, 동일 결과)
cd projects/ohaeng-assets && python3 -m http.server 8000
# → http://localhost:8000 접속
```

UI 바인딩·계산 연결은 후속 UI 티켓 예정이며, 현재 index.html은 섹션 구조·고지 문구 3종·Gold=金 노트를 갖춘 뼈대다.

## 테스트 방법

Node 22 내장 러너(`node --test`)만 사용 — 외부 의존성 0, 라이브러리 설치 없음:

```bash
cd projects/ohaeng-assets
node --test "tests/**/*.test.js"   # 또는: npm test
```

- `tests/structure.test.js` — 러너·Node 버전 구조 확인(플레이스홀더)
- `tests/skeleton.test.js` — 골격 계약 테스트: 코어 7모듈의 export 시그니처 존재성, 데이터 상수 형상(키 완전성·합 100·허용 범위 내), 스텁이 TODO 에러로 거부하는지
- 실제 수치·행위 케이스(req 9장 수용기준)는 후속 코어 엔진 TDD 티켓이 RED→GREEN으로 채운다

## 구조

```
projects/ohaeng-assets/
├── index.html            # 한국어 단일 페이지 정적 진단기 (뼈대)
├── src/                  # 코어 로직 — UI와 분리된 순수 ES 모듈 (req 8장)
│   ├── vectors.js        # 유형별 기본 5요소 벡터 상수 (req 6장, Gold=金 반영)
│   ├── classify.js       # 유형 분류: 투자 대상 → 오행 자산군 (req 2장)
│   ├── weighted.js       # 금액 가중 평균 → 포트폴리오 오행 분포 (req 6장)
│   ├── ebi.js            # EBI 균형도 0~100 (req 7장, 정의 문서화)
│   ├── regimeShift.js    # 국면 프리셋→목표 배분 시프트 (req 3·4장, clamp·합 100 보정)
│   ├── rebalance.js      # 리밸런싱 제안 (±5%p 트리거, req 7장)
│   ├── circulate.js      # 상생 매핑 상수 木→火→土→金→水 (req 5장)
│   └── index.js          # barrel — UI는 이 모듈만 import, 계산 재구현 금지
├── tests/                # node --test (Node 22 내장 러너)
├── docs/
│   ├── requirements.md   # 유일 근거문서 v2.0
│   └── v2-ideas.md       # v2 기록 전용 (MVP 금지 항목)
└── package.json          # 테스트 실행 안내 수준 (의존성 0)
```

## 코어 규칙 (데이터 상수 요약 — 근거는 requirements.md)

| 항목 | 값 | 근거 |
|---|---|---|
| 기준 배분 | 木30 · 火10 · 土20 · 金25 · 水15 (합 100) | req 3장 |
| 허용 범위 | 木20~40 · 火5~15 · 土10~30 · 金20~35 · 水10~30 | req 3장 |
| 국면 프리셋 | A 성장 확장기 · B 인플레이션 상승기 · C 실물경제 안정기 · D 금융 불안기 · E 유동성 회복기 (E는 수→목 이동 방향) | req 4장 |
| 리밸런싱 트리거 | \|현재−목표\| ≥ 5%p만 이동 제안 (4.99%는 제안 없음) | req 7장 |
| Gold 분류 | 금(Gold)·은(Silver)은 **金** — v1의 火 배치 폐기 | req 0.1·2장 (v2.0) |

## EBI(균형도 지수) 정의 — req 7장

EBI(Energy Balance Index)는 0~100의 균형도 지수다. 5오행 분포가 기준 배분(木30/火10/土20/金25/水15)에
가까울수록 100에 가깝고, 단일 오행 100% 집중이면 최저에 가까운 값을 낸다. 기준 배분과 완전히 동일하면
최대값(100)이다. 구체 산식은 코어 엔진 TDD 티켓에서 수용기준 6번(경계 테스트)과 함께 확정·구현한다.

## 구현 상태 (티켓 ① 스캐폴딩)

- 코어 7모듈 + barrel의 **경계·시그니처 확정 완료**. 계산 함수 본문은 전부 스텁이며,
  호출 시 `TODO(t_27551fb2)` 메시지의 에러로 거부한다(조용한 undefined 방지).
- `src/*` 데이터 상수(ASSET_TYPES 기본 벡터·기준 배분·허용 범위·국면 프리셋·상생 매핑)는 확정 값이며
  골격 계약 테스트로 형상이 고정돼 있다.
- 함수 본문(코어 엔진 TDD) → UI 바인딩 → QA → Cloudflare Pages 배포는 후속 티켓.