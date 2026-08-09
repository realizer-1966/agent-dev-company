"""Unit Converter Skill — Edge AI Gallery Agent Skill.

온도·길이·무게·부피·속도·데이터 단위 변환 로직과 스킬 산출물 검증 유틸리티.
"""

from unit_converter.converter import (
    CATEGORIES,
    convert,
    convert_all,
    detect_category,
    format_result,
)

__all__ = [
    "CATEGORIES",
    "convert",
    "convert_all",
    "detect_category",
    "format_result",
]

__version__ = "0.1.0"