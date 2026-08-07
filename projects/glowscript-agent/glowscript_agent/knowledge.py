"""GlowScript/VPython knowledge base.

Structured knowledge about GlowScript objects, attributes, and physics
simulation templates. This is the "learned" knowledge an LLM agent uses to
generate correct GlowScript code.
"""

# Core GlowScript/VPython 3D objects and their key attributes.
OBJECTS: dict = {
    "sphere": {
        "description": "A 3D sphere. The most common object for balls, planets, particles.",
        "attributes": {
            "pos": "vector position of the center",
            "radius": "float radius",
            "color": "color constant (color.red) or vector",
            "make_trail": "bool, leave a trail behind the object",
            "velocity": "vector velocity (user-defined attribute)",
        },
    },
    "box": {
        "description": "A rectangular box. Used for walls, floors, platforms.",
        "attributes": {
            "pos": "vector position of the center",
            "size": "vector(width, height, length)",
            "color": "color constant or vector",
            "axis": "vector orientation",
        },
    },
    "arrow": {
        "description": "An arrow. Used to visualize vectors, forces, velocities.",
        "attributes": {
            "pos": "vector tail position",
            "axis": "vector direction and length",
            "color": "color constant or vector",
            "shaftwidth": "float shaft thickness",
        },
    },
    "cylinder": {
        "description": "A cylinder. Used for rods, springs, axes.",
        "attributes": {
            "pos": "vector position of one end",
            "axis": "vector direction and length",
            "radius": "float radius",
            "color": "color constant or vector",
        },
    },
    "curve": {
        "description": "A polyline. Used for trajectories, graphs, trails.",
        "attributes": {
            "pos": "list of vectors defining the curve",
            "color": "color constant or vector",
            "radius": "float line thickness",
        },
    },
    "label": {
        "description": "A 2D text label attached to a 3D position.",
        "attributes": {
            "pos": "vector position in 3D space",
            "text": "string text to display",
            "color": "color constant or vector",
            "height": "float font height",
        },
    },
    "text": {
        "description": "A 3D text object rendered in the scene.",
        "attributes": {
            "pos": "vector position",
            "text": "string text to display",
            "color": "color constant or vector",
            "height": "float font height",
        },
    },
}

# Physics simulation templates: keyword matching + ready-to-run GlowScript code.
TEMPLATES: dict = {
    "projectile": {
        "description": "Projectile motion under gravity (parabolic trajectory).",
        "keywords": ["던지", "포물선", "projectile", "발사", "공을 위로", "throw"],
        "code": (
            "from vpython import *\n"
            "\n"
            "# Projectile motion\n"
            "scene = canvas()\n"
            "ball = sphere(pos=vector(0, 0, 0), radius=0.5, color=color.red, make_trail=True)\n"
            "floor = box(pos=vector(0, -1, 0), size=vector(20, 0.1, 1), color=color.green)\n"
            "ball.velocity = vector(5, 10, 0)\n"
            "g = vector(0, -9.8, 0)\n"
            "dt = 0.01\n"
            "while True:\n"
            "    rate(100)\n"
            "    ball.velocity += g * dt\n"
            "    ball.pos += ball.velocity * dt\n"
            "    if ball.pos.y < 0:\n"
            "        ball.velocity.y = -ball.velocity.y * 0.8\n"
        ),
    },
    "pendulum": {
        "description": "Simple pendulum swinging back and forth.",
        "keywords": ["진자", "흔들", "pendulum", "스윙", "swing"],
        "code": (
            "from vpython import *\n"
            "\n"
            "# Simple pendulum\n"
            "scene = canvas()\n"
            "pivot = vector(0, 5, 0)\n"
            "rod = cylinder(pos=pivot, axis=vector(0, -3, 0), radius=0.05, color=color.white)\n"
            "bob = sphere(pos=pivot + vector(0, -3, 0), radius=0.3, color=color.orange)\n"
            "theta = 0.5\n"
            "omega = 0\n"
            "L = 3\n"
            "g = 9.8\n"
            "dt = 0.01\n"
            "while True:\n"
            "    rate(100)\n"
            "    alpha = -(g / L) * sin(theta)\n"
            "    omega += alpha * dt\n"
            "    theta += omega * dt\n"
            "    bob.pos = pivot + vector(L * sin(theta), -L * cos(theta), 0)\n"
            "    rod.axis = bob.pos - pivot\n"
        ),
    },
    "spring": {
        "description": "Spring-mass system oscillating (simple harmonic motion).",
        "keywords": ["용수철", "진동", "spring", "oscillat", "탄성"],
        "code": (
            "from vpython import *\n"
            "\n"
            "# Spring-mass oscillator\n"
            "scene = canvas()\n"
            "ceiling = box(pos=vector(0, 5, 0), size=vector(4, 0.2, 1), color=color.gray)\n"
            "mass = sphere(pos=vector(0, 2, 0), radius=0.4, color=color.blue)\n"
            "spring = helix(pos=ceiling.pos, axis=mass.pos - ceiling.pos, radius=0.2, color=color.white)\n"
            "mass.velocity = vector(0, 0, 0)\n"
            "k = 20\n"
            "m = 1\n"
            "g = 9.8\n"
            "dt = 0.01\n"
            "while True:\n"
            "    rate(100)\n"
            "    force = -k * (mass.pos.y - 2) * vector(0, 1, 0) - m * g * vector(0, 1, 0)\n"
            "    mass.velocity += (force / m) * dt\n"
            "    mass.pos += mass.velocity * dt\n"
            "    spring.axis = mass.pos - ceiling.pos\n"
        ),
    },
    "orbit": {
        "description": "Planet orbiting a star under gravity.",
        "keywords": ["궤도", "행성", "별 주위", "orbit", "공전", "중력"],
        "code": (
            "from vpython import *\n"
            "\n"
            "# Orbital motion\n"
            "scene = canvas()\n"
            "star = sphere(pos=vector(0, 0, 0), radius=1, color=color.yellow)\n"
            "planet = sphere(pos=vector(5, 0, 0), radius=0.3, color=color.blue, make_trail=True)\n"
            "planet.velocity = vector(0, 0, 2)\n"
            "G = 1\n"
            "M = 100\n"
            "dt = 0.01\n"
            "while True:\n"
            "    rate(100)\n"
            "    r = planet.pos - star.pos\n"
            "    force = -G * M * norm(r) / mag(r) ** 2\n"
            "    planet.velocity += force * dt\n"
            "    planet.pos += planet.velocity * dt\n"
        ),
    },
    "free_fall": {
        "description": "Object falling freely under gravity.",
        "keywords": ["자유낙하", "떨어", "free fall", "낙하", "drop"],
        "code": (
            "from vpython import *\n"
            "\n"
            "# Free fall\n"
            "scene = canvas()\n"
            "ball = sphere(pos=vector(0, 10, 0), radius=0.5, color=color.red, make_trail=True)\n"
            "floor = box(pos=vector(0, -0.5, 0), size=vector(10, 0.1, 1), color=color.green)\n"
            "ball.velocity = vector(0, 0, 0)\n"
            "g = vector(0, -9.8, 0)\n"
            "dt = 0.01\n"
            "while True:\n"
            "    rate(100)\n"
            "    ball.velocity += g * dt\n"
            "    ball.pos += ball.velocity * dt\n"
            "    if ball.pos.y < 0:\n"
            "        ball.pos.y = 0\n"
            "        ball.velocity.y = 0\n"
        ),
    },
}


def list_objects() -> list:
    """Return the names of all known GlowScript objects."""
    return list(OBJECTS.keys())


def get_object(name: str) -> dict:
    """Return the knowledge entry for a single object. Raises KeyError if unknown."""
    return OBJECTS[name]


def list_templates() -> list:
    """Return the names of all known simulation templates."""
    return list(TEMPLATES.keys())


def get_template(name: str) -> dict:
    """Return a simulation template. Raises KeyError if unknown."""
    return TEMPLATES[name]


def search_knowledge(term: str) -> list:
    """Search objects and templates for a term. Returns matching entries."""
    term_lower = term.lower()
    results = []
    for name, obj in OBJECTS.items():
        if term_lower in name.lower() or term_lower in obj["description"].lower():
            results.append({"name": name, "type": "object", **obj})
    for name, tpl in TEMPLATES.items():
        if term_lower in name.lower() or term_lower in tpl["description"].lower():
            results.append({"name": name, "type": "template", **tpl})
    return results
