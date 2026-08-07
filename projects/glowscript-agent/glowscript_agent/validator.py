"""GlowScript code validator.

Checks that generated (or user-provided) GlowScript code is structurally sound:
it imports vpython, creates at least one object, has an animation loop, and
calls rate() inside the loop. Also catches Python syntax errors.
"""
from dataclasses import dataclass, field


@dataclass
class ValidationResult:
    """Result of validating a GlowScript code snippet."""

    valid: bool
    errors: list = field(default_factory=list)

    def __repr__(self) -> str:
        return f"ValidationResult(valid={self.valid}, errors={self.errors})"


def validate_code(code: str) -> ValidationResult:
    """Validate a GlowScript code string. Returns a ValidationResult."""
    errors = []

    # 1. Syntax check.
    try:
        compile(code, "<glowscript>", "exec")
    except SyntaxError as exc:
        errors.append(f"syntax error: {exc}")
        return ValidationResult(valid=False, errors=errors)

    # 2. Must import vpython.
    if "from vpython import" not in code and "import vpython" not in code:
        errors.append("missing 'from vpython import *' import")

    # 3. Must create at least one 3D object.
    object_names = ["sphere(", "box(", "arrow(", "cylinder(", "curve(", "helix("]
    if not any(name in code for name in object_names):
        errors.append("no 3D object created (sphere/box/arrow/cylinder/curve/helix)")

    # 4. Must have an animation loop.
    if "while True" not in code:
        errors.append("missing 'while True' animation loop")

    # 5. Must call rate() inside the loop.
    if "rate(" not in code:
        errors.append("missing rate() call in the animation loop")

    return ValidationResult(valid=not errors, errors=errors)


def validate_file(path: str) -> ValidationResult:
    """Validate a GlowScript code file. Raises FileNotFoundError if missing."""
    with open(path, "r", encoding="utf-8") as f:
        code = f.read()
    return validate_code(code)
