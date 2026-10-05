# 開発・包装・公開手順

開発実行・依存導入・検証・プレビューはDocker内で行います。Node.jsは22.13以降の22系または24以上、Pythonは3を使います。Composeは両方を含む `node:22-bookworm` を使い、標準bridgeで動きます。リポジトリを `/work` にマウントし、ホストのglobal依存は変更しません。

```sh
docker compose run --rm dev npm ci
docker compose run --rm dev npm run verify
```

`npm run verify` は `format:check`、`lint`、`check`、`test` の順です。整形だけを適用するコマンドは `npm run format`。ESLintは未定義・未使用・重複・到達不能などの基本ルールに限定します。`check` と `test` はルート・web・scriptsのmodule一覧を共有し、入れ子のテストも対象にします。distに退避した旧ソースのテストは混ぜません。Pythonの構文は必要時に `docker compose run --rm dev python3 -c "import ast,pathlib; ast.parse(pathlib.Path('package-site.py').read_text())"` で確認できます。

`.prettierignore` と `eslint.config.mjs` は辞書ランタイム、区画生成コード、固定対応表、fixturesを一括変更から外しています。`dictionary.mjs` と `reading-bucket.mjs` は再利用時にバイト一致が必要です。`build-web-dictionary.mjs` は辞書版の計算にも使うため、整形でも新しい版が発生します。これらを変更する必要があるときは、辞書更新として原資料・全区画・lookupの検証を行います。再利用のhash guardを緩めません。全 `.mjs` の構文検査と既存テストは除外しません。

## 元データがない環境での再包装

変更前の検証済みソース・配布物を独立したディレクトリへ保存します。ソースhash検証は変更前のソースで行う必要があります。以下の基準は現行公開済みmain `6a21b1643ab7ee06260a957b59f70f1583520eb8` です。最新remoteが変わった場合は、確認した公開済みrefへ読み替えます。新規出力先を使い、作業checkoutや既存の退避先を上書きしません。

```sh
mkdir -p dist/base-repo
git archive 6a21b1643ab7ee06260a957b59f70f1583520eb8 | tar -x -C dist/base-repo
docker compose run --rm dev node dist/base-repo/verify-site.mjs --assemble dist/base.zip
docker compose run --rm dev python3 -m zipfile -e dist/base.zip dist/base-site
docker compose run --rm dev node dist/base-repo/verify-site.mjs dist/base-site
```

旧2版も公開済み成果物から取得できます。現行版に同梱した旧版は自動継承されないため、それぞれの公開manifestを明示します。

```sh
mkdir -p dist/old-f667 dist/old-74cb
git archive 6bacea4 publish | tar -x -C dist/old-f667
git archive 4a94cf5 publish | tar -x -C dist/old-74cb
```

展開前に分割パートまたは従来の単一ZIPを検証します。以下は現行の `readPublishedArchive` を使い、ZIP全体とパートの順序・サイズ・SHA-256を検証した結果だけを書き出します。

```sh
docker compose run --rm dev node --input-type=module -e '
import { readFile, writeFile } from "node:fs/promises";
import { readPublishedArchive } from "./build-web.mjs";
for (const dir of ["dist/old-f667", "dist/old-74cb"]) {
  const manifest = JSON.parse(await readFile(dir + "/publish/site-manifest.json"));
  await writeFile(dir + "/verified.zip", await readPublishedArchive(dir + "/publish", manifest), { flag: "wx" });
}
'
docker compose run --rm dev python3 -m zipfile -e dist/old-f667/verified.zip dist/old-f667/site
docker compose run --rm dev python3 -m zipfile -e dist/old-74cb/verified.zip dist/old-74cb/site
```

現行の辞書 `v1-8e50511dc3c936bd` と明示した旧版 `v1-f667664edefe998d`、`v1-74cbc1f057467d8b` を再利用してUIだけを構築します。

```sh
docker compose run --rm dev npm run build:web -- \
  --reuse-published dist/base-site dist/base-repo/publish/site-manifest.json dist/web \
  --retain-published dist/old-f667/site dist/old-f667/publish/site-manifest.json \
  --retain-published dist/old-74cb/site dist/old-74cb/publish/site-manifest.json
docker compose run --rm dev npm run package:site -- dist/web
docker compose run --rm dev npm run verify:site -- dist/web
```

再利用は最新manifest・256区画・ATTRIBUTION・build-info・辞書ランタイムのハッシュを照合します。旧版も256区画の参照先・ハッシュ・サイズ・版・出典を検証し、辞書ファイルだけをコピーします。保持は最新1版＋明示した旧版最大2版。旧manifestの `retainedVersions` を再帰的に引き継ぎません。別の旧版を保持する必要があれば、その公開済み成果物を同じ手順で検証します。hash不一致や元成果物不足なら停止し、原資料を推測で再生成しません。

`build-web.mjs` は新規出力先を要求し、処理途中に失敗すると作成中の出力を片付けます。`package-site.py` は既定で追跡対象の `publish/` を更新します。通常のUI再包装では辞書JSONを省略して上のコマンドを使い、生成した配布物も差分レビューに含めます。

## 原資料からの辞書更新

今回は辞書更新をしません。固定SHAと一致する元raw・補足データがそろった場合だけ、[辞書の契約](dictionary.md)に従って実行します。

```sh
docker compose run --rm dev node build.mjs RAW_JSONL_GZ NEW_DICTIONARY_BUILD source.json supplement.json
docker compose run --rm dev npm run build:web -- NEW_DICTIONARY_BUILD dist/web \
  --retain-published OLD_SITE OLD_MANIFEST
docker compose run --rm dev npm run package:site -- dist/web NEW_DICTIONARY_BUILD/dictionary.json
```

`verify-corpus.mjs`、`check-regression-sample.mjs`、必要な `verify-similar-readings.mjs` で元データと生成辞書を確認します。配布URLの現在のファイルが保存済みSHAと違えば停止します。ハッシュだけを書き換えません。

## 配布仕様とCI

`scripts/release-assets.json` が唯一のソース一覧・コピー一覧・静的公開ファイル仕様です。Nodeのbuild/verifyとPythonのpackageが同じ仕様を読みます。追加moduleは `copiedSources` に登録し、生成・包装・配布検証・ソースhashを揃えます。辞書は版ごとにmanifest＋256区画を追加します。余分なファイル・シンボリックリンク・区画参照の逸脱を拒否します。対応する回帰テストは `web-build.test.mjs`、`retain-dictionary.test.mjs`、`package-site.test.mjs`、`verify-site.test.mjs` です。

ソースhashをbuild-infoとpublish manifestに入れるため、整形だけでも再包装が必要です。ZIPは固定の時刻・順序・圧縮設定で作り、最大8 MiBの分割パートを保存します。manifestにはパートの順序・サイズ・SHA-256とZIP全体のサイズ・SHA-256を保存します。未検証のglobを連結して配信しません。

公開前にCIと同じ展開検証を行います。

```sh
docker compose run --rm dev npm run verify
docker compose run --rm dev npm run verify:site -- --assemble dist/release-check.zip
docker compose run --rm dev python3 -m zipfile -e dist/release-check.zip dist/release-check
docker compose run --rm dev npm run verify:site -- dist/release-check
```

PRとmain以外のpushは `quality.yml` で整形/lint/構文/tests/配布検証を実行します。mainのPages workflowも同じ品質gateを通し、検証済みZIPを再構成・展開し、公開ファイルだけをupload/deployします。ローカルの `dist/`、原資料、検証ログはpushに含めません。

mainへのpush・merge・Pages公開は別途承認する操作です。レビューでは整形だけのコミット、構造・契約・gateのコミット、配布物更新のコミットを分けて確認します。

## プレビュー

```sh
docker compose up preview
```

ホスト側は `127.0.0.1:4173` に限定します。既存サービスが4173を使っている場合は `SHIRITORI_PREVIEW_PORT=4177 docker compose up preview` のように別ポートを選べます。コンテナー内だけ `PREVIEW_HOST=0.0.0.0` とし、Dockerのポート転送を受けます。`serve-web.mjs` の通常実行は従来どおり `127.0.0.1` が既定です。終了はCtrl-C、必要に応じて `docker compose down`。別プロジェクトのコンテナーは停止しません。
