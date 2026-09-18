#!/usr/bin/env python3
"""GitHub Actions 실행 상태 조회 - 토큰은 git remote URL 에서 추출한다.

사용:
  python3 scripts/ci_status.py              # 최근 8건
  python3 scripts/ci_status.py <run_id>     # 특정 실행의 job/step 상세
"""
import json
import subprocess
import sys
import urllib.request

REPO_DIR = "/root/workspace/agent-dev-company"
REPO = "realizer-1966/agent-dev-company"

COLON = ':'
AT = '@'
SLASH = '/'


def token():
    """https://<user>:<tok>@<host>/<path> 형태에서 <tok> 만 뽑는다."""
    url = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=REPO_DIR, capture_output=True, text=True, check=True,
    ).stdout.strip()
    if AT not in url:
        sys.exit("원격 URL 에 토큰이 없습니다")
    head, _host = url.split(AT, 1)
    _scheme, cred = head.split(SLASH + SLASH, 1)
    _user, tok = cred.split(COLON, 1)
    return tok


def api(path, tok):
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": "token " + tok,
            "Accept": "application/vnd.github+json",
            "User-Agent": "ci-status",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def main():
    tok = token()

    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        run_id = sys.argv[1]
        run = api("/repos/" + REPO + "/actions/runs/" + run_id, tok)
        print("=== " + run["name"] + " [" + run_id + "] ===")
        print("status=" + run["status"] + " conclusion=" + str(run.get("conclusion")))
        print("sha=" + run["head_sha"][:7] + " event=" + run["event"])
        print()
        jobs = api("/repos/" + REPO + "/actions/runs/" + run_id + "/jobs", tok)
        for job in jobs.get("jobs", []):
            print("JOB " + job["name"] + " - " + job["status"] + "/" + str(job.get("conclusion")))
            for step in job.get("steps", []):
                mark = {"success": "OK", "failure": "FAIL",
                        "skipped": "skip", "cancelled": "cancel"}.get(
                    step.get("conclusion") or "", "..")
                print("   [" + mark + "] " + step["name"])
        return

    runs = api("/repos/" + REPO + "/actions/runs?per_page=8", tok)
    items = runs.get("workflow_runs", []) or []
    if not items:
        print("실행 기록 없음:", str(runs)[:300])
        return
    for run in items:
        print("[" + str(run["id"]) + "] " + run["name"][:38] + "  "
              + run["status"] + "  " + str(run.get("conclusion") or "-")
              + "  " + run["head_sha"][:7])


if __name__ == "__main__":
    main()
