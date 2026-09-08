# 💰 은행 입금 자동 감지 → 월세 자동 체크 설계안 (안건)

**상태**: 검토 중 (미승인) · **일자**: 2026-09-07 · **방안**: B (감지 앱 + Workers 백엔드 + rental-web 연동)

## 1. 배경 및 목표

세입자가 지정된 계좌에 월세/관리비를 입금하면, 은행 앱의 입금 푸시 알림을 감지해서
rental-web의 해당 세입자·해당 월 납부 기록을 **자동으로 완납 체크**한다.

- 브라우저 앱(rental-web)은 다른 앱의 알림에 접근 불가 → 감지는 **별도 Android 앱** 필수
- 기존 자산 재사용: **kakao-digest**(알림 가로채기) + **yadonghaja-sync**(Workers 백엔드) 패턴

## 2. 아키텍처

```
[은행 앱 푸시 알림]                        (예: "국민 101* 김철수 500,000원 입금")
        │
        ▼
① 감지 앱 (Android, NotificationListenerService)
        │  - kakao-digest 패턴 재사용 (GitHub Actions로 APK 빌드)
        │  - 정규식 파싱: 발신자명 / 금액 / 입금 계좌 식별자
        │  - 내 계좌 식별자와 일치하는 입금만 전송 (다른 알림 무시)
        ▼
② Cloudflare Workers 백엔드 (D1)
        │  - POST /api/deposits  (감지 앱이 호출, x-user 인증 — yadonghaja 패턴)
        │  - GET  /api/deposits  (rental-web이 호출)
        │  - deposits 테이블: id, detected_at, sender_name, amount, account_hint, raw_title
        ▼
③ rental-web (브라우저)
           - 설정: 감지 백엔드 URL + 사용자 키 (localStorage)
           - 통계/건물 화면 진입 시 GET /api/deposits
           - 매칭 엔진: 입금 ↔ 세입자 (아래 5절)
           - 매칭 성공 → 해당 월 rentPaid/mgmtPaid upsert (paid:true) + 처리표시
```

## 3. 구성 요소

### ① 감지 앱 (`deposit-digest`)
- NotificationListenerService로 은행 앱 알림 수신 (은행 앱 패키지명 화이트리스트)
- 알림 텍스트에서 정규식으로 **발신자명, 금액** 추출 (은행별 형식 → 설정 파일로 관리)
- 백엔드로 HTTP POST (실패 시 로컬 큐잉 후 재시도)
- kakao-digest의 3초 자동 제거/CI 빌드 패턴은 그대로, 전송 대상만 Telegram → Workers

### ② Workers 백엔드 (`deposit-sync`)
- Cloudflare Workers + D1 (proot에서 workerd 불가 → GitHub Actions 배포, yadonghaja 패턴)
- 인증: `x-user` 헤더 (감지 앱과 rental-web 양쪽에 동일 키 설정)
- 저장: 원본 알림 텍스트도 보관(사후 검증용), 처리 여부 플래그는 rental-web이 체크

### ③ rental-web 연동
- 설정 화면(또는 통계 페이지 상단): 백엔드 URL + 키 입력 → localStorage
- `fetchDeposits()`: 최근 입금 목록 조회 → 매칭 → 자동 체크
- 매칭 기록은 납부기록에 `auto: true` 마커 + 기록 목록에 감지 원문 표시(검증용)
- 백엔드 장애 시: 기존 수동 체크 동작에 영향 없음 (graceful degradation)

## 4. 데이터 모델 (D1)

```sql
CREATE TABLE deposits (
  id TEXT PRIMARY KEY,
  detected_at TEXT NOT NULL,   -- 알림 감지 시각 ISO
  month TEXT NOT NULL,        -- YYYY-MM (감지 시각 기준)
  sender_name TEXT,            -- 파싱된 발신자명
  amount INTEGER NOT NULL,    -- 원 단위
  account_hint TEXT,          -- 내 계좌 식별자 (마스킹된 번호)
  raw_title TEXT,             -- 알림 원본 텍스트
  consumed INTEGER DEFAULT 0  -- rental-web이 반영했으면 1
);
```

## 5. 매칭 규칙 (핵심)

입금 1건을 여러 세입자가 공유 호실일 수 있으므로 순차 판정:

1. **금액 정확 매칭**: 입금액 == 세입자의 월세(rent×10,000) → 해당 월 월세 체크
2. **금액 정확 매칭**: 입금액 == 관리비(mgmt×10,000) → 해당 월 관리비 체크
3. **합계 매칭**: 입금액 == 월세+관리비 → 둘 다 체크
4. **발신자명 보조**: 이름이 세입자명과 일치/포함하면 신뢰도 상승 —
   금액만으로 애매한 경우(같은 월세 여러 명) 이름으로 좁힘
5. **미매칭 입금**: "감지되었지만 자동 체크 못 함" 목록에 표시 → 사용자가 1탭 수동 체크

> ⚠️ 자동 체크는 **확정 매칭(1~3)만** 수행한다. 애매하면 자동화하지 않고 목록만 노출.
> (잘못 체크하면 미납 관리가 꼬이므로 보수적으로)

## 6. 보안

- 계좌번호 전체를 저장하지 않음 (마스킹 식별자만)
- Workers는 `x-user` 키 인증 (yadonghaja-sync 검증 패턴)
- 알림 원문(raw_title)은 사후 검증용으로만, 백업 JSON에는 기본 미포함

## 7. 단계별 계획

| 단계 | 내용 | 산출물 |
|------|------|--------|
| P0 | 은행 앱 알림 형식 확정 (사용자 협의 필수) | 알림 샘플 텍스트 |
| P1 | Workers 백엔드 (D1 스키마 + 2 API) | 배포된 deposit-sync |
| P2 | 감지 앱 (kakao-digest 포크, 파싱+전송) | GitHub Actions APK |
| P3 | rental-web fetch + 매칭 + 자동체크 | OnDev 재배포 |
| P4 | 현장 검증 (실제 입금 알림으로 E2E) | QA 기록 |

## 8. 확인 필요 사항 (구축 시작 전)

1. **어떤 은행 앱?** (KB국민, 신한, 우리, 토스 등 — 알림 형식이 은행마다 다름)
2. **입금 알림 샘플 텍스트 2~3건** (실제 알림에서 발신자/금액 위치 확인)
3. **감지 대상 계좌**: 1개? 여러 개?
4. **매칭 실패 입금 처리**: 목록 노출 후 수동 체크로 충분한지, Telegram 알림도 원하는지
5. 월세 입금일이 아닌 다른 날짜 입금(선입금 등)도 해당 월로 체크할지