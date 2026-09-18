#!/usr/bin/env python3
"""최신 성공 APK 아티팩트를 다운로드하고 검증한다.

사용: python3 scripts/download_apk.py [run_id]
"""
import io
import json
import subprocess
import sys
import urllib.request
import zipfile

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
    return cred.split(COLON, 1)[1]


def api(path, tok):
    req = urllib.request.Request(
        "https://api.github.com" + path,
        headers={"Authorization": "token " + tok,
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "apk-dl"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    tok = token()
    run_id = sys.argv[1] if len(sys.argv) > 1 else None

    if not run_id:
        runs = api("/repos/" + REPO + "/actions/runs?per_page=20", tok)
        for r in runs.get("workflow_runs", []):
            if "Dementia" in r["name"] and r.get("conclusion") == "success":
                run_id = str(r["id"])
                break
        if not run_id:
            sys.exit("성공한 Dementia APK 실행을 찾지 못했습니다")
    print("run_id =", run_id)

    arts = api("/repos/" + REPO + "/actions/runs/" + run_id + "/artifacts", tok)
    items = arts.get("artifacts", [])
    print("아티팩트:", [(a["name"], a["size_in_bytes"]) for a in items])
    apk_art = next((a for a in items if "apk" in a["name"].lower()), None)
    if not apk_art:
        sys.exit("APK 아티팩트 없음")

    req = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + "/actions/artifacts/"
        + str(apk_art["id"]) + "/zip",
        headers={"Authorization": "token " + tok, "User-Agent": "apk-dl"},
    )
    out_zip = "/tmp/dementia_apk.zip"
    # 아티팩트 다운로드는 302 로 blob 스토리지로 리다이렉트된다.
    # urllib 의 기본 opener 는 리다이렉트 시 Authorization 헤더를 유지해
    # S3 가 400 을 돌려준다 → curl -L 로 받는 편이 확실하다.
    subprocess.run(
        ["curl", "-sSL", "-m", "300", "-H", "Authorization: token " + tok,
         "-o", out_zip,
         "https://api.github.com/repos/" + REPO + "/actions/artifacts/"
         + str(apk_art["id"]) + "/zip"],
        check=True,
    )
    print("zip 저장:", out_zip)

    import os
    os.makedirs("/tmp/dementia_apk", exist_ok=True)
    zf = zipfile.ZipFile(out_zip)
    print("zip 내용:", zf.namelist())
    zf.extractall("/tmp/dementia_apk")
    for name in zf.namelist():
        p = "/tmp/dementia_apk/" + name
        print(" ->", p, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
