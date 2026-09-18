#!/usr/bin/env bash
# 치매 대화 서버 워치독 — cron 이 주기 호출한다.
#
# 설계 원칙: "조용할 때는 아무 말도 하지 않는다" (watchdog 패턴).
#   - 서버가 살아 있으면  : 아무것도 출력하지 않고 exit 0
#   - 서버가 죽어 복구됨  : 복구 사실을 한 줄 출력 (사용자에게 알림)
#   - 복구도 실패        : 오류를 출력하고 exit 1 (알림)
#
# 이 스크립트의 stdout 이 그대로 알림 메시지가 된다 (no_agent cron).
set -uo pipefail

PROJ=/root/workspace/agent-dev-company/projects/dementia-conversation
SERVER="$PROJ/server.sh"

# server.sh 자체가 없으면 그건 진짜 문제다
if [ ! -f "$SERVER" ]; then
  echo "치매 대화 서버 워치독 오류: server.sh 를 찾을 수 없습니다 ($SERVER)"
  exit 1
fi

# 살아 있으면 조용히 종료
if curl -sf -m 5 http://127.0.0.1:8912/health >/dev/null 2>&1; then
  exit 0
fi

# 죽었다 → 복구 시도
OUT=$(bash "$SERVER" ensure 2>&1)
RC=$?

if [ $RC -eq 0 ] && curl -sf -m 5 http://127.0.0.1:8912/health >/dev/null 2>&1; then
  echo "치매 대화 서버가 중지되어 있어 자동 재기동했습니다."
  echo "$OUT" | tail -3
  exit 0
fi

echo "치매 대화 서버 자동 재기동에 실패했습니다."
echo "$OUT" | tail -6
exit 1
