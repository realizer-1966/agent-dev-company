"""데이터 소스 계층 — FRED·Stooq CSV fetcher(+로컬 캐시, retry).

req-v2 §0·§1: 네트워크·파일시스템 접근은 이 모듈로 격리한다 — feaas의 다른 모듈과
tests는 순수 함수만 다루며, 실측 fetch는 별도 스모크(req-v2 §5.4)로 검증한다.

- FRED: https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>  (키 불필요 — 실측 200)
- Stooq: https://stooq.com/q/d/l/?s=<sym>&i=d

구현 계약(② — venv/tests 계약 고정):
- 헤더 변형 2종 모두 수용: 실측 `observation_date,<ID>`(2026-11-02 실측)와 문서 포맷
  `DATE,<ID>`(req-v2 §0). 결측 마커 `.`/빈 문자열/`null`/`NA`/`NaN`/`-` → None.
- retry: 기본 2회 → 총 3시도, 백오프 0.5s×2^(시도-1) (0.5s→1.0s). timeout 기본 30s.
- HTTP 상태(2xx 외)와 CSV 파싱 실패도 재시도 대상 실패로 간주한다 — 서버 일시 장애에서
  HTML 에러 본문을 조용히 받아들이지 않기 위함. 전부 실패하면
  FetchError(대상 시리즈 ID·총 시도 수·마지막 오류 포함)로 실패한다.
- 테스트 가능성: `opener(url, timeout)`·`sleep(seconds)` 주입 — 실제 기본값은
  urllib.request.urlopen·time.sleep. 실 fetch 유닛테스트 금지(req-v2 §1),
  네트워크 실측은 스모크에서.

캐시 정책 (engine/data/cache/ — ② 확정):
- 파일명: FRED `<ID>.csv` · Stooq `stooq-<symbol>-<interval>.csv` — **원본 응답 CSV 텍스트를
  그대로 보존**(재파싱 가능)하며 저장은 tmp 파일 → os.replace 원자적 쓰기.
- 히트: refresh=False(기본)이면 캐시 파일 존재 시 네트워크 호출 없이 파싱해 반환한다.
  start/end는 캐시에 저장하지 않고 메모리 필터로 반영한다(오프라인 재현 가능).
- refresh=True면 캐시가 있어도 네트워크로 재수집 후 캐시를 갱신한다.
- 캐시 파일이 손상(파싱 실패)되면 히트가 아니라 미스(None)로 취급하고 네트워크로 회복한다.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlencode

FRED_BASE_URL: str = "https://fred.stlouisfed.org/graph/fredgraph.csv"
STOOQ_BASE_URL: str = "https://stooq.com/q/d/l/"

DEFAULT_RETRIES: int = 2  # 재시도 2회 → 총 3시도 (req-v2 §5.4)
DEFAULT_TIMEOUT_SECONDS: float = 30.0  # 명시적 timeout(req-v2 티켓 — 예: 30s)
BASE_BACKOFF_SECONDS: float = 0.5  # 백오프 0.5s × 2^(시도-1) → 0.5s, 1.0s
_MISSING_MARKERS: frozenset[str] = frozenset({"", ".", "-", "null", "na", "n/a", "nan"})
_FRED_ID_RE = re.compile(r"[A-Za-z0-9_]+")
_STOOQ_SYMBOL_RE = re.compile(r"[A-Za-z0-9^_.=-]+")
_CACHE_SAFE_RE = re.compile(r"[^A-Za-z0-9^_.=-]+")
_DATE_COL_HEADERS = frozenset({"DATE", "observation_date"})

# 날짜 "YYYY-MM-DD" + 값(float) | 결측(None) — 날짜 오름차순 정렬 보장.
DateValue = tuple[str, "float | None"]
Series = list[DateValue]


class FetchError(RuntimeError):
    """네트워크 fetch 실패(전 시도 소진·HTTP 오류·CSV 파싱 실패) — 원인을 그대로 담는다."""


def _parse_value(raw: str, where: str) -> float | None:
    cell = raw.strip()
    if cell.lower() in _MISSING_MARKERS:
        return None
    try:
        return float(cell)
    except ValueError:
        raise ValueError(f"{where}: 수치 파싱 실패 {cell!r}") from None


def _require_fred_id(series_id: str) -> None:
    if not _FRED_ID_RE.fullmatch(series_id):
        raise ValueError(f"FRED ID 부적합: {series_id!r} — [A-Za-z0-9_]만 허용")


def _require_stooq_symbol(symbol: str) -> None:
    if not _STOOQ_SYMBOL_RE.fullmatch(symbol):
        raise ValueError(
            f"Stooq 심볼 부적합: {symbol!r} — 공백·쿼리 문자는 허용하지 않는다"
        )


def _iso_date(value: str, label: str):
    from datetime import date

    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label}: 날짜 형식은 YYYY-MM-DD: {value!r}") from None


def parse_fred_csv(text: str) -> Series:
    """fredgraph.csv 본문 → [(date, value|None), ...] (날짜 오름차순).

    헤더 첫 열은 DATE 또는 observation_date, 둘째 열은 시리즈 ID. 결측 `.`·빈 문자열·
    `null`/`NA`/`NaN`/`-` → None. 행(열 수·날짜·수치)이 계약을 어기면 ValueError.
    """
    import datetime

    lines = text.splitlines()
    if not lines or not lines[0].strip():
        raise ValueError("fredgraph.csv: 응답이 비었다")
    header = [c.strip() for c in lines[0].split(",")]
    if len(header) != 2:
        raise ValueError(f"fredgraph.csv: 헤더는 2열이어야 함: {lines[0]!r}")
    if header[0] not in _DATE_COL_HEADERS:
        raise ValueError(
            f"fredgraph.csv: 알 수 없는 날짜 열 {header[0]!r} — DATE|observation_date"
        )
    if not re.fullmatch(r"[A-Z0-9_]+", header[1]):
        raise ValueError(f"fredgraph.csv: 시리즈 ID 열 부적합: {header[1]!r}")

    rows: list[tuple[datetime.date, float | None]] = []
    for ln, line in enumerate(lines[1:], start=2):
        line = line.rstrip("\r")
        if not line.strip():
            continue  # 후행 빈 행
        fields = line.split(",")
        if len(fields) != 2:
            raise ValueError(f"fredgraph.csv {ln}행: 2열 필요: {line!r}")
        try:
            date = datetime.date.fromisoformat(fields[0].strip())
        except ValueError:
            raise ValueError(f"fredgraph.csv {ln}행: 날짜 형식 오류: {fields[0]!r}") from None
        rows.append((date, _parse_value(fields[1], f"fredgraph.csv {ln}행")))
    if not rows:
        raise ValueError("fredgraph.csv: 데이터 행 0건")
    rows.sort(key=lambda row: row[0])
    return [(d.isoformat(), v) for d, v in rows]


def parse_stooq_csv(text: str) -> Series:
    """stooq 일별 CSV 본문 → [(date, close|None), ...] (날짜 오름차순).

    헤더에 Date 열과 Close 열(이름 대조, 열 순서 무관 — Volume 유무 차이 수용)이 있어야
    하고, 결측 마커(fredgraph 규약 동일)는 None. 어기면 ValueError.
    """
    import datetime

    lines = text.splitlines()
    body_head = lines[0].strip() if lines else ""
    if not lines or not body_head:
        raise ValueError("stooq: 응답이 비었다")
    if body_head.lower().startswith("no data"):
        raise ValueError(f"stooq: 데이터 없음 응답: {body_head!r}")
    header = [c.strip().lower() for c in lines[0].split(",")]
    if header[0] != "date":
        raise ValueError(f"stooq: Date 헤더 열 없음: {lines[0]!r}")
    if "close" not in header:
        raise ValueError(f"stooq: Close 헤더 열 없음: {lines[0]!r}")
    close_idx = header.index("close")

    rows: list[tuple[datetime.date, float | None]] = []
    for ln, line in enumerate(lines[1:], start=2):
        line = line.rstrip("\r")
        if not line.strip():
            continue
        fields = line.split(",")
        if len(fields) < len(header):
            raise ValueError(f"stooq {ln}행: 열 수 부족: {line!r}")
        try:
            date = datetime.date.fromisoformat(fields[0].strip())
        except ValueError:
            raise ValueError(f"stooq {ln}행: 날짜 형식 오류: {fields[0]!r}") from None
        rows.append((date, _parse_value(fields[close_idx], f"stooq {ln}행")))
    if not rows:
        raise ValueError("stooq: 데이터 행 0건")
    rows.sort(key=lambda row: row[0])
    return [(d.isoformat(), v) for d, v in rows]


def build_fred_url(
    series_id: str, start: str | None = None, end: str | None = None
) -> str:
    """fredgraph.csv URL 구성(순수) — start/end는 cosd·coed 파라미터로 반영."""
    _require_fred_id(series_id)
    params: list[tuple[str, str]] = [("id", series_id)]
    if start:
        _iso_date(start, f"FRED start({series_id})")
        params.append(("cosd", start))
    if end:
        _iso_date(end, f"FRED end({series_id})")
        params.append(("coed", end))
    return f"{FRED_BASE_URL}?{urlencode(params)}"


def build_stooq_url(symbol: str, *, interval: str = "d") -> str:
    """stooq CSV 다운로드 URL 구성(순수) — ?s=<symbol>&i=<interval>."""
    _require_stooq_symbol(symbol)
    return f"{STOOQ_BASE_URL}?{urlencode({'s': symbol, 'i': interval})}"


def _download_with_retry(
    url: str,
    *,
    parse: Callable[[str], Series],
    context: str,
    retries: int,
    timeout: float,
    opener: Callable[..., object] | None,
    sleep: Callable[[float], None] | None,
) -> tuple[str, Series]:
    """총 retries+1 시도 — 성공 시 (원본 텍스트, 파싱 Series) 반환, 실패 시 FetchError."""
    open_url = opener if opener is not None else _urlopen
    wait = sleep if sleep is not None else time.sleep
    attempts = max(1, retries + 1)
    last_exc: Exception | None = None
    for attempt in range(attempts):
        if attempt > 0:
            wait(BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)))
        try:
            resp = open_url(url, timeout)
            body = resp.read()
            status = int(getattr(resp, "status", 200) or 0)
            if status >= 400:
                raise FetchError(f"HTTP {status}")
            text = body.decode("utf-8", errors="replace")
            series = parse(text)
            return text, series
        except Exception as exc:  # 네트워크·상태·파싱 실패 — 모두 재시도 대상
            last_exc = exc
    raise FetchError(
        f"{context}: 총 {attempts}회 시도 실패 — 마지막 오류: {last_exc!r}"
    ) from last_exc


def _urlopen(url: str, timeout: float) -> object:
    import urllib.request

    return urllib.request.urlopen(url, timeout=timeout)


def _clip(series: Series, start: str | None, end: str | None) -> Series:
    if not start and not end:
        return series
    return [
        (d, v)
        for d, v in series
        if (not start or d >= str(start)) and (not end or d <= str(end))
    ]


def fetch_fred(
    series_id: str,
    start: str | None = None,
    end: str | None = None,
    *,
    retries: int = DEFAULT_RETRIES,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    cache_dir: Path | None = None,
    refresh: bool = False,
    opener: Callable[..., object] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> Series:
    """FRED 시리즈 실측 fetch — retry(총 3시도)·로컬 캐시·opener 주입 검증 가능.

    캐시 히트(refresh=False, 캐시 존재) 시 네트워크 호출 없이 반환하며 start/end는
    메모리 필터로 반영한다. refresh=True는 항상 네트워크로 재수집해 캐시를 갱신한다.
    전 시도 실패·파싱 실패는 FetchError — 캐시 손상은 미스로 간주해 네트워크로 회복.
    """
    _require_fred_id(series_id)
    if cache_dir is not None and not refresh:
        cached = load_cache(cache_dir, series_id)
        if cached is not None:
            return _clip(cached, start, end)
    url = build_fred_url(series_id, start, end)
    raw, series = _download_with_retry(
        url,
        parse=parse_fred_csv,
        context=f"FRED '{series_id}' fetch 실패",
        retries=retries,
        timeout=timeout,
        opener=opener,
        sleep=sleep,
    )
    if cache_dir is not None:
        save_cache(cache_dir, series_id, raw)
    return _clip(series, start, end)


def _stooq_cache_name(symbol: str, interval: str) -> str:
    return "stooq-{sym}-{iv}.csv".format(
        sym=_CACHE_SAFE_RE.sub("_", symbol), iv=_CACHE_SAFE_RE.sub("_", interval)
    )


def fetch_stooq(
    symbol: str,
    *,
    interval: str = "d",
    retries: int = DEFAULT_RETRIES,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    cache_dir: Path | None = None,
    refresh: bool = False,
    opener: Callable[..., object] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> Series:
    """Stooq 일별 CSV 실측 fetch — 종가 시퀀스만 추출해 Series로 정규화(② 확정)."""
    _require_stooq_symbol(symbol)
    if cache_dir is not None and not refresh:
        cached_text = _stooq_cached_text(cache_dir, symbol, interval)
        if cached_text is not None:
            try:
                return parse_stooq_csv(cached_text)
            except ValueError:
                pass  # 손상 캐시 → 미스 취급(계약) — 네트워크로 회복
    url = build_stooq_url(symbol, interval=interval)
    raw, series = _download_with_retry(
        url,
        parse=parse_stooq_csv,
        context=f"Stooq '{symbol}' fetch 실패",
        retries=retries,
        timeout=timeout,
        opener=opener,
        sleep=sleep,
    )
    if cache_dir is not None:
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write(cache_dir / _stooq_cache_name(symbol, interval), raw)
    return series


def _stooq_cached_text(cache_dir: Path | None, symbol: str, interval: str) -> str | None:
    if cache_dir is None:
        return None
    path = Path(cache_dir) / _stooq_cache_name(symbol, interval)
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def load_cache(cache_dir: Path | None, series_id: str) -> Series | None:
    """캐시 히트 시 Series 반환, 미스 시 None.

    파일 부재·읽기 실패·파싱 실패(손상 원본)는 모두 미스(None) — 네트워크로 회복한다.
    """
    if cache_dir is None:
        return None
    path = Path(cache_dir) / f"{series_id}.csv"
    if not path.exists():
        return None
    try:
        return parse_fred_csv(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return None


def save_cache(cache_dir: Path, series_id: str, raw_text: str) -> Path:
    """캐시 저장(원본 CSV 텍스트, tmp→replace 원자적 쓰기) — 저장 경로 반환."""
    path = Path(cache_dir) / f"{series_id}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(path, raw_text)
    return path


__all__ = [
    "BASE_BACKOFF_SECONDS",
    "DEFAULT_RETRIES",
    "DEFAULT_TIMEOUT_SECONDS",
    "FRED_BASE_URL",
    "FetchError",
    "Series",
    "STOOQ_BASE_URL",
    "build_fred_url",
    "build_stooq_url",
    "fetch_fred",
    "fetch_stooq",
    "load_cache",
    "parse_fred_csv",
    "parse_stooq_csv",
    "save_cache",
]