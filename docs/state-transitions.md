# 対戦・検索の状態遷移

対戦の遷移は `web/battle-controller.mjs`、確定と文字の規則は `web/battle-rules.mjs` が担当します。UIの設定画面はgameのphaseではなく、controllerを破棄している状態です。

| 現在 | 操作・結果 | 次 | 時間と消費 |
| --- | --- | --- | --- |
| 設定画面 | start | ready | 常にプレイヤー1から開始。両プールを新規作成 |
| ready | ready | typing | 制限時間を設定し、nowから計測開始 |
| typing | edit | typing | 経過時間を差し引き、下書きを検査。消費はまだ確定しない |
| typing | submit（入力規則違反） | typing | 残り時間を維持し、理由を表示 |
| typing | submit（入力規則OK） | checking | 残り時間を固定し、検索tokenを発行 |
| checking | 採用可能な語義あり | success | 文字消費・既使用読み・次の先頭・履歴を確定 |
| checking | 採用可能な「ん」末尾 | finished | 入力と語義を履歴に残す。文字を消費せず相手の勝ち |
| checking | 対象外・保留・未確認 | typing | 残り時間をリセットせず、応答時刻から計測再開 |
| checking | 取得/検証失敗 | error | 時間停止とnetwork-error表示 |
| error | retry | checking | 同じ下書きを確認。残り時間は固定したまま |
| checking / error | cancelCheck | typing | tokenを無効化し、残り時間を維持して計測再開 |
| error | edit | typing | cancelCheckで復帰してから編集。時間をリセットしない |
| success | next | ready | 手番を交替。次のready操作まで計測しない |
| typing | tickまたは操作で残り0 | finished | timeoutで相手の勝ち |
| typing / checking / error | resign | finished | tokenを無効化してresignedで相手の勝ち |
| 任意 | destroy | 通知停止 | タイマー基準とtokenを無効化し、遅延応答を無視 |

降参確認を開くこと、相手文字を見ることでは時間を止めません。時計表示は100msごとのtickで更新しますが、減算はtick回数ではなく注入した単調増加のnowとの差です。負の差は減算に使わず、時間切れが優先されます。UIは `remainingMs` を描画するだけです。

入力は正規化済みのひらがなで最大64文字、確定は2文字以上、先頭は固定です。先頭の1文字は消費なし。2文字目以降は濁点/半濁点を除き、小書きを大書きにした基底かなを1回だけ消費します。長音符は無料。末尾の連続長音符を飛ばし、次の先頭では濁点/半濁点を保持、小書きだけを大書きにします。「んー」の末尾は拒否します。inspectDraft失敗時のconsumedは途中までの検査結果なので、確定消費に使いません。

`applyAccepted` は元のgameと候補を変更せず複製を返し、辞書版と元候補を履歴に固定します。sharedモードは確定時に両プールを揃えます。同義表示は固定対応表の全メンバーが一致した場合だけまとめ、元候補の採否・証拠は変えません。

確認中のtokenとactiveフラグにより、キャンセル後・降参後・新しい確認後・destroy後の古い応答は状態を書き換えません。辞書クライアントは本文転送を含めた期限を持ち、失敗した区画Promiseをキャッシュから外します。再試行時はbuild-infoから現在版を調べます。古い同時要求の失敗で、新しいmanifest要求を無効にしません。

辞書検索は独立した `loading → result / error`。IME変換中の送信は無視し、最新sequenceだけを通知します。errorの再試行は直前の入力を使います。対戦中は辞書タブをロックし、終了時に解除します。

確認するテストは `web/battle-controller.test.mjs`（時刻・遅延応答・retry/cancel）、`web/battle-rules.test.mjs`（消費・長音・確定）、`web/battle-app.test.mjs`（入力・フォーカス・装飾・復帰）、`web/dictionary-client.test.mjs`（検証・取得期限・再試行）、`web/bootstrap.test.mjs`（起動・タブ・破棄）。
