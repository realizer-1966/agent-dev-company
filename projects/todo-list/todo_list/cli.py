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
@click.option("--category", "-c", default="일반", help="할일 카테고리 (기본: 일반)")
@click.pass_context
def add(ctx, text, category):
    """Add a new todo."""
    tl = ctx.obj["todo_list"]
    todo = tl.add(text, category=category)
    click.echo(f"할일 추가됨: [{todo['id']}] [{todo['category']}] {todo['text']}")


@main.command()
@click.option("--by-category", is_flag=True, help="카테고리별로 그룹화하여 표시")
@click.pass_context
def list(ctx, by_category):
    """List all todos."""
    tl = ctx.obj["todo_list"]
    items = tl.list()
    if not items:
        click.echo("할일이 없습니다.")
        return

    if by_category:
        grouped = tl.list_by_category()
        for cat in sorted(grouped):
            click.echo(f"\n[{cat}]")
            for todo in grouped[cat]:
                done_mark = "✓" if todo["done"] else " "
                created = datetime.fromisoformat(todo["created_at"]).strftime("%Y-%m-%d")
                click.echo(f"  [{todo['id']}] [{done_mark}] {todo['text']} ({created})")
    else:
        for todo in items:
            done_mark = "✓" if todo["done"] else " "
            created = datetime.fromisoformat(todo["created_at"]).strftime("%Y-%m-%d")
            cat = todo.get("category", "일반")
            click.echo(f"[{todo['id']}] [{done_mark}] [{cat}] {todo['text']} ({created})")


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


@main.command()
@click.pass_context
def categories(ctx):
    """List all categories."""
    tl = ctx.obj["todo_list"]
    cats = tl.categories()
    if not cats:
        click.echo("카테고리가 없습니다.")
        return
    click.echo("카테고리 목록:")
    for cat in cats:
        count = len([t for t in tl.list() if t.get("category", "일반") == cat])
        click.echo(f"  [{cat}] ({count}개)")


if __name__ == "__main__":
    main()
