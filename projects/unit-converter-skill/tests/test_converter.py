"""Unit converter logic tests — TDD RED phase.

Tests cover:
- Temperature conversions (absolute offset: Celsius ↔ Fahrenheit ↔ Kelvin)
- Linear ratio conversions (length, weight, volume, speed, data)
- Category auto-detection
- convert_all (single value → all units in category)
- format_result (human-readable string)
- Edge cases: invalid units, unknown category, negative absolute temps
"""

import math
import pytest

from unit_converter.converter import (
    CATEGORIES,
    convert,
    convert_all,
    detect_category,
    format_result,
)


# ─── Temperature ──────────────────────────────────────────────────────

class TestTemperature:
    @pytest.mark.parametrize("value,from_u,to_u,expected", [
        (0, "celsius", "fahrenheit", 32),
        (100, "celsius", "fahrenheit", 212),
        (32, "fahrenheit", "celsius", 0),
        (212, "fahrenheit", "celsius", 100),
        (0, "celsius", "kelvin", 273.15),
        (273.15, "kelvin", "celsius", 0),
        (-40, "fahrenheit", "celsius", -40),
        (-40, "celsius", "fahrenheit", -40),
    ])
    def test_temperature_conversions(self, value, from_u, to_u, expected):
        result = convert(value, from_u, to_u)
        assert math.isclose(result, expected, abs_tol=0.01), \
            f"{value} {from_u} → {to_u}: expected {expected}, got {result}"

    def test_same_unit_returns_same_value(self):
        assert convert(42, "celsius", "celsius") == 42

    def test_kelvin_to_fahrenheit(self):
        assert math.isclose(convert(300, "kelvin", "fahrenheit"), 80.33, abs_tol=0.1)

    def test_negative_kelvin_raises(self):
        with pytest.raises(ValueError, match="absolute zero|negative"):
            convert(-1, "kelvin", "celsius")


# ─── Length ───────────────────────────────────────────────────────────

class TestLength:
    @pytest.mark.parametrize("value,from_u,to_u,expected", [
        (1, "meter", "centimeter", 100),
        (100, "centimeter", "meter", 1),
        (1, "kilometer", "meter", 1000),
        (1, "mile", "kilometer", 1.60934),
        (1, "inch", "centimeter", 2.54),
        (1, "foot", "inch", 12),
        (1, "yard", "meter", 0.9144),
    ])
    def test_length_conversions(self, value, from_u, to_u, expected):
        result = convert(value, from_u, to_u)
        assert math.isclose(result, expected, abs_tol=0.001), \
            f"{value} {from_u} → {to_u}: expected {expected}, got {result}"


# ─── Weight ───────────────────────────────────────────────────────────

class TestWeight:
    @pytest.mark.parametrize("value,from_u,to_u,expected", [
        (1, "kilogram", "gram", 1000),
        (1000, "gram", "kilogram", 1),
        (1, "pound", "kilogram", 0.453592),
        (1, "kilogram", "pound", 2.20462),
        (1, "ounce", "gram", 28.3495),
        (1, "ton", "kilogram", 1000),
    ])
    def test_weight_conversions(self, value, from_u, to_u, expected):
        result = convert(value, from_u, to_u)
        assert math.isclose(result, expected, abs_tol=0.01), \
            f"{value} {from_u} → {to_u}: expected {expected}, got {result}"


# ─── Volume ───────────────────────────────────────────────────────────

class TestVolume:
    @pytest.mark.parametrize("value,from_u,to_u,expected", [
        (1, "liter", "milliliter", 1000),
        (1000, "milliliter", "liter", 1),
        (1, "gallon", "liter", 3.78541),
        (1, "liter", "gallon", 0.264172),
        (1, "cup", "milliliter", 236.588),
    ])
    def test_volume_conversions(self, value, from_u, to_u, expected):
        result = convert(value, from_u, to_u)
        assert math.isclose(result, expected, abs_tol=0.1), \
            f"{value} {from_u} → {to_u}: expected {expected}, got {result}"


# ─── Speed ────────────────────────────────────────────────────────────

class TestSpeed:
    @pytest.mark.parametrize("value,from_u,to_u,expected", [
        (1, "mps", "kmh", 3.6),
        (100, "kmh", "mps", 27.7778),
        (1, "mph", "kmh", 1.60934),
        (100, "kmh", "mph", 62.1371),
        (1, "knot", "kmh", 1.852),
    ])
    def test_speed_conversions(self, value, from_u, to_u, expected):
        result = convert(value, from_u, to_u)
        assert math.isclose(result, expected, abs_tol=0.01), \
            f"{value} {from_u} → {to_u}: expected {expected}, got {result}"


# ─── Data ─────────────────────────────────────────────────────────────

class TestData:
    @pytest.mark.parametrize("value,from_u,to_u,expected", [
        (1, "kilobyte", "byte", 1024),
        (1024, "byte", "kilobyte", 1),
        (1, "megabyte", "kilobyte", 1024),
        (1, "gigabyte", "megabyte", 1024),
        (1, "terabyte", "gigabyte", 1024),
    ])
    def test_data_conversions(self, value, from_u, to_u, expected):
        result = convert(value, from_u, to_u)
        assert math.isclose(result, expected, abs_tol=0.001), \
            f"{value} {from_u} → {to_u}: expected {expected}, got {result}"


# ─── Category Detection ───────────────────────────────────────────────

class TestDetectCategory:
    @pytest.mark.parametrize("unit,expected", [
        ("celsius", "temperature"),
        ("fahrenheit", "temperature"),
        ("kelvin", "temperature"),
        ("meter", "length"),
        ("mile", "length"),
        ("kilogram", "weight"),
        ("pound", "weight"),
        ("liter", "volume"),
        ("gallon", "volume"),
        ("kmh", "speed"),
        ("mph", "speed"),
        ("kilobyte", "data"),
        ("megabyte", "data"),
    ])
    def test_detect_category(self, unit, expected):
        assert detect_category(unit) == expected

    def test_unknown_unit_returns_none(self):
        assert detect_category("blarg") is None


# ─── convert_all ──────────────────────────────────────────────────────

class TestConvertAll:
    def test_convert_all_temperature(self):
        results = convert_all(100, "celsius")
        assert "fahrenheit" in results
        assert "kelvin" in results
        assert math.isclose(results["fahrenheit"], 212, abs_tol=0.1)
        assert math.isclose(results["kelvin"], 373.15, abs_tol=0.1)

    def test_convert_all_excludes_source_unit(self):
        results = convert_all(1, "meter")
        assert "meter" not in results
        assert "centimeter" in results

    def test_convert_all_length(self):
        results = convert_all(1, "kilometer")
        assert math.isclose(results["meter"], 1000, abs_tol=0.001)
        assert math.isclose(results["mile"], 0.621371, abs_tol=0.001)


# ─── format_result ────────────────────────────────────────────────────

class TestFormatResult:
    def test_format_basic(self):
        text = format_result(100, "celsius", "fahrenheit", 212)
        assert "100" in text
        assert "celsius" in text
        assert "212" in text
        assert "fahrenheit" in text

    def test_format_with_decimal(self):
        text = format_result(1, "mile", "kilometer", 1.60934)
        assert "1.60934" in text or "1.6093" in text

    def test_format_rounds_long_decimals(self):
        text = format_result(1, "kilometer", "mile", 0.621371192)
        # Should not show all 9 decimal places
        assert "0.621371192" not in text


# ─── Edge Cases & Errors ──────────────────────────────────────────────

class TestEdgeCases:
    def test_invalid_from_unit_raises(self):
        with pytest.raises(ValueError):
            convert(1, "blarg", "meter")

    def test_invalid_to_unit_raises(self):
        with pytest.raises(ValueError):
            convert(1, "meter", "blarg")

    def test_cross_category_units_raises(self):
        with pytest.raises(ValueError, match="category|same"):
            convert(1, "meter", "kilogram")

    def test_zero_value_converts(self):
        assert convert(0, "meter", "centimeter") == 0

    def test_negative_length_converts(self):
        assert math.isclose(convert(-5, "meter", "centimeter"), -500, abs_tol=0.001)


# ─── CATEGORIES structure ─────────────────────────────────────────────

class TestCategoriesStructure:
    def test_all_six_categories_exist(self):
        expected = {"temperature", "length", "weight", "volume", "speed", "data"}
        assert expected == set(CATEGORIES.keys())

    def test_each_category_has_units(self):
        for cat, units in CATEGORIES.items():
            assert len(units) >= 3, f"{cat} has only {len(units)} units"