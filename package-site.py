"""Create a reproducible prepared site archive plus source/content checksums."""
import hashlib, json, pathlib, sys, zipfile
ROOT = pathlib.Path(__file__).resolve().parent
site = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dist/web'
dictionary = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
if not site.is_dir():
    raise SystemExit('Usage: python3 package-site.py BUILT_SITE [DICTIONARY_JSON]')
sha = lambda data: hashlib.sha256(data).hexdigest()
sources = ['dictionary.mjs', 'reading-bucket.mjs', 'build-web-dictionary.mjs', 'build-web.mjs', 'import-jawiktionary.mjs', 'build.mjs', 'source.json', 'supplement.json', 'web/app.mjs', 'web/battle-rules.mjs', 'web/battle-controller.mjs', 'web/battle-app.mjs', 'web/dictionary-client.mjs', 'web/index.html', 'web/styles.css', 'package-site.py']
info = json.loads((site / 'build-info.json').read_text())
for name in sources[:-1]:
    if info['sources'].get(name) != sha((ROOT / name).read_bytes()):
        raise SystemExit('stale source: ' + name)
for name in ['dictionary.mjs', 'reading-bucket.mjs', 'web/app.mjs', 'web/battle-rules.mjs', 'web/battle-controller.mjs', 'web/battle-app.mjs', 'web/dictionary-client.mjs', 'web/styles.css']:
    if (site / name).read_bytes() != (ROOT / name).read_bytes():
        raise SystemExit('stale copied source: ' + name)
expected_html = (ROOT / 'web/index.html').read_text().replace('__MANIFEST_URL__', './data/' + info['version'] + '/manifest.json')
if (site / 'index.html').read_text() != expected_html:
    raise SystemExit('stale source: index.html')
allowed = {'.nojekyll', 'ATTRIBUTION.txt', 'build-info.json', 'index.html', 'dictionary.mjs', 'reading-bucket.mjs', 'web/app.mjs', 'web/battle-rules.mjs', 'web/battle-controller.mjs', 'web/battle-app.mjs', 'web/dictionary-client.mjs', 'web/styles.css'}
allowed.add('data/' + info['version'] + '/manifest.json')
allowed.update('data/' + info['version'] + '/' + format(i, '02x') + '.json' for i in range(256))
actual = {p.relative_to(site).as_posix() for p in site.rglob('*') if p.is_file()}
if actual != allowed or any(p.is_symlink() for p in site.rglob('*')):
    raise SystemExit('unexpected file outside public allowlist')
if dictionary and sha(dictionary.read_bytes()) != info['dictionarySha256']:
    raise SystemExit('dictionary source mismatch')
artifacts = {p.relative_to(site).as_posix(): sha(p.read_bytes()) for p in sorted(site.rglob('*')) if p.is_file()}
versions = list((site / 'data').iterdir())
if len(versions) != 1:
    raise SystemExit('Expected exactly one dictionary version')
release = {'schemaVersion': 1, 'version': versions[0].name, 'foundationCommit': 'c16cf569b8d39922c1cc8ac6c19c626cbcd0175b', 'sources': {p: sha((ROOT / p).read_bytes()) for p in sources}, 'artifacts': artifacts}
release['dictionarySha256'] = info['dictionarySha256']
output = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / 'publish'
output.mkdir(exist_ok=True)
with zipfile.ZipFile(output / 'site.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in artifacts:
        info = zipfile.ZipInfo(name, date_time=(2026, 10, 5, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (site / name).read_bytes())
release['zipSha256'] = sha((output / 'site.zip').read_bytes())
(output / 'site-manifest.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'version': release['version'], 'files': len(artifacts), 'zipBytes': (output / 'site.zip').stat().st_size}))
