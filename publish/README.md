# 検証済み配布物

`site.zip.part001` 以降は1パート最大8 MiBの分割ZIPです。`site-manifest.json` に順序・サイズ・各パートとZIP全体のSHA-256、ソースhash、辞書版、配布ファイルのhashを記録します。辞書データはCC BY-SA 4.0で、帰属表示をZIPに含めます。

ソース変更後は [開発・包装・公開手順](../docs/release.md) に従ってDocker内でビルド・再包装してください。整形だけでもソースhashが変わるため再包装が必要です。原資料がない環境では検証済み公開物を再利用できます。

`verify-site.mjs --assemble NEW_ARCHIVE_PATH` はパート・全体・ソースを検証し、新規出力先へZIPを構成します。Pythonで展開した後、`verify-site.mjs EXTRACTED_SITE` で公開allowlist・全ファイル・辞書区画も検証します。未検証のglobを連結したり、この分割パートをサイトの公開ファイルとして配信したりしません。

最新1版＋明示した旧版最大2版を保持します。旧版の自動継承はしません。公開・mainへのpush・mergeは別途承認が必要です。
