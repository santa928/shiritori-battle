# ブラウザーソース

`index.html` から `bootstrap.mjs` が辞書・対戦を起動します。ページの起動とモード切替、対戦イベント、画面描画（`ui/`）、かな切替（`input/`）、規則・状態制御・辞書取得を分けています。公開関数の契約は日本語JSDocを参照してください。

リポジトリのルートから `docker compose run --rm dev npm run verify` で検証します。ソースフォルダーを直接配信せず、`build-web.mjs` で作った出力を使います。辞書の元データがなくても、検証済み `publish/` の再利用でビルドできます。

[構成と責務](../docs/architecture.md)、[状態遷移](../docs/state-transitions.md)、[開発・包装・公開手順](../docs/release.md) を参照してください。
