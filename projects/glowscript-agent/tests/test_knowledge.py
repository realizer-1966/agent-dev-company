"""Tests for the GlowScript knowledge base."""
import pytest

from glowscript_agent.knowledge import (
    OBJECTS,
    TEMPLATES,
    get_object,
    get_template,
    list_objects,
    list_templates,
    search_knowledge,
)


def test_list_objects_returns_core_objects():
    objs = list_objects()
    assert "sphere" in objs
    assert "box" in objs
    assert "arrow" in objs


def test_get_object_returns_attributes():
    sphere = get_object("sphere")
    assert sphere is not None
    assert "pos" in sphere["attributes"]
    assert "radius" in sphere["attributes"]
    assert "color" in sphere["attributes"]


def test_get_object_unknown_raises():
    with pytest.raises(KeyError):
        get_object("nonexistent_shape")


def test_list_templates_returns_known_templates():
    templates = list_templates()
    assert "projectile" in templates
    assert "pendulum" in templates
    assert "spring" in templates


def test_get_template_returns_code():
    tpl = get_template("projectile")
    assert tpl is not None
    assert "code" in tpl
    assert "description" in tpl


def test_get_template_unknown_raises():
    with pytest.raises(KeyError):
        get_template("nonexistent_template")


def test_search_knowledge_finds_matching_objects():
    results = search_knowledge("sphere")
    assert any("sphere" in r["name"] for r in results)


def test_search_knowledge_returns_empty_for_no_match():
    results = search_knowledge("zzzz_no_such_term_zzzz")
    assert results == []


def test_objects_have_required_keys():
    for name, obj in OBJECTS.items():
        assert "attributes" in obj
        assert "description" in obj
        assert isinstance(obj["attributes"], dict)


def test_templates_have_required_keys():
    for name, tpl in TEMPLATES.items():
        assert "code" in tpl
        assert "description" in tpl
        assert "keywords" in tpl
