#!/bin/bash
# glowscript-llm 백엔드 자동 실행/유지 스크립트
# Hermes cron이 주기적으로 호출. 백엔드가 죽어있으면 재시작.
# 이미 실행 중이면 아무 출력 없이 조용히 종료 (watchdog 패턴).

HOST=127.0.0.1
PORT=8010
PROJECT_DIR=/root/workspace/agent-dev-company/projects/glowscript-llm
VENV=/root/workspace/agent-dev-company/.venv/bin/activate
LOG=/tmp/glowscript-llm.log

# 이미 실행 중이면 조용히 종료 (stdout 비우기 = cron이 메시지 안 보냄)
if curl -s -o /dev/null -w "%{http_code}" "http://${HOST}:${PORT}/health" 2>/dev/null | grep -q 200; then
  exit 0
fi

# 실행 중이 아니면 시작
cd "$PROJECT_DIR"
source "$VENV"
nohup uvicorn app.main:app --host "$HOST" --port "$PORT" > "$LOG" 2>&1 &
sleep 4

# 시작 후 health 확인
if curl -s -o /dev/null -w "%{http_code}" "http://${HOST}:${PORT}/health" 2>/dev/null | grep -q 200; then
  echo "🔧 glowscript-llm 백엔드가 자동으로 시작되었습니다 (http://${HOST}:${PORT})"
else
  echo "⚠️ glowscript-llm 백엔드 시작 실패. 로그: $LOG"
fi
