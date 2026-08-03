"""CLI for todo-list — add and list commands."""
import sys
from datetime import datetime

import click

from todo_list.todo_list import TodoList


def _format_date(iso_str: str) -> str:
    """Format ISO datetime string to YYYY-MM-DD."""
    try:
        dt = datetime.fromisoformat(iso_str)
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return iso_str[:10] if iso_str else ""


@click.group()
@click.option("--data-path", default=None, help="Path to the JSON data file.")
@click.pass_context
def main(ctx, data_path):
    """A simple CLI todo-list manager."""
    ctx.ensure_object(dict)
    ctx.obj["todo_list"] = TodoList(data_path=data_path)


@main.command()
@click.argument("text")
@click.pass_context
def add(ctx, text):
    """Add a new todo item."""
    if not text.strip():
        click.echo("오류: 할일 내용이 비어있습니다.", err=True)
        sys.exit(1)
    todo_list = ctx.obj["todo_list"]
    todo = todo_list.add(text)
    click.echo(f"추가됨: [{todo['id']}] {todo['text']}")


@main.command()
@click.pass_context
def list(ctx):
    """List all todo items."""
    todo_list = ctx.obj["todo_list"]
    todos = todo_list.list()
    if not todos:
        click.echo("할일이 없습니다.")
        return
    for todo in todos:
        status = "✓" if todo["done"] else " "
        date = _format_date(todo.get("created_at", ""))
        click.echo(f"[{todo['id']}] [{status}] {todo['text']} ({date})")


if __name__ == "__main__":
    main()
