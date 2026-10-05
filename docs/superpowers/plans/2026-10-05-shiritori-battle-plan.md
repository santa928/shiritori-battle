# しりとり対戦 Implementation Plan

> **実装担当向け:** 各タスクをテストで確認しながら順に進め、最後に独立した担当が全体レビューする。

**Goal:** 承認済みの対戦画面を既存サイトに追加し、辞書機能を維持したまま実際に2人で遊べる状態にする。

**Architecture:** 素のJavaScript/ES modulesを維持。純粋なルール・状態遷移、非同期辞書と時計、DOM画面の3責務に分ける。既存 createDictionaryClient.search と固定辞書区画を再利用し、新しいAPIサーバーやフレームワークは追加しない。

**Tech Stack:** Node.js >=22、node:test、HTML/CSS、既存GitHub Pages Actions。

**Spec:** [承認済み設計レビュー v1](https://chatgpt.com/api/library/files/libfile_b5973445919c819185895f091a8cae01/download)。画面基準は [主案 v1](https://chatgpt.com/api/library/files/libfile_6225a1a4366481918a5fedd4bfd53dd1/download)。実装時は両方を読む。

## Global Constraints

- dotのクラウド環境だけで実施。CodexWork、ユーザーPC、新規ホスティングへ移さない
- 1台を交互に使う2人対戦。個別／共有文字プール。1手30／60／120／180秒、初期30秒
- 先頭文字は消費免除。2文字目以降の消費文字は厳密に1回。ももは可、たまたまは不可。同じ読みは再使用不可
- 濁音・半濁音・小書きは基底かなのプールを共有。ーは無料。辞書用正規化を改変しない
- 接続は末字の濁点を保持、小書きは大書き、末尾ーは直前音の母音。1文字語不可。辞書適格な末尾ん、時間切れ、降参で敗北
- 初手・先攻はランダム。初手候補からん／を／ぢ／づを除く。個別プールを初期値にする
- 準備OKで計時。引き渡し・辞書通信待ちは停止。誤答で残り時間をリセットしない
- 5列10行の盤面から入力。仮使用は削除で復帰し、成功確定だけ本消費。相手残文字の開閉は入力保持・計時継続、共有時は同一プールと明示
- 適格候補が1件以上なら辞書条件成立。意味選択なし。成功時最大2語＋意味、他N件。勝負後は全履歴・意味・出典を表示
- 一般名詞と行政・自然地名を認め、人名・作品・動詞・形容詞は対象外。現行辞書判定を再利用
- 既存の辞書検索、出典、ライセンス、ハッシュ検証を維持。実装計画の承認と実行方法選択までは製品コードを書かない

## Review Focus

1. 濁点／小書きの切替と削除で仮使用が二重計上されない（Task 1）
2. 0秒境界、連打、遅い辞書応答で勝敗や手番が二重確定しない（Task 2）
3. 相手文字開閉と小画面でも入力・残り時間・決定操作を失わない（Task 3）
4. 同じ表記に複数語義がある場合、他N件と全結果に欠落・重複がない（Task 3）
5. ローカルでは動くが配布zipに新JSが入らない事故を検出する（Task 4）

## ファイル構成

新規 web/battle-rules.mjs はかな対応・消費と状態遷移、web/battle-controller.mjs は時計・辞書・競合制御、web/battle-app.mjs は画面とDOMイベントを担当。それぞれ同名の .test.mjs を隣接作成する。既存 web/app.mjs と dictionary.mjs は原則維持し、web/index.html と styles.css に対戦領域／切替を追加する。

### Task 1: ルールと対戦状態を固める

**Files:** 新規 web/battle-rules.mjs、web/battle-rules.test.mjs

**Interfaces:** baseKana(char) -> string、nextStart(reading) -> string|null、inspectDraft(reading,{start,pool,usedReadings}) -> {ok,reason,consumed}。createGame({mode,seconds,firstPlayer,start}) -> Game。applyAccepted(game,{reading,candidates,version,sources}) -> Game。Gameは phase、turn、start、pools、usedReadings、history、winner、mode、seconds を保持。phaseは ready/typing/checking/success/error/finished。

- [ ] 消費検査の失敗テストを先に作る。全かなが残る前提で assert.equal(inspectDraft('もも',ctx('も')).ok,true)、assert.equal(inspectDraft('たまたま',ctx('た')).ok,false)。ctxは開始文字・全プール・空履歴を作るテストfixture
- [ ] node --test web/battle-rules.test.mjs を実行し、未実装によるFAILを確認
- [ ] 上記インターフェースを最小実装。先頭を除いて基底かなを数え、重複または使用済みを拒否。draftから仮使用を毎回再計算し、変換前後の増減を二重適用しない
- [ ] テスト追加・実行：がが→か1消費、たはば→競合、きゃく→や/く消費、こーひー→こ免除/ひ消費、末字が→が／ゃ→や／ー→母音。固定先頭は消耗済みでも可、再出現は消費対象。個別は手番側のみ、共有は同じプールを更新。既使用読み・1文字・末尾んも検証し全PASS
- [ ] git add web/battle-rules* && git commit -m "feat: add strict single-use battle rules"

### Task 2: 時計と辞書を安全に接続する

**Files:** 新規 web/battle-controller.mjs、web/battle-controller.test.mjs

**Interfaces:** Task 1のGameを使用。createBattleController({game,client,now,onState}) -> {ready(),edit(reading),submit(),next(),retry(),resign(),tick(),destroy()}。nowは単調増加msの注入時計、onStateは現在Gameとdraft/remainingMs/feedbackを受け取る。clientは既存 search(reading) 契約そのまま。

- [ ] 注入時計と遅延Promiseで失敗テストを作る：初期30000ms、1秒経過で29000、照会待ち中不変、未登録なら29000から再入力。assert.equal(snapshot.remainingMs,29000)。30/60/120/180全選択と不正設定拒否を含める
- [ ] node --test web/battle-controller.test.mjs でFAIL確認
- [ ] ready→typing→checking→success/typing/error→ready/finishedを実装。送信時の手番と読みを固定し、受付時点の残り時間が正の送信のみ処理。eligible候補1件以上かを見てTask 1へ渡す。タイマーは経過差分で計算しinterval回数に依存しない
- [ ] 連打は照会1回・確定1回、古い応答とdestroy後応答は無視、通信失敗は敗北にせず同じ残秒でretry、誤答は無消費、残り0msの送信は負け、降参は一度だけ終了、を追加して全PASS。候補順と辞書version/sourcesを履歴へ保持
- [ ] git add web/battle-controller* && git commit -m "feat: connect battle timer and dictionary"

### Task 3: 画面・相手文字・結果をつなぐ

**Files:** 新規 web/battle-app.mjs、web/battle-app.test.mjs。変更 web/index.html、web/styles.css

**Interfaces:** mountBattleApp(root,{client,now}) -> {destroy()}。表示用 summarizeCandidates(candidates) -> {preview,remaining,all} は同一表記の語義をまとめ、採用可の語を最大2件、残りの語数を返す。既存辞書領域は独立して保持する。

- [ ] 表示モデルの失敗テスト作成：3採用語ならpreview.length=2、remaining=1、同じ表記の複数語義は1語に集約しallに全語義。非採用候補は成功表示から除く。node --test web/battle-app.test.mjs でFAIL確認
- [ ] 設定、準備、入力、成功、引き渡し、リザルトを作る。readonlyの単語表示＋タイル入力でOSキーボードを出さない。使用済み／仮使用／先頭免除を色と記号で区別。補助キーは濁点・半濁点・小書き・ー・削除
- [ ] 相手残文字をreadonly開閉表示し、開閉はcontrollerの状態や時計をリセットしない。狭い画面では一覧領域だけをスクロール可能にし、入力と決定は維持。共有時は「共通の残り文字」と表示
- [ ] 成功2語＋意味を120ms差で表示、「他N件」は0なら省略。待ち強制や意味選択を入れず次へ。reduced-motionは静止。リザルトの各手で全採用語・意味・安全な出典リンクを表示
- [ ] テスト全PASS後、クラウドブラウザーで390×844と320×568を確認。キーボード操作、仮使用後の削除/変換、相手開閉中の残秒進行、長い読み/意味、既存辞書への切替を実操作。スクリーンショットを主案と比較し重なり・切れを修正
- [ ] git add web/battle-app* web/index.html web/styles.css && git commit -m "feat: add battle screens and match results"

### Task 4: 固定辞書を保ち、回帰と公開物を検証する

**Files:** 変更 build-web.mjs、package-site.py、verify-site.mjs、web-build.test.mjs、verify-site.test.mjs、package.json、README.md、publish/site.zip、publish/site-manifest.json。既存 .github/workflows/pages.yml は原則維持

**Interfaces:** build-web.mjsへ rebuildWebFromPublished({siteDir,releaseManifest,outputDir}) -> {version} を追加。CLIは node build-web.mjs --reuse-published BASE_SITE BASE_MANIFEST NEW_OUTPUT。公開済み辞書のmanifestと全256区画を旧releaseManifestのhashで検証し、辞書version/bytes/dictionarySha256を維持して新UIとbuild-infoを出力する。

- [ ] 実装開始時、変更前mainで node verify-site.mjs を通し、publish/site.zipとmanifestを作業用に退避。原資料再取得や辞書再分類はこの作業に含めない
- [ ] 再利用ビルドの失敗テストを作る：辞書区画の改変はreject、成功時はversionと辞書bytesが完全一致、新しい3つのJSが配布物に含まれる。node --test web-build.test.mjs verify-site.test.mjs でFAIL確認
- [ ] 新JSをreleaseSources、コピー対象、Python側sources/allowlist、verify-site側allowlist/コピー検証へ追加。package.jsonのcheckにも追加。package-site.pyは原辞書JSON省略時にも検証済みbuild-infoのdictionarySha256を引き継ぐ。省略して検証を弱めない
- [ ] 退避したzipをBASE_SITEへ展開し、上記CLIで新しいdist/battle-reviewを生成。python3 package-site.py dist/battle-review、node verify-site.mjs dist/battle-review を実行し Verified source/archive/extracted files を確認
- [ ] npm test && npm run check を通す。既存辞書の採用可／対象外／保留／未確認／通信失敗を回帰確認。新配布zipを別フォルダへ展開してもう一度verify-siteを実行し、その配布物で2人の一試合を完走する
- [ ] 新しいレビュー担当が差分と承認仕様を確認。検出問題を修正し全検証を再実行してコミット。親へ変更内容、テスト証拠、画面、残る制約を返す
- [ ] 公開を許可された後にmainへ反映。Pages Actionsを成功まで確認し、公開URLで対戦と辞書を各1回確認する。公開許可がまだならここで止めて確認を求める

## 実行方法と完了条件

推奨は同じクラウド環境で順番に実装し、最後に別担当が全体レビューする方法。4タスクは依存関係が強く、細かく担当を分けるよりインターフェースのずれを抑えやすい。タスク単位で担当・レビューを分ける方法も選べる。

計画承認後に実行方法を選ぶ。ローカル完了は全テスト、画面確認、配布物検証、全体レビューが揃った時点。公開完了は、別途許可された公開のActions成功と公開サイト確認まで。計画作成時点では製品コード変更・公開はしていない。
