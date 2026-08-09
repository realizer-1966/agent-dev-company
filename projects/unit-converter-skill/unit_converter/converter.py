"""Unit conversion logic — supports 6 categories.

Temperature uses absolute offset conversions (°C ↔ °F ↔ K).
All other categories use linear ratio conversions via a base unit.

Categories:
    temperature: celsius, fahrenheit, kelvin
    length:      meter(base), kilometer, centimeter, mile, inch, foot, yard
    weight:      kilogram(base), gram, pound, ounce, ton
    volume:      liter(base), milliliter, gallon, cup
    speed:       mps(base), kmh, mph, knot
    data:        byte(base), kilobyte, megabyte, gigabyte, terabyte
"""

from __future__ import annotations

# ─── Category definitions ─────────────────────────────────────────────
#
# For ratio-based categories, each unit maps to (factor_to_base, base_unit).
# value_in_base = value * factor
# value_in_target = value_in_base / target_factor
#
# For temperature, we use a special converter with offsets.

CATEGORIES: dict[str, dict[str, float]] = {
    "temperature": {
        "celsius": 1.0,
        "fahrenheit": 1.0,
        "kelvin": 1.0,
    },
    "length": {
        "meter": 1.0,
        "kilometer": 1000.0,
        "centimeter": 0.01,
        "mile": 1609.344,
        "inch": 0.0254,
        "foot": 0.3048,
        "yard": 0.9144,
    },
    "weight": {
        "kilogram": 1.0,
        "gram": 0.001,
        "pound": 0.45359237,
        "ounce": 0.028349523,
        "ton": 1000.0,
    },
    "volume": {
        "liter": 1.0,
        "milliliter": 0.001,
        "gallon": 3.785411784,
        "cup": 0.2365882365,
    },
    "speed": {
        "mps": 1.0,
        "kmh": 0.277777778,
        "mph": 0.44704,
        "knot": 0.514444444,
    },
    "data": {
        "byte": 1.0,
        "kilobyte": 1024.0,
        "megabyte": 1024.0 ** 2,
        "gigabyte": 1024.0 ** 3,
        "terabyte": 1024.0 ** 4,
    },
}

# Build a reverse lookup: unit_name → category
_UNIT_TO_CATEGORY: dict[str, str] = {
    unit: cat for cat, units in CATEGORIES.items() for unit in units
}


# ─── Temperature conversion ───────────────────────────────────────────

def _convert_temperature(value: float, from_unit: str, to_unit: str) -> float:
    """Convert between celsius, fahrenheit, kelvin."""
    # First convert to celsius
    if from_unit == "celsius":
        celsius = value
    elif from_unit == "fahrenheit":
        celsius = (value - 32) * 5 / 9
    elif from_unit == "kelvin":
        celsius = value - 273.15
    else:
        raise ValueError(f"Unknown temperature unit: {from_unit}")

    # Kelvin cannot be negative (absolute zero)
    if celsius < -273.15:
        raise ValueError(
            f"Temperature {value} {from_unit} is below absolute zero"
        )

    # Then convert from celsius to target
    if to_unit == "celsius":
        return celsius
    elif to_unit == "fahrenheit":
        return celsius * 9 / 5 + 32
    elif to_unit == "kelvin":
        return celsius + 273.15
    else:
        raise ValueError(f"Unknown temperature unit: {to_unit}")


# ─── Ratio-based conversion ───────────────────────────────────────────

def _convert_ratio(
    value: float, from_unit: str, to_unit: str, category: str
) -> float:
    """Convert using multiplicative factors relative to a base unit."""
    units = CATEGORIES[category]
    base_value = value * units[from_unit]
    return base_value / units[to_unit]


# ─── Public API ───────────────────────────────────────────────────────

def detect_category(unit: str) -> str | None:
    """Return the category name for a given unit, or None if unknown."""
    return _UNIT_TO_CATEGORY.get(unit)


def convert(value: float, from_unit: str, to_unit: str) -> float:
    """Convert a value from one unit to another.

    Args:
        value: The numeric value to convert.
        from_unit: The source unit name (e.g. "celsius", "meter").
        to_unit: The target unit name.

    Returns:
        The converted value as a float.

    Raises:
        ValueError: If units are unknown or belong to different categories.
    """
    from_cat = detect_category(from_unit)
    to_cat = detect_category(to_unit)

    if from_cat is None:
        raise ValueError(f"Unknown unit: {from_unit!r}")
    if to_cat is None:
        raise ValueError(f"Unknown unit: {to_unit!r}")
    if from_cat != to_cat:
        raise ValueError(
            f"Cannot convert {from_unit} ({from_cat}) to {to_unit} ({to_cat}) "
            f"— units must be in the same category"
        )

    if from_unit == to_unit:
        return float(value)

    if from_cat == "temperature":
        return _convert_temperature(value, from_unit, to_unit)

    return _convert_ratio(value, from_unit, to_unit, from_cat)


def convert_all(value: float, from_unit: str) -> dict[str, float]:
    """Convert a value to all other units in the same category.

    Args:
        value: The numeric value to convert.
        from_unit: The source unit name.

    Returns:
        Dict mapping unit name → converted value, excluding the source unit.

    Raises:
        ValueError: If from_unit is unknown.
    """
    category = detect_category(from_unit)
    if category is None:
        raise ValueError(f"Unknown unit: {from_unit!r}")

    results: dict[str, float] = {}
    for unit in CATEGORIES[category]:
        if unit == from_unit:
            continue
        results[unit] = convert(value, from_unit, unit)

    return results


def format_result(
    value: float, from_unit: str, to_unit: str, result: float
) -> str:
    """Format a conversion result as a human-readable string.

    Args:
        value: The original value.
        from_unit: The source unit.
        to_unit: The target unit.
        result: The converted value.

    Returns:
        A formatted string like "100 celsius = 212 fahrenheit".
    """
    # Round to 4 significant decimal places for readability
    if abs(result) >= 100:
        formatted = f"{result:.2f}"
    elif abs(result) >= 1:
        formatted = f"{result:.4f}".rstrip("0").rstrip(".")
    else:
        formatted = f"{result:.6f}".rstrip("0").rstrip("")

    return f"{value} {from_unit} = {formatted} {to_unit}"