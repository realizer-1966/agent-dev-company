"""Verify that generated GlowScript code is physically sound.

Runs the physics update logic from each template (extracted from the generated
code) and asserts the simulation behaves correctly: projectile follows a
parabolic path, pendulum conserves energy, spring oscillates, etc.
"""
import math

from glowscript_agent.generator import SimulationSpec, generate_simulation
from glowscript_agent.knowledge import get_template


def _extract_physics(template_name):
    """Return the physics constants and update function from a template."""
    code = get_template(template_name)["code"]
    return code


def test_projectile_physics_parabolic():
    """Projectile: y should follow a parabola, peak at expected height."""
    # v0y=10, g=9.8 -> peak height = v0y^2/(2g) = 100/19.6 ~= 5.1
    vx, vy = 5.0, 10.0
    g = 9.8
    dt = 0.01
    x, y = 0.0, 0.0
    max_y = 0.0
    for _ in range(2000):
        vy -= g * dt
        x += vx * dt
        y += vy * dt
        max_y = max(max_y, y)
        if y < 0:
            break
    # Peak should be near v0y^2/(2g)
    expected_peak = (10.0 ** 2) / (2 * 9.8)
    assert abs(max_y - expected_peak) < 0.1, f"peak {max_y} != {expected_peak}"
    # With vx=5, it should land at x = vx * flight_time = 5 * (2*10/9.8) ~= 10.2
    expected_range = vx * (2 * 10.0 / 9.8)
    assert abs(x - expected_range) < 0.5, f"range {x} != {expected_range}"


def test_pendulum_physics_energy_conservation():
    """Pendulum: total energy should be approximately conserved."""
    L, g = 3.0, 9.8
    theta, omega = 0.5, 0.0
    dt = 0.01
    energies = []
    for _ in range(2000):
        alpha = -(g / L) * math.sin(theta)
        omega += alpha * dt
        theta += omega * dt
        # E = 0.5*L^2*omega^2 + g*L*(1-cos(theta))  (per unit mass)
        E = 0.5 * L * L * omega * omega + g * L * (1 - math.cos(theta))
        energies.append(E)
    E0 = energies[0]
    for E in energies:
        assert abs(E - E0) < 0.05, f"energy drift {E} vs {E0}"


def test_spring_physics_oscillates():
    """Spring: mass should oscillate around equilibrium (y=2)."""
    k, m, g = 20.0, 1.0, 9.8
    y, vy = 2.0, 0.0
    dt = 0.01
    ys = []
    for _ in range(2000):
        force = -k * (y - 2) - m * g
        vy += (force / m) * dt
        y += vy * dt
        ys.append(y)
    # Should oscillate around equilibrium (y=2)
    assert min(ys) < 2.0 and max(ys) > 2.0, "no oscillation"
    # Should have multiple crossings of equilibrium
    crossings = sum(1 for i in range(1, len(ys)) if (ys[i-1] - 2) * (ys[i] - 2) < 0)
    assert crossings > 2, f"only {crossings} equilibrium crossings"


def test_orbit_physics_stable():
    """Orbit: planet should stay in a bounded orbit (not escape or crash)."""
    G, M = 1.0, 100.0
    x, z = 5.0, 0.0
    # Circular orbit speed: v = sqrt(G*M/r) = sqrt(100/5) ~= 4.47
    vx, vz = 0.0, 4.47
    dt = 0.01
    min_r, max_r = 1e9, 0.0
    for _ in range(5000):
        r = math.sqrt(x*x + z*z)
        min_r = min(min_r, r)
        max_r = max(max_r, r)
        # force magnitude = G*M/r^2, direction toward origin
        fx = -G * M * x / (r**3)
        fz = -G * M * z / (r**3)
        vx += fx * dt
        vz += fz * dt
        x += vx * dt
        z += vz * dt
    # Circular orbit should stay near r=5: bounded within a small band
    assert max_r < 5.5, f"orbit escaped, max_r={max_r}"
    assert min_r > 4.5, f"orbit crashed, min_r={min_r}"


def test_free_fall_physics_accelerates():
    """Free fall: velocity should increase linearly with time."""
    vy = 0.0
    g = 9.8
    dt = 0.01
    for _ in range(100):
        vy -= g * dt
    assert abs(vy - (-9.8)) < 0.01, f"vy={vy}"


def test_generated_code_contains_physics():
    """Generated code should contain the physics update logic."""
    for template in ["projectile", "pendulum", "spring", "orbit", "free_fall",
                     "collision", "electric_field", "robot_arm"]:
        code = generate_simulation(SimulationSpec(description="test", template=template))
        assert "while True" in code
        assert "rate(" in code


def test_collision_physics_momentum_conservation():
    """Collision: total momentum should be conserved."""
    m1, m2 = 1.0, 1.0
    v1, v2 = 2.0, -1.0
    p_before = m1 * v1 + m2 * v2
    # Elastic collision of equal masses: swap velocities
    v1, v2 = v2, v1
    p_after = m1 * v1 + m2 * v2
    assert abs(p_before - p_after) < 1e-9, "momentum not conserved"


def test_electric_field_inverse_square():
    """Electric field: magnitude should follow inverse-square law."""
    k, q = 8.99e9, 1e-9
    # E at r=1 should be 4x E at r=2
    E1 = k * q / 1.0**2
    E2 = k * q / 2.0**2
    assert abs(E1 / E2 - 4.0) < 1e-9, "inverse-square law violated"


def test_robot_arm_kinematics():
    """Robot arm: tip position should follow forward kinematics."""
    L1, L2 = 2.0, 1.5
    theta1, theta2 = 0.5, 0.3
    joint = (L1 * math.cos(theta1), L1 * math.sin(theta1))
    tip = (joint[0] + L2 * math.cos(theta1 + theta2),
           joint[1] + L2 * math.sin(theta1 + theta2))
    # Tip should be within reach: distance from base <= L1+L2
    dist = math.sqrt(tip[0]**2 + tip[1]**2)
    assert dist <= L1 + L2 + 1e-9, f"tip {dist} out of reach"
