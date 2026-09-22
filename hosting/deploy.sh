#!/usr/bin/env bash
# hosting/public を Firebase Hosting（既定のサイト）に公開する。
# ホームページとプライバシーポリシーは OAuth 同意画面の「ブランディング」に登録する URL。
#
# 使い方: ./hosting/deploy.sh [プロジェクト ID]
#   サイトと公開するフォルダは環境変数で変えられる:
#     SITE=<サイト ID>  PUBLIC_DIR=<フォルダ>  SPA=1（全パスを /index.html に振り分ける。Web 版アプリ用）
# firebase-tools は使わず、gcloud のログイン情報で Firebase Hosting の REST API を呼ぶ。
set -euo pipefail

cd "$(dirname "$0")"
PROJECT="${1:-$(gcloud config get-value project 2>/dev/null)}"
SITE="${SITE:-$PROJECT}"
PUBLIC_DIR="$(cd "${PUBLIC_DIR:-public}" && pwd)"
SPA="${SPA:-0}"
API="https://firebasehosting.googleapis.com/v1beta1"

gcloud services enable firebasehosting.googleapis.com --project "$PROJECT" >/dev/null
ACCESS_TOKEN="$(gcloud auth print-access-token)"

# gcloud 用に指定した Python（3.10 以上、HTTPS 対応）を優先する。システムの python3 が古い場合があるため
PYTHON="${CLOUDSDK_PYTHON:-python3}"

"$PYTHON" - "$PROJECT" "$SITE" "$API" "$ACCESS_TOKEN" "$PUBLIC_DIR" "$SPA" <<'PY'
import gzip, hashlib, io, json, os, sys, urllib.request

project, site, api, token, public_dir, spa = sys.argv[1:7]
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
for root, _, names in os.walk(public_dir):
    for name in sorted(names):
        path = os.path.join(root, name)
        with open(path, "rb") as f:
            buf = io.BytesIO()
            # Python 3.7 でも動くよう GzipFile で mtime を固定する
            with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as z:
                z.write(f.read())
            gz = buf.getvalue()
        digest = hashlib.sha256(gz).hexdigest()
        files["/" + os.path.relpath(path, public_dir)] = digest
        blobs[digest] = gz

# 2. バージョンを作成（拡張子なしのパスでも .html を返す）
# 検索エンジンに載せないよう、全ページに X-Robots-Tag を付ける（robots.txt と meta タグでも指定）
config = {
    "cleanUrls": True,
    "headers": [{"glob": "**", "headers": {"X-Robots-Tag": "noindex, nofollow, noarchive"}}],
}
if spa == "1":
    # 画面遷移やログイン後の戻り先（/auth など）もアプリ本体で受ける
    config["rewrites"] = [{"glob": "**", "path": "/index.html"}]
version = call("POST", f"{api}/sites/{site}/versions", {"config": config})["name"]

# 3. ファイル一覧を登録し、未アップロードのものだけ送る
populated = call("POST", f"{api}/{version}:populateFiles", {"files": files})
for digest in populated.get("uploadRequiredHashes", []):
    call("POST", f"{populated['uploadUrl']}/{digest}", raw=blobs[digest], content_type="application/octet-stream")

# 4. 確定して公開
call("PATCH", f"{api}/{version}?update_mask=status", {"status": "FINALIZED"})
call("POST", f"{api}/sites/{site}/releases?versionName={version}", {})
print(f"公開しました: https://{site}.web.app （{len(files)} ファイル）")
if spa != "1":
    for path in sorted(files):
        print(f"  https://{site}.web.app{path}")
PY
