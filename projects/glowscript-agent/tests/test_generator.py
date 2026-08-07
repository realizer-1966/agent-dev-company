"""Tests for the GlowScript code generator."""
import pytest

from glowscript_agent.generator import (
    generate_simulation,
    match_template,
    SimulationSpec,
)


def test_match_template_projectile():
    assert match_template("공을 위로 던져 포물선 운동") == "projectile"


def test_match_template_pendulum():
    assert match_template("진자가 좌우로 흔들리는 운동") == "pendulum"


def test_match_template_spring():
    assert match_template("용수철이 늘어났다 줄어드는 진동") == "spring"


def test_match_template_orbit():
    assert match_template("행성이 별 주위를 도는 궤도") == "orbit"


def test_match_template_free_fall():
    assert match_template("물체가 자유낙하") == "free_fall"


def test_match_template_collision():
    assert match_template("두 공이 부딪히는 충돌") == "collision"


def test_match_template_electric_field():
    assert match_template("점전하 주위의 전기장") == "electric_field"


def test_match_template_robot_arm():
    assert match_template("로봇 팔이 회전하는 운동") == "robot_arm"


def test_match_template_defaults_to_projectile():
    assert match_template("아무거나") == "projectile"


def test_generate_simulation_returns_code():
    spec = SimulationSpec(description="공을 위로 던지는 운동", template="projectile")
    code = generate_simulation(spec)
    assert "from vpython import *" in code
    assert "scene" in code


def test_generate_simulation_contains_while_loop():
    spec = SimulationSpec(description="진자 운동", template="pendulum")
    code = generate_simulation(spec)
    assert "while True" in code
    assert "rate(" in code


def test_generate_simulation_unknown_template_raises():
    spec = SimulationSpec(description="x", template="nonexistent")
    with pytest.raises(KeyError):
        generate_simulation(spec)


def test_generate_simulation_embeds_description():
    spec = SimulationSpec(description="테스트 설명", template="projectile")
    code = generate_simulation(spec)
    assert "테스트 설명" in code
