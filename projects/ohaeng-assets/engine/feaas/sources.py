"""데이터 소스 계층 — FRED·Stooq CSV fetcher(+로컬 캐시, retry).

req-v2 §0·§1: 네트워크·파일시스템 접근은 이 모듈로 격리한다 — feaas의 다른 모듈과
tests는 순수 함수만 다루며, 실측 fetch는 별도 스모크(req-v2 §5.4)로 검증한다.

- FRED: https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>  (키 불필요 — 실측 200)
- Stooq: https://stooq.com/q/d/l/?s=<sym>&i=d

계약(② 구현 티켓이 본문을 채운다):
- 헤더 변형 2종을 모두 수용: 실측 `observation_date,<ID>`(2026-11-02 DGS10·VIXCLS·
  UNRATE 실측)과 문서 포맷 `DATE,<ID>`(req-v2 §0·티켓 명시, 구 FRED 응답).
- 결측 마커 `.`(문서 포맷)과 빈 문자열(실측 포맷)을 전부 None으로 정규화.
- retry: 기본 2회(req-v2 §5.4 재시도 2회 후 실패 명확 보고·아카이브). 외부 API 키
  미사용(req-v2 §0 — 없는 것으로 설계).
- fixture: engine/data/fixtures/*.csv — README 「FEAAS v2a」 섹션의 포맷 명세 참조.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

FRED_BASE_URL: str = "https://fred.stlouisfed.org/graph/fredgraph.csv"
STOOQ_BASE_URL: str = "https://stooq.com/q/d/l/"

# 날짜 "YYYY-MM-DD" + 값(float) | 결측(None) — 날짜 오름차순 정렬 보장은 ②가 검증.
DateValue = tuple[str, "float | None"]
Series = list[DateValue]


def parse_fred_csv(text: str) -> Series:
    """fredgraph.csv 본문 → [(date, value|None), ...].

    헤더 첫 열은 DATE 또는 observation_date, 둘째 열은 시리즈 ID. 결측 `.`·빈 문자열 →
    None. 정합성 어긋난 행은 ② 구현 시 명확한 예외(ValueError)로 보고한다.
    """
    raise NotImplementedError("② 구현 티켓 — feaas.sources.parse_fred_csv (fixture 계약)")


def build_fred_url(
    series_id: str, start: str | None = None, end: str | None = None
) -> str:
    """fredgraph.csv URL 구성(순수) — start/end는 cosd·coed 파라미터로 반영."""
    raise NotImplementedError("② 구현 티켓 — feaas.sources.build_fred_url")


def build_stooq_url(symbol: str, *, interval: str = "d") -> str:
    """stooq CSV 다운로드 URL 구성(순수) — ?s=<symbol>&i=<interval>."""
    raise NotImplementedError("② 구현 티켓 — feaas.sources.build_stooq_url")


def fetch_fred(
    series_id: str,
    start: str | None = None,
    end: str | None = None,
    *,
    retries: int = 2,
    timeout: float = 10.0,
    cache_dir: Path | None = None,
    opener: Callable[..., object] | None = None,
) -> Series:
    """FRED 시리즈 실측 fetch — retry(기본 2회)·로컬 캐시 선택·opener 주입으로 테스트 가능.

    네트워크 격리 계약에 따라 프로젝트에서 HTTP를 치는 유일한 지점이다(req-v2 §1).
    """
    raise NotImplementedError("② 구현 티켓 — feaas.sources.fetch_fred (실측 스모크 대상)")


def fetch_stooq(
    symbol: str,
    *,
    interval: str = "d",
    retries: int = 2,
    timeout: float = 10.0,
    opener: Callable[..., object] | None = None,
) -> Series:
    """Stooq 일별 CSV 실측 fetch — 종가 시퀀스만 추출해 Series로 정규화(② 확정)."""
    raise NotImplementedError("② 구현 티켓 — feaas.sources.fetch_stooq (실측 스모크 대상)")


def load_cache(cache_dir: Path, series_id: str) -> Series | None:
    """캐시 히트 시 Series 반환, 미스 시 None — 파일 존재 검증·포맷 파싱은 ② 확정."""
    raise NotImplementedError("② 구현 티켓 — feaas.sources.load_cache")


def save_cache(cache_dir: Path, series_id: str, rows: Series) -> Path:
    """캐시 저장(원자적 쓰기 여부·파일명 규칙은 ② 확정) — 저장 경로 반환."""
    raise NotImplementedError("② 구현 티켓 — feaas.sources.save_cache")