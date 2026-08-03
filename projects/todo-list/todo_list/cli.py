"""CLI entry point for todo-list using Click."""
from datetime import datetime, timezone

import click

from todo_list.todo_list import TodoList


@click.group()
@click.option(
    "--data-path",
    default=None,
    help="Path to the JSON data file (default: todos.json in project root).",
)
@click.pass_context
def main(ctx, data_path):
    """A simple CLI todo-list manager."""
    ctx.ensure_object(dict)
    ctx.obj["todo_list"] = TodoList(data_path=data_path)


@main.command()
@click.argument("text")
@click.pass_context
def add(ctx, text):
    """Add a new todo."""
    tl = ctx.obj["todo_list"]
    todo = tl.add(text)
    click.echo(f"할일 추가됨: [{todo['id']}] {todo['text']}")


@main.command()
@click.pass_context
def list(ctx):
    """List all todos."""
    tl = ctx.obj["todo_list"]
    items = tl.list()
    if not items:
        click.echo("할일이 없습니다.")
        return
    for todo in items:
        done_mark = "✓" if todo["done"] else " "
        created = datetime.fromisoformat(todo["created_at"]).strftime("%Y-%m-%d")
        click.echo(f"[{todo['id']}] [{done_mark}] {todo['text']} ({created})")


@main.command()
@click.argument("todo_id", type=int)
@click.pass_context
def done(ctx, todo_id):
    """Mark a todo as done."""
    tl = ctx.obj["todo_list"]
    try:
        todo = tl.done(todo_id)
        click.echo(f"할일 완료: [{todo['id']}] {todo['text']}")
    except ValueError as e:
        click.echo(str(e), err=True)
        raise click.Abort()


@main.command()
@click.argument("todo_id", type=int)
@click.pass_context
def remove(ctx, todo_id):
    """Remove a todo."""
    tl = ctx.obj["todo_list"]
    try:
        tl.remove(todo_id)
        click.echo(f"할일 삭제됨: [{todo_id}]")
    except ValueError as e:
        click.echo(str(e), err=True)
        raise click.Abort()
