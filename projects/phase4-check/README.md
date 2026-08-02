# phase4-check

Phase 4 검증용 스모크 테스트 프로젝트.

kanban 티켓(`t_37cac62c`)이 dev 프로필에 자동 배정·실행되는지 확인하기 위한
최소 프로젝트다. `dispatcher_ok()`가 True를 반환하면 dev 프로필이 티켓을
정상적으로 받아 실행했다는 의미다.

## 실행

```bash
python3 -m pytest -q
```

의존성: pytest (`pip3 install --break-system-packages pytest`)
