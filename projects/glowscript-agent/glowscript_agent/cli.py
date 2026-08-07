"""Command-line interface for glowscript-agent."""
import click

from glowscript_agent.generator import SimulationSpec, generate_simulation, match_template
from glowscript_agent.knowledge import get_object, get_template, list_objects, list_templates
from glowscript_agent.validator import validate_file


@click.group()
def main():
    """GlowScript agent: generate and validate GlowScript physics simulations."""


@main.command()
@click.argument("description")
def generate(description: str):
    """Generate GlowScript code from a natural-language description."""
    template = match_template(description)
    spec = SimulationSpec(description=description, template=template)
    click.echo(generate_simulation(spec))


@main.command()
@click.argument("name")
def knowledge(name: str):
    """Show knowledge about a GlowScript object or template."""
    try:
        obj = get_object(name)
        click.echo(f"Object: {name}")
        click.echo(f"  {obj['description']}")
        for attr, desc in obj["attributes"].items():
            click.echo(f"  - {attr}: {desc}")
        return
    except KeyError:
        pass
    try:
        tpl = get_template(name)
        click.echo(f"Template: {name}")
        click.echo(f"  {tpl['description']}")
        click.echo(f"  Keywords: {', '.join(tpl['keywords'])}")
        return
    except KeyError:
        pass
    click.echo(f"Unknown: {name}")
    click.echo(f"Objects: {', '.join(list_objects())}")
    click.echo(f"Templates: {', '.join(list_templates())}")


@main.command()
@click.argument("path")
def validate(path: str):
    """Validate a GlowScript code file."""
    result = validate_file(path)
    if result.valid:
        click.echo("VALID: GlowScript code is structurally sound.")
    else:
        click.echo("INVALID:")
        for err in result.errors:
            click.echo(f"  - {err}")


if __name__ == "__main__":
    main()
