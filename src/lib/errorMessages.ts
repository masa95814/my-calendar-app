/**
 * バックエンドのコールバックが return_to?error= で返すコードを、利用者向けの文言にする。
 * コードの一覧は server/README.md を参照。
 */
export function describeAuthError(code: string): string {
  switch (code) {
    case "not_allowed":
      return "このアカウントはこのアプリの利用を許可されていません。";
    case "expired":
      return "有効期限が切れました。もう一度お試しください。";
    case "access_denied":
      return "Google での認証がキャンセルされました。";
    case "missing_refresh_token":
      return "Google から更新用の認証情報が返されませんでした。Google アカウントの「サードパーティ製のアプリとサービス」からこのアプリを削除して、もう一度連携してください。";
    case "insufficient_scope":
      return "カレンダーへのアクセスが許可されませんでした。同意画面ですべての項目にチェックを入れてください。";
    case "calendar_api_disabled":
      return "サーバー側で Google Calendar API が有効化されていません。";
    case "invalid_grant":
    case "invalid_client":
    case "redirect_uri_mismatch":
      return `サーバーの OAuth 設定に問題があります（${code}）。`;
    case "callback_failed":
      return "サーバーでの処理に失敗しました。サーバーのログを確認してください。";
    default:
      return `処理に失敗しました（${code}）。`;
  }
}
