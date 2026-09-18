#!/usr/bin/env python3
"""CI 실행의 실패 로그를 가져와 출력한다.

사용: python3 scripts/ci_log.py <run_id>
"""
import json
import subprocess
import sys
import urllib.request
import zipfile
import io

REPO_DIR = "/root/workspace/agent-dev-company"
REPO = "realizer-1966/agent-dev-company"
COLON = chr(58)
AT = chr(64)
SLASH = chr(47)


def token():
    url = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=REPO_DIR, capture_output=True, text=True, check=True,
    ).stdout.strip()
    head, _host = url.split(AT, 1)
    _scheme, cred = head.split(SLASH + SLASH, 1)
    _user, tok = cred.split(COLON, 1)
    return tok


def main():
    run_id = sys.argv[1]
    tok = token()
    req = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + "/actions/runs/" + run_id + "/logs",
        headers={"Authorization": "token " + tok, "User-Agent": "ci-log"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        blob = resp.read()
    print("logs zip bytes:", len(blob))
    zf = zipfile.ZipFile(io.BytesIO(blob))
    for name in zf.namelist():
        print("===", name, "===")
        text = zf.read(name).decode("utf-8", "replace")
        lines = text.splitlines()
        # 관심 구간만: 오류 언급 줄 + 그 주변
        for i, line in enumerate(lines):
            low = line.lower()
            if ("error" in low or "failed" in low or "not found" in low
                    or "cp:" in low or "no such" in low):
                lo = max(0, i - 2)
                hi = min(len(lines), i + 6)
                print("\n".join(lines[lo:hi]))
                print("---")
        print()


if __name__ == "__main__":
    main()
