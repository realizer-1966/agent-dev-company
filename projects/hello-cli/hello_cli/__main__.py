"""CLI 진입점: python -m hello_cli <이름>"""

import sys

from hello_cli import greet


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print("사용법: python -m hello_cli <이름>")
        return 1
    print(greet(" ".join(args)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
