// 画面遷移のパラメータ型

export type RulesStackParamList = {
  RulesList: undefined;
  RuleEditor: {
    /** 編集するときの同期設定 ID。未指定なら新規作成 */
    ruleId?: string;
    /** 新規作成時の初期値 */
    sourceAccountId?: string;
    targetAccountId?: string;
  };
};

export type TabParamList = {
  Calendar: undefined;
  Rules: undefined;
  Accounts: undefined;
};
