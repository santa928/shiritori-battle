# 辞書の土台と採用契約

辞書更新を行う人向けの入出力・出典・採用方針です。UIの変更だけなら原資料を再取得せず [release.md](release.md) の固定配布物再利用を使います。調査時点の数値は [dictionary-history.md](dictionary-history.md) に分けています。

## 方針

辞書に存在することと、対戦で使えることを分けます。動詞・人名も原資料として残し、読み・表記・品詞・語義・出典を保持します。判定側は語義ごとに採否と理由を返します。「同じ読みの動詞があるから名詞も全部不可」にはしません。語義は生成AIで補いません。

- `dictionary.mjs`: 読みの索引と語義候補、変更可能な採用ポリシー
- `import-jawiktionary.mjs`: 日本語版Wiktionaryの抽出形式を変換する保守的なアダプター
- `build.mjs`: ハッシュ照合、全日本語レコードの保存、索引・監査結果の生成
- `*.test.mjs`: Node標準テストと開発用linkedomによるDOMテスト。語義はすべてテスト専用の創作データで、実際の辞書として使いません
- `source.json`: 検証に使用したソースの固定情報

Node.js 22.13以降の22系／24以上。開発用テスト依存はDocker内の`npm ci`でインストールします。公開サイトの実行時依存はありません。

```sh
docker compose run --rm dev npm test
docker compose run --rm dev npm run check
docker compose run --rm dev node build.mjs /path/to/raw-wiktextract-data.jsonl.gz /path/to/new-output source.json supplement.json
```

[Kaikkiの日本語版rawデータ](https://kaikki.org/jawiktionary/rawdata.html)から別途取得します。配布URLは更新されるため、現在のダウンロードが保存済みSHA256と異なる場合は**停止**します。新しいスナップショットを採用する際は、日付・抽出器・ライセンス・ハッシュ・境界例を再確認してmanifestを更新してください。ハッシュだけを自動で書き換えないでください。

### 出力

- `archive.jsonl`: 全日本語レコードの原文、sourceId、元ファイル行番号、変換結果または保留理由。読みが取れない動詞や名前も削除しない
- `dictionary.json`: 読みを確定できたレコードの索引用データ。非採用語義も含む
- `report.json`: レコード数・保留理由・仮ポリシーでの候補数
- `source.json` / `ATTRIBUTION.txt`: 出典・ハッシュ・加工・ライセンス情報

出力先が既に存在する場合は上書きしません。原文アーカイブは開発用です。例文・引用・メディア等の追加条件を未監査のまま、そのまま配布・画面表示しないでください。

## 入出力の契約

```js
import {createDictionary} from './dictionary.mjs';
const dictionary = createDictionary(dataset);
const result = dictionary.lookup('コウチャ');
// 検索状態status: invalid-reading | not-found | candidates
// 語義候補candidates[]: entryId, senseId, spellings, readings, definitions,
//               pos, labels, readingEvidence, classificationEvidence,
//               source, sourceUrl, eligible, reasons
```

各語義の日本語説明を `definitions[{language:'ja', text}]` に保持します。`sourceId` はmanifestを参照し、`sourceUrl` は元記事を指します。品詞や原文のタグを失わず、辞書更新時に読み直せるようにします。抽出に永続的な語義IDがないため、entryIdはスナップショット＋行番号、senseIdは語義の位置です。**更新を跨ぐ同一語義判定には使えません。**

採用ポリシーは普通名詞と、根拠が明示された地名（行政地名・山川湖など）を許可します。人名・作品キャラクター名・動詞・形容詞・未分類の固有名詞・活用形・略語・数・未解決の参照・造語成分等は不採用です。元品詞は変えず、`name` は検索用に `proper-noun` と正規化し、原文の品詞・カテゴリ・タグはアーカイブに保持します。

地名の例外は `proper-noun` のみで、`place` があっても人名等の除外根拠が優先します。地名はソースの明示タグ・固定のカテゴリ名から分類し、`classificationEvidence` に元の値とentry/senseの範囲を残します。記事単位の地名根拠は1語義の項目のみ採用し、複数語義では語義単位の根拠を要求します。普通名詞のカテゴリは話題名の場合があるため、たとえば「職業姓」に「姓」カテゴリがあっても人名に変えません。名詞と「固有名詞」カテゴリの矛盾は従来どおり `classification-conflict` で保留します。`allowPlaces:false` で地名例外を無効にできます。

`eligible` は辞書ポリシー上の候補であり、末尾「ん」等も含め合法な手の最終判定ではありません。

```js
dictionary.lookup('...', {allowedPos:['noun','verb']});
// 原文や辞書全体を作り直さず、実験用ルールを変更できる
```

小書き・濁点・半濁点・長音は消さず、Unicode幅とカタカナ/ひらがなだけを検索用に正規化します。漢字から読みを推測せず、複数の読みと複数の語義を総当たりで結び付けません。

基本はかな見出し、またはタグが `transliteration` 単独の唯一の読みを採用します。先行対応は、これらが無い場合に限り、全語義の先頭に同一のかな読みが括弧で明示され、元の `forms` の読みもそれを裏付ける場合だけ回復するものです。下位語義に別の読みが明示されれば保留します。括弧だけで本文がないものも回復しません。`readingEvidence.method` で抽出方法を記録します。漢字一般の音訓だけ、本文からの推測、音声ファイル名、他項目からの無条件転用は採用しません。

## 合意済みの仕様と残件

最新合意は [Issue #2](https://github.com/santa928/shiritori-battle/issues/2#issuecomment-5986217847)、文字ルールは [Issue #3](https://github.com/santa928/shiritori-battle/issues/3)、表示は [Issue #4](https://github.com/santa928/shiritori-battle/issues/4) を参照してください。

- 普通名詞と地名はOK、人名・作品キャラクター名・動詞・形容詞はNG
- 同じ読みの適格語義が1件以上あれば辞書上の候補がある。語義を選ぶ操作は不要で、不適格な同音語が適格語を打ち消さない
- 表示は適格語だけを最大2件、残りはetc等。全件は勝負後のリザルトで読みごとに確認
- 辞書未登録は「存在しない」と断定せず即再入力。全候補が不適格の場合は理由を表示
- 先頭文字は消費対象外、2文字目以降を消費。個別プールと共有プールの両モード

辞書確認画面と、読み単位の再使用禁止・盤面・厳密1回の文字消費・勝敗を含むローカル2人対戦を実装しています。配布形式は検証済みの静的256区画と分割ZIPです。会社名・商品名や他語種の採否範囲を広げること、原文の引用等の追加条件の監査は今回の対象外です。

## 候補ソースと採用理由

1. **日本語版Wiktionary / Kaikki rawを第一候補**。読み・品詞・日本語の語義が取得でき、実データの変換を確認。英語版からの `/dictionary/Japanese` は英語語義なので代用しない。抽出の誤分類・収録偏り・読み欠落・記事単位の版ID欠落がある。rawは複数言語を含むので `lang_code=ja` が必要。
2. **日本語WordNet**。[公式配布](https://bond-lab.github.io/wnja/eng/downloads.html)は日本語語義とsynsetを提供するが、単独では読み・人名区分が足りない。[ライセンス](https://bond-lab.github.io/wnja/license.txt)の著作権表示・免責等を保持する必要がある。語の綴りだけをキーに別辞書の語義へ結合しない。
3. **JMdict / JMnedict**。[EDRDG](https://www.edrdg.org/wiki/Main_Page.html)は読み・品詞・名前分類の補強候補。ただしJMdictの翻訳語義は日本語の国語辞典的説明ではない。[利用条件](https://www.edrdg.org/edrdg/licence.html)と更新要件も確認する。形態素解析用辞書も語義表示の代替にならない。

現在は固定データをオフライン生成し、静的区画を必要時に取得します。辞書の版・ハッシュ・帰属を配布物へ固定し、通信障害と再試行を扱います。初期の配布形式検討は [調査・更新履歴](dictionary-history.md) に保存しています。

## ライセンスと出典表示

[日本語版Wiktionaryの方針](https://ja.wiktionary.org/wiki/Wiktionary:著作権)はCC BY-SA 4.0。[Wikimedia利用規約 §7](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use/en#7._Licensing_of_Content)に従い元記事リンクによる著者表示、ライセンスリンク、加工の明記、適用される追加表示の保持、再配布時の継承を行います。データのライセンスとアプリコードのライセンスは別です。コードの公開ライセンスはこの初期コミットでは設定していません。

画面では各語義に元記事リンクを付け、例えば「出典: ウィクショナリー日本語版の投稿者 / CC BY-SA 4.0。Kaikki/Wiktextractによる抽出データを整形・選別」と表示します。原文に含まれる引用等の追加条件は公開前の確認が必要です。

今回の抽出にはページ単位のrevision IDがありません。元記事リンクは現在版を表示します。固定したgzipハッシュ・dump日付・元行を保存し、存在しないoldidや正確な記事版を捏造しません。抽出schema: https://tatuylonen.github.io/wiktextract/ja.json
