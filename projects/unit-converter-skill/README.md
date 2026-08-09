# Unit Converter Skill

Google AI Edge Gallery 의 Agent Skill 형식을 따르는 단위 변환기 예제입니다.
온도·길이·무게·부피·속도·데이터 크기의 6가지 카테고리를 지원합니다.

## 구조

```
unit-converter-skill/
├── pyproject.toml              # Python 패키지 설정
├── unit_converter/
│   ├── __init__.py
│   └── converter.py            # 변환 로직 (Python)
├── tests/
│   ├── test_converter.py       # 변환 로직 테스트 (66 tests)
│   └── test_skill_structure.py # 스킬 구조 검증 테스트 (18 tests)
└── skill/
    └── unit-converter/         # Edge AI Gallery 스킬 디렉토리
        ├── SKILL.md            # 스킬 메타데이터 + LLM 지시
        ├── scripts/
        │   └── index.html      # JS 실행 엔트리 포인트
        └── assets/
            └── webview.html    # 인터랙티브 변환기 대시보드
```

## 지원 단위

| 카테고리 | 단위 |
|---|---|
| 온도 | celsius, fahrenheit, kelvin |
| 길이 | meter, kilometer, centimeter, mile, inch, foot, yard |
| 무게 | kilogram, gram, pound, ounce, ton |
| 부피 | liter, milliliter, gallon, cup |
| 속도 | m/s, km/h, mph, knot |
| 데이터 | byte, KB, MB, GB, TB |

## 설치 및 테스트

```bash
cd projects/unit-converter-skill
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
python -m pytest -q
```

## Edge AI Gallery 에 로드

`skill/unit-converter/` 디렉토리 전체를 디바이스에 복사하거나 URL 로 등록:

1. **URL 등록**: `skill/unit-converter/` 폴더를 웹 호스트(GitHub Pages 등)에 업로드 후,
   Gallery 앱에서 "Load skill from URL" 로 폴더 URL 입력
2. **로컬 가져오기**: `skill/unit-converter/` 폴더를 디바이스로 복사 후,
   "Import local skill" 로 선택

## 사용 예

- "100 celsius를 fahrenheit로 변환해줘"
- "1 mile이 몇 km인가?"
- "5 kg을 pound로"
- "1 gallon을 모든 단위로 보여줘"
- "단위 변환기 대시보드 열어줘"