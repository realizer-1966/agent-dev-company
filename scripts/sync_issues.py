#!/usr/bin/env python3
"""GitHub Issue <-> kanban synchronizer for the cloud office.

Reads open GitHub Issues (labels = kanban state) and mirrors them into the
local kanban DB, then pushes kanban state back as Issue labels/comments.

Usage (inside the GitHub Actions cloud-office workflow):
    python scripts/sync_issues.py sync --repo owner/repo
    python scripts/sync_issues.py dispatch
    python scripts/sync_issues.py status
"""
import argparse
import json
import os
import subprocess
import sys

# GitHub API token (injected by Actions) or local token
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GH_API = "https://api.github.com"
LABEL_MAP = {
    "backlog": "backlog",
    "ready": "ready",
    "in_progress": "in_progress",
    "review": "review",
    "done": "done",
}


def run_cmd(args, check=True):
    """Run a shell command and return (exit_code, stdout, stderr)."""
    proc = subprocess.run(args, capture_output=True, text=True)
    if check and proc.returncode != 0:
        print(f"CMD FAILED: {args}\n{proc.stderr}", file=sys.stderr)
    return proc.returncode, proc.stdout, proc.stderr


def gh_api(method, url, data=None):
    """Call the GitHub API via curl."""
    args = ["curl", "-s", "-X", method, url]
    if GITHUB_TOKEN:
        args += ["-H", "Authorization: token " + GITHUB_TOKEN]
    args += ["-H", "Accept: application/vnd.github.v3+json"]
    if data is not None:
        args += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    proc = subprocess.run(args, capture_output=True, text=True)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return proc.stdout


def get_open_issues(repo):
    """Return open issues with 'cloud-office' label or any issue."""
    url = f"{GH_API}/repos/{repo}/issues?state=open&per_page=100"
    return gh_api("GET", url)


def list_kanban_tasks():
    """Return current kanban tasks as JSON."""
    code, out, _ = run_cmd(["hermes", "kanban", "list", "--json"])
    if code != 0:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return []


def create_kanban_task(title, body, assignee):
    """Create a kanban task."""
    args = ["hermes", "kanban", "create", title]
    if assignee:
        args += ["--assignee", assignee]
    args += ["--body", body or title]
    code, out, _ = run_cmd(args)
    return out.strip()


def dispatch_once():
    """Run one dispatcher tick."""
    code, out, _ = run_cmd(["hermes", "kanban", "dispatch", "--once"])
    return code, out


def sync(repo):
    """Mirror open issues into kanban tasks."""
    issues = get_open_issues(repo)
    if not isinstance(issues, list):
        print(f"ERROR: could not list issues: {issues}", file=sys.stderr)
        return
    print(f"Found {len(issues)} open issues")
    for issue in issues:
        if "pull_request" in issue:
            continue  # skip PRs
        title = issue["title"]
        body = issue.get("body") or title
        number = issue["number"]
        labels = [l["name"] for l in issue.get("labels", [])]
        # Determine target state label
        state_label = next((l for l in ["ready", "backlog", "in_progress", "review", "done"] if l in labels), None)
        print(f"  #{number} [{labels}] {title}")
        # Simple create-if-missing (title-keyed)
        existing = list_kanban_tasks()
        if not any(t.get("title") == title for t in existing):
            assignee = None
            # If labeled with a role, use it
            for l in labels:
                if l in ("pm", "dev", "qa", "reviewer"):
                    assignee = l
            tid = create_kanban_task(title, body, assignee)
            print(f"    -> created {tid}")
        else:
            print("    -> already exists")


def main():
    parser = argparse.ArgumentParser(description="GitHub Issue <-> kanban sync")
    sub = parser.add_subparsers(dest="command", required=True)
    sync_p = sub.add_parser("sync", help="sync issues -> kanban")
    sync_p.add_argument("--repo", required=True, help="owner/repo")
    sub.add_parser("dispatch", help="run one dispatcher tick")
    sub.add_parser("status", help="show kanban status")
    args = parser.parse_args()

    if args.command == "sync":
        sync(args.repo)
    elif args.command == "dispatch":
        code, out = dispatch_once()
        print(out)
        sys.exit(code)
    elif args.command == "status":
        for t in list_kanban_tasks():
            print(t)


if __name__ == "__main__":
    main()
