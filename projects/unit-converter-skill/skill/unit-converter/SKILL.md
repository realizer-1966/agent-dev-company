---
name: unit-converter
description: Convert between units of temperature, length, weight, volume, speed, and data size.
metadata:
  homepage: https://github.com/realizer-1966/agent-dev-company/tree/main/projects/unit-converter-skill
---

# Unit Converter

## Overview

Convert values between units across six categories: temperature, length, weight,
volume, speed, and data size. Returns a text result plus an interactive webview
dashboard for visual conversion.

## Supported Categories & Units

| Category   | Units                                                        |
|------------|--------------------------------------------------------------|
| Temperature| celsius, fahrenheit, kelvin                                  |
| Length     | meter, kilometer, centimeter, mile, inch, foot, yard         |
| Weight     | kilogram, gram, pound, ounce, ton                            |
| Volume     | liter, milliliter, gallon, cup                               |
| Speed      | mps (m/s), kmh (km/h), mph, knot                             |
| Data       | byte, kilobyte, megabyte, gigabyte, terabyte                 |

## Instructions

Call the `run_js` tool with the following exact parameters:

- **data**: A JSON string with the following fields:
  - `action`: String — one of `"convert"`, `"convert_all"`, `"dashboard"`.
  - `value`: Number — the value to convert (required for `convert` and `convert_all`).
  - `from_unit`: String — the source unit name (required for `convert` and `convert_all`).
  - `to_unit`: String — the target unit name (required for `convert`).
  - `category`: String — the category to display (optional, for `dashboard` action).

### Actions

#### 1. Single Conversion (`"convert"`)

When the user asks to convert one value to a specific unit:

```
action: "convert"
value: 100
from_unit: "celsius"
to_unit: "fahrenheit"
```

#### 2. Convert to All Units (`"convert_all"`)

When the user asks "convert 1 mile to all units" or wants to see all equivalents:

```
action: "convert_all"
value: 1
from_unit: "mile"
```

#### 3. Interactive Dashboard (`"dashboard"`)

When the user wants to see the interactive converter dashboard or explore
conversions visually:

```
action: "dashboard"
category: "length"   // optional: temperature, length, weight, volume, speed, data
value: 1             // optional: pre-fill value
from_unit: "meter"   // optional: pre-fill source unit
```

### Sample Commands

- "Convert 100 celsius to fahrenheit"
- "How much is 1 mile in kilometers?"
- "Convert 5 kilograms to pounds"
- "Show me 1 gallon in all units"
- "Open the unit converter dashboard"
- "What is 100 km/h in mph?"
- "Convert 2 gigabytes to megabytes"

### Rules

- Unit names are case-insensitive and accept common aliases (e.g. "km" → "kilometer", "kg" → "kilogram", "°C" → "celsius").
- If the user doesn't specify a target unit, use `convert_all` to show all equivalents.
- If the user says "dashboard" or "interactive", use the `dashboard` action to return the webview.