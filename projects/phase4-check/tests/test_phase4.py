"""Phase 4 디스패처 검증용 스모크 테스트."""

from phase4_check import dispatcher_ok


def test_dispatcher_ok():
    """dev 프로필이 티켓을 자동으로 받아 실행됐는지 확인한다."""
    assert dispatcher_ok() is True
