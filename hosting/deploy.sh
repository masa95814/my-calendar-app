#!/usr/bin/env bash
# hosting/public を Firebase Hosting（既定のサイト）に公開する。
# ホームページとプライバシーポリシーは OAuth 同意画面の「ブランディング」に登録する URL。
#
# 使い方: ./hosting/deploy.sh [プロジェクト ID]
# firebase-tools は使わず、gcloud のログイン情報で Firebase Hosting の REST API を呼ぶ。
set -euo pipefail

cd "$(dirname "$0")"
PROJECT="${1:-$(gcloud config get-value project 2>/dev/null)}"
SITE="${SITE:-$PROJECT}"
API="https://firebasehosting.googleapis.com/v1beta1"

gcloud services enable firebasehosting.googleapis.com --project "$PROJECT" >/dev/null
ACCESS_TOKEN="$(gcloud auth print-access-token)"

# gcloud 用に指定した Python（3.10 以上、HTTPS 対応）を優先する。システムの python3 が古い場合があるため
PYTHON="${CLOUDSDK_PYTHON:-python3}"

"$PYTHON" - "$PROJECT" "$SITE" "$API" "$ACCESS_TOKEN" <<'PY'
import gzip, hashlib, io, json, os, sys, urllib.request

project, site, api, token = sys.argv[1:5]
headers = {
    "Authorization": f"Bearer {token}",
    "x-goog-user-project": project,
    "Content-Type": "application/json",
}

def call(method, url, body=None, content_type=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = dict(headers)
    if content_type:
        h["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req) as res:
        text = res.read().decode() or "{}"
        return json.loads(text)

# 1. ファイルを gzip し、SHA-256 を求める（gzip の時刻を固定して、同じ内容なら同じハッシュにする）
files, blobs = {}, {}
for root, _, names in os.walk("public"):
    for name in sorted(names):
        path = os.path.join(root, name)
        with open(path, "rb") as f:
            buf = io.BytesIO()
            # Python 3.7 でも動くよう GzipFile で mtime を固定する
            with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as z:
                z.write(f.read())
            gz = buf.getvalue()
        digest = hashlib.sha256(gz).hexdigest()
        files["/" + os.path.relpath(path, "public")] = digest
        blobs[digest] = gz

# 2. バージョンを作成（拡張子なしのパスでも .html を返す）
# 検索エンジンに載せないよう、全ページに X-Robots-Tag を付ける（robots.txt と meta タグでも指定）
version = call("POST", f"{api}/sites/{site}/versions", {"config": {
    "cleanUrls": True,
    "headers": [{"glob": "**", "headers": {"X-Robots-Tag": "noindex, nofollow, noarchive"}}],
}})["name"]

# 3. ファイル一覧を登録し、未アップロードのものだけ送る
populated = call("POST", f"{api}/{version}:populateFiles", {"files": files})
for digest in populated.get("uploadRequiredHashes", []):
    call("POST", f"{populated['uploadUrl']}/{digest}", raw=blobs[digest], content_type="application/octet-stream")

# 4. 確定して公開
call("PATCH", f"{api}/{version}?update_mask=status", {"status": "FINALIZED"})
call("POST", f"{api}/sites/{site}/releases?versionName={version}", {})
print(f"公開しました: https://{site}.web.app （{len(files)} ファイル）")
for path in sorted(files):
    print(f"  https://{site}.web.app{path}")
PY
