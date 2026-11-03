"""FEAAS v2a ② sources 계층 테스트 — req-v2 §0·§1·§5-1 (fixture CSV 기반, 네트워크 격리).

- fredgraph 파서: 헤더 2종(DATE|observation_date) 수용, 결측 '.'/빈칸 → None, 날짜 오름차순
- URL 빌더(순수), fetch retry 총 3시도(백오프 0.5→1.0s), timeout 기본 30s 전달
- 로컬 캐시: 원본 CSV 보존 + 히트 시 네트워크 0호출(refresh=True만 재수집), 실패 → FetchError
- 실 fetch 유닛테스트 금지(req-v2 §1) — opener 주입(위조 응답)으로만 검증한다.
"""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import URLError

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import feaas.sources as sources

FIXTURES_DIR = ENGINE_DIR / "data" / "fixtures"
DGS10_TEXT = (FIXTURES_DIR / "fredgraph_DGS10_2024-01.csv").read_text(encoding="utf-8")
VIXCLS_TEXT = (FIXTURES_DIR / "fredgraph_VIXCLS_2021-02.csv").read_text(encoding="utf-8")
LEGACY_TEXT = (FIXTURES_DIR / "fredgraph_LEGACY_DATE_dot.sample.csv").read_text(
    encoding="utf-8"
)
STOOQ_TEXT = (FIXTURES_DIR / "stooq_spx_daily.sample.csv").read_text(encoding="utf-8")


def make_opener(payload: str, *, fail_times: int = 0, status: int = 200):
    """(url, timeout) 서명 위조 opener — fail_times만큼 URLError, 이후 status 부여 BytesIO."""
    calls: list[tuple[str, float]] = []

    def opener(url: str, timeout: float) -> io.BytesIO:
        calls.append((url, timeout))
        if len(calls) <= fail_times:
            raise URLError("network down (fake)")
        resp = io.BytesIO(payload.encode("utf-8"))
        resp.status = status  # type: ignore[attr-defined]
        return resp

    opener.calls = calls  # type: ignore[attr-defined]
    return opener


def run_fetch_fred(
    self: unittest.TestCase,
    payload: str,
    *,
    fail_times: int = 0,
    status: int = 200,
    retries: int = 2,
    timeout: float = 30.0,
    cache_dir: Path | None = None,
    refresh: bool = False,
    series_id: str = "DGS10",
):
    opener = make_opener(payload, fail_times=fail_times, status=status)
    sleeps: list[float] = []
    got = sources.fetch_fred(
        series_id,
        retries=retries,
        timeout=timeout,
        cache_dir=cache_dir,
        refresh=refresh,
        opener=opener,
        sleep=lambda s: sleeps.append(s),
    )
    return got, opener.calls, sleeps


class BuildUrlTests(unittest.TestCase):
    def test_fred_base(self) -> None:
        self.assertEqual(
            sources.build_fred_url("DGS10"),
            "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10",
        )

    def test_fred_range_params(self) -> None:
        self.assertIn("id=DGS10", sources.build_fred_url("DGS10"))
        url = sources.build_fred_url("DGS10", "2024-01-01", "2024-01-31")
        self.assertIn("cosd=2024-01-01", url)
        self.assertIn("coed=2024-01-31", url)

    def test_stooq_url_encodes_caret(self) -> None:
        self.assertEqual(
            sources.build_stooq_url("^spx"),
            "https://stooq.com/q/d/l/?s=%5Espx&i=d",
        )

    def test_bad_fred_id_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.build_fred_url("bad id")

    def test_bad_start_date_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.build_fred_url("DGS10", "01/2024")


class ParseFredCsvTests(unittest.TestCase):
    def test_modern_header_with_blank_missing(self) -> None:
        rows = sources.parse_fred_csv(VIXCLS_TEXT)
        self.assertEqual(rows[0], ("2021-02-12", 19.97))
        self.assertIn(("2021-02-15", None), rows)
        self.assertEqual(len(rows), 11)
        self.assertEqual([d for d, _ in rows], sorted(d for d, _ in rows))

    def test_legacy_header_with_dot_missing(self) -> None:
        rows = sources.parse_fred_csv(LEGACY_TEXT)
        self.assertEqual(rows[0], ("2024-01-02", 3.95))
        self.assertIn(("2024-01-09", None), rows)

    def test_real_fixture_roundtrip_shape(self) -> None:
        rows = sources.parse_fred_csv(DGS10_TEXT)
        self.assertEqual(rows[0], ("2024-01-02", 3.95))
        self.assertEqual(
            len(rows), len(DGS10_TEXT.strip().splitlines()) - 1, "헤더 제외 행 수 일치"
        )
        self.assertEqual(sum(1 for _, v in rows if v is None), 1, "fixture 결측 1건")

    def test_missing_marker_variants(self) -> None:
        rows = sources.parse_fred_csv(
            "DATE,X\n2024-01-02,.\n2024-01-03,\n2024-01-04,NaN\n"
            "2024-01-05,null\n2024-01-06,NA\n2024-01-07,1.5\n"
        )
        self.assertEqual(
            rows,
            [
                ("2024-01-02", None),
                ("2024-01-03", None),
                ("2024-01-04", None),
                ("2024-01-05", None),
                ("2024-01-06", None),
                ("2024-01-07", 1.5),
            ],
        )

    def test_sorts_ascending(self) -> None:
        rows = sources.parse_fred_csv("DATE,X\n2024-01-03,3.0\n2024-01-02,2.0\n")
        self.assertEqual(rows, [("2024-01-02", 2.0), ("2024-01-03", 3.0)])

    def test_unknown_date_header_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_fred_csv("date,X\n2024-01-02,1.0\n")

    def test_three_column_header_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_fred_csv("DATE,X,Y\n2024-01-02,1.0,2.0\n")

    def test_bad_date_row_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_fred_csv("DATE,X\n02-01-2024,1.0\n")

    def test_bad_float_row_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_fred_csv("DATE,X\n2024-01-02,abc\n")

    def test_no_data_rows_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_fred_csv("DATE,X\n")

    def test_empty_text_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_fred_csv("")


class ParseStooqCsvTests(unittest.TestCase):
    def test_fixture_with_volume_column(self) -> None:
        rows = sources.parse_stooq_csv(STOOQ_TEXT)
        self.assertEqual(rows[0], ("2022-01-10", 4796.56))
        self.assertEqual(len(rows), 10)
        self.assertEqual([d for d, _ in rows], sorted(d for d, _ in rows))
        self.assertTrue(all(v is not None for _, v in rows))

    def test_close_column_found_by_header_name(self) -> None:
        rows = sources.parse_stooq_csv(
            "Date,Open,High,Low,Close\n2024-01-10,4700,4750,4650,4796\n"
        )
        self.assertEqual(rows, [("2024-01-10", 4796.0)])

    def test_blank_and_null_close(self) -> None:
        rows = sources.parse_stooq_csv(
            "Date,Open,High,Low,Close,Volume\n2022-01-10,4,5,3,,100\n"
            "2022-01-11,4,5,3,null,100\n"
        )
        self.assertEqual(rows, [("2022-01-10", None), ("2022-01-11", None)])

    def test_no_close_column_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_stooq_csv("Date,Open,High,Low\n2022-01-10,4,5,3\n")

    def test_no_data_body_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.parse_stooq_csv("No data\n")


class FetchRetryTests(unittest.TestCase):
    """retry (총 3시도) · 백오프 · timeout 30s · 명확 예외 — opener 주입으로 검증."""

    def test_first_attempt_success_no_cache_side_effect(self) -> None:
        got, calls, sleeps = run_fetch_fred(self, DGS10_TEXT)
        self.assertEqual(got, sources.parse_fred_csv(DGS10_TEXT))
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, [], "1회 성공 시 backoff 수면 없음")

    def test_default_timeout_is_30s_and_forwarded(self) -> None:
        self.assertEqual(sources.DEFAULT_TIMEOUT_SECONDS, 30.0)
        got, calls, _ = run_fetch_fred(self, DGS10_TEXT, timeout=30.0)
        self.assertEqual(calls[0][1], 30.0)

    def test_retry_two_backoff_success_on_third(self) -> None:
        got, calls, sleeps = run_fetch_fred(self, DGS10_TEXT, fail_times=2)
        self.assertEqual(got[0], ("2024-01-02", 3.95))
        self.assertEqual(len(calls), 3, "총 3시도(재시도 2회)")
        self.assertEqual(sleeps, [0.5, 1.0], "백오프 0.5s×2^(시도-1)")

    def test_retry_2_max_total_attempts(self) -> None:
        with self.assertRaises(sources.FetchError) as ctx:
            run_fetch_fred(self, DGS10_TEXT, fail_times=5)
        self.assertIn("3회", str(ctx.exception), "총 3시도 명시")
        self.assertIn("DGS10", str(ctx.exception))

    def test_exhausted_attempts_and_backoff_recorded(self) -> None:
        opener = make_opener(DGS10_TEXT, fail_times=9)
        sleeps: list[float] = []
        with self.assertRaises(sources.FetchError):
            sources.fetch_fred(
                "DGS10", opener=opener, sleep=lambda s: sleeps.append(s)
            )
        self.assertEqual(len(opener.calls), 3)
        self.assertEqual(sleeps, [0.5, 1.0])

    def test_http_status_failure_is_retried_then_raises(self) -> None:
        with self.assertRaises(sources.FetchError):
            run_fetch_fred(self, "DATE,X\n2024-01-02,1.0\n", status=404, fail_times=0)

        opener = make_opener("DATE,X\n2024-01-02,1.0\n", status=404, fail_times=0)
        with self.assertRaises(sources.FetchError) as ctx:
            sources.fetch_fred("DGS10", opener=opener, sleep=lambda s: None)
        self.assertEqual(len(opener.calls), 3)
        self.assertIn("404", str(ctx.exception))

    def test_non_csv_payload_retried_then_clear_error(self) -> None:
        with self.assertRaises(sources.FetchError) as ctx:
            run_fetch_fred(self, "<html>blocked</html>")
        self.assertIn("DGS10", str(ctx.exception))

    def test_invalid_series_id_never_touches_network(self) -> None:
        opener = make_opener(DGS10_TEXT, fail_times=0)
        with self.assertRaises(ValueError):
            sources.fetch_fred("b@d!", opener=opener, sleep=lambda s: None)
        self.assertEqual(len(opener.calls), 0)


class FetchCachePolicyTests(unittest.TestCase):
    """로컬 캐시 히트 정책: 히트 시 네트워크 0호출, refresh=True만 재수집."""

    def test_cache_hit_no_network_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sources.save_cache(Path(tmp), "DGS10", DGS10_TEXT)
            opener = make_opener(DGS10_TEXT, fail_times=9)
            got = sources.fetch_fred(
                "DGS10", cache_dir=Path(tmp), opener=opener, sleep=lambda s: None
            )
            self.assertEqual(got, sources.parse_fred_csv(DGS10_TEXT))
            self.assertEqual(len(opener.calls), 0, "캐시 히트 → 네트워크 미호출")

    def test_cache_hit_clip_by_start_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sources.save_cache(Path(tmp), "DGS10", DGS10_TEXT)
            expect = sources.parse_fred_csv(DGS10_TEXT)[:2]
            opener = make_opener(DGS10_TEXT, fail_times=9)
            got = sources.fetch_fred(
                "DGS10",
                "2024-01-02",
                "2024-01-03",
                cache_dir=Path(tmp),
                opener=opener,
                sleep=lambda s: None,
            )
            self.assertEqual(got, expect)

    def test_refresh_bypasses_cache_and_updates_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sources.save_cache(Path(tmp), "DGS10", DGS10_TEXT)
            payload = LEGACY_TEXT  # 다른 원본 — 갱신 확인용
            got, calls, _ = run_fetch_fred(
                self, payload, cache_dir=Path(tmp), refresh=True
            )
            self.assertEqual(len(calls), 1)
            self.assertEqual(got, sources.parse_fred_csv(payload))
            self.assertEqual((Path(tmp) / "DGS10.csv").read_text(encoding="utf-8"), payload)

    def test_cache_persists_exact_raw_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_fetch_fred(self, DGS10_TEXT, cache_dir=Path(tmp))
            self.assertEqual(
                (Path(tmp) / "DGS10.csv").read_text(encoding="utf-8"), DGS10_TEXT
            )

    def test_stooq_cache_hit_zero_network(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            opener = make_opener(STOOQ_TEXT, fail_times=0)
            got1 = sources.fetch_stooq(
                "^spx", cache_dir=Path(tmp), opener=opener, sleep=lambda s: None
            )
            self.assertEqual(got1, sources.parse_stooq_csv(STOOQ_TEXT))
            cached = list(Path(tmp).iterdir())
            self.assertEqual([p.name for p in cached], ["stooq-^spx-d.csv"])
            blocker = make_opener(STOOQ_TEXT, fail_times=9)
            got2 = sources.fetch_stooq(
                "^spx", cache_dir=Path(tmp), opener=blocker, sleep=lambda s: None
            )
            self.assertEqual(got2, got1)
            self.assertEqual(len(blocker.calls), 0)

    def test_stooq_failure_message_contains_symbol(self) -> None:
        opener = make_opener(STOOQ_TEXT, fail_times=9)
        with self.assertRaises(sources.FetchError) as ctx:
            sources.fetch_stooq("^spx", opener=opener, sleep=lambda s: None)
        self.assertIn("^spx", str(ctx.exception))

    def test_stooq_bad_symbol_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sources.fetch_stooq("a b", opener=make_opener(""), sleep=lambda s: None)


class CacheApiTests(unittest.TestCase):
    def test_save_then_load_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = sources.save_cache(Path(tmp), "DGS10", DGS10_TEXT)
            self.assertEqual(path.name, "DGS10.csv")
            self.assertEqual(path.read_text(encoding="utf-8"), DGS10_TEXT)
            self.assertEqual(
                sources.load_cache(Path(tmp), "DGS10"), sources.parse_fred_csv(DGS10_TEXT)
            )

    def test_load_cache_miss_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(sources.load_cache(Path(tmp), "ZZZZZ1"))
        self.assertIsNone(sources.load_cache(None, "DGS10"))

    def test_corrupt_cache_counts_as_miss(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "DGS10.csv").write_text("garbage not a csv", encoding="utf-8")
            self.assertIsNone(sources.load_cache(Path(tmp), "DGS10"))

    def test_save_creates_missing_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            nested = Path(tmp) / "data" / "cache"
            sources.save_cache(nested, "DGS10", DGS10_TEXT)
            self.assertTrue((nested / "DGS10.csv").exists())


class _FakeResponse:
    """fetch_stooq 주입 테스트용 최소 응답 — read()·status 계약."""

    def __init__(self, body: bytes, status: int = 200) -> None:
        self._body = body
        self.status = status

    def read(self) -> bytes:
        return self._body


class StooqPowChallengeTests(unittest.TestCase):
    """⑥ — stooq JS PoW 챌린지 처리(CEO 실측 흐름: c·d 추출 → solve → /__verify → 재수집)."""

    CHALLENGE_HTML = (
        "<html><head><meta charset=\"utf-8\"></head><body>"
        "<noscript>This site requires JavaScript to verify your browser.</noscript>"
        '<script nonce="x">(async()=>{const c="AAAAAGrplfNopMx3u6ozWL0D0NI4_lvH0tkV"'
        ",d=4,t=\"0\".repeat(d),e=new TextEncoder;let n=0;while(1){"
        'const h=await crypto.subtle.digest("SHA-256",e.encode(c+n)),'
        "x=Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,\"0\"))."
        "join(\"\");if(x.startsWith(t))break;n++}"
        'const r=await fetch("/__verify",{method:"POST",'
        'headers:{"Content-Type":"application/x-www-form-urlencoded"},'
        'body:"c="+encodeURIComponent(c)+"&n="+n,credentials:"same-origin"});'
        "if(r.ok)location.reload()})();</script></body></html>"
    )
    CSV_OK = "Date,Close\n2018-01-01,100.0000\n2018-01-02,101.0000\n"

    def test_parse_challenge_extracts_token_and_digits(self) -> None:
        self.assertEqual(
            sources.parse_stooq_challenge(self.CHALLENGE_HTML),
            ("AAAAAGrplfNopMx3u6ozWL0D0NI4_lvH0tkV", 4),
        )

    def test_parse_challenge_non_challenge_returns_none(self) -> None:
        self.assertIsNone(sources.parse_stooq_challenge("Date,Close\n2018-01-01,1\n"))
        self.assertIsNone(sources.parse_stooq_challenge("<html>error page</html>"))
        self.assertIsNone(sources.parse_stooq_challenge(""))

    def test_solve_pow_is_deterministic_and_correct(self) -> None:
        import hashlib

        n = sources.solve_pow("AAAA", 2)
        self.assertEqual(n, sources.solve_pow("AAAA", 2))
        digest = hashlib.sha256(("AAAA" + str(n)).encode("utf-8")).hexdigest()
        self.assertTrue(digest.startswith("00"), digest)

    def test_solve_pow_rejects_bad_params(self) -> None:
        for c_token, digits in (("", 2), ("bad token!", 2), ("AAAA", 0), ("AAAA", 9)):
            with self.subTest(c_token=c_token, digits=digits):
                with self.assertRaises(ValueError):
                    sources.solve_pow(c_token, digits)

    def test_build_verify_request_contract(self) -> None:
        request = sources.build_verify_request(
            "TOK_1", 123, referer="https://stooq.com/q/d/l/?s=%5Espx&i=d"
        )
        self.assertEqual(request.full_url, sources.STOOQ_VERIFY_URL)
        self.assertEqual(request.get_method(), "POST")
        headers = {k.lower(): v for k, v in request.header_items()}
        self.assertEqual(headers.get("content-type"), "application/x-www-form-urlencoded")
        self.assertEqual(headers.get("origin"), sources.STOOQ_ORIGIN)
        self.assertIn("stooq.com", headers.get("referer", ""))
        self.assertEqual(bytes(request.data), b"c=TOK_1&n=123")

    def test_fetch_stooq_challenge_flow_solves_and_fetches_csv(self) -> None:
        posts: list[tuple[str, bytes]] = []
        served = {"n": 0}  # GET: 1회차=챌린지, verify 후=CSV 세션 획득 시나리오

        def get(url: str, timeout: float) -> _FakeResponse:
            served["n"] += 1
            body = self.CHALLENGE_HTML if served["n"] == 1 else self.CSV_OK
            return _FakeResponse(body.encode("utf-8"))

        def post(request: object, timeout: float) -> _FakeResponse:
            posts.append((request.full_url, bytes(request.data)))
            return _FakeResponse(b"ok\n")

        got = sources.fetch_stooq(
            "^spx", cache_dir=None, opener=get, opener_post=post, sleep=lambda s: None
        )
        self.assertEqual(got, [("2018-01-01", 100.0), ("2018-01-02", 101.0)])
        self.assertEqual(len(posts), 1, "verify POST 1회(CEO 실측 흐름)")
        url, body = posts[0]
        self.assertEqual(url, sources.STOOQ_VERIFY_URL)
        self.assertTrue(body.startswith(b"c=AAAAAGrplfNopMx3u6oz"), body)
        self.assertIn(b"&n=", body)

    def test_fetch_stooq_verify_then_still_blocked_is_cleared_reported(self) -> None:
        def get(url: str, timeout: float) -> _FakeResponse:
            return _FakeResponse(self.CHALLENGE_HTML.encode("utf-8"))

        def post(request: object, timeout: float) -> _FakeResponse:
            return _FakeResponse(b"ok\n")

        with self.assertRaises(sources.FetchError) as context:
            sources.fetch_stooq(
                "^spx", cache_dir=None, opener=get, opener_post=post, sleep=lambda s: None
            )
        self.assertIn("PoW verify 성공", str(context.exception))

    def test_fetch_stooq_http_404_reports_clearly(self) -> None:
        def get(url: str, timeout: float) -> _FakeResponse:
            return _FakeResponse(b"not found", status=404)

        def post(request: object, timeout: float) -> _FakeResponse:
            return _FakeResponse(b"ok\n")

        with self.assertRaises(sources.FetchError) as context:
            sources.fetch_stooq(
                "^spx", cache_dir=None, opener=get, opener_post=post, sleep=lambda s: None
            )
        self.assertIn("HTTP 404", str(context.exception))
        self.assertIn("PoW verify 미동작", str(context.exception))


if __name__ == "__main__":
    unittest.main()