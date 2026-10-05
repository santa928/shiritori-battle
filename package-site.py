"""再現可能な分割配布アーカイブとソース・内容のチェックサムを作成する。"""
import hashlib
import io
import json
import pathlib
import re
import sys
import zipfile
ROOT = pathlib.Path(__file__).resolve().parent
site = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dist/web'
dictionary = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
if not site.is_dir():
    raise SystemExit('Usage: python3 package-site.py BUILT_SITE [DICTIONARY_JSON]')
sha = lambda data: hashlib.sha256(data).hexdigest()
spec = json.loads((ROOT / 'scripts/release-assets.json').read_text())
build_sources = list(dict.fromkeys(spec['buildSources'] + spec['copiedSources']))
sources = build_sources + ['package-site.py']
info = json.loads((site / 'build-info.json').read_text())
version_pattern = re.compile(r'v1-[a-f0-9]{16}')
retained = info.get('retainedVersions', [])
if not isinstance(info.get('version'), str) or not version_pattern.fullmatch(info['version']):
    raise SystemExit('invalid dictionary version')
if (not isinstance(retained, list) or len(retained) > 2 or any(not isinstance(v, str) or not version_pattern.fullmatch(v) or v == info['version'] for v in retained)
        or len(set(retained)) != len(retained)):
    raise SystemExit('invalid retained dictionary versions')
versions = [info['version']] + sorted(retained)
for name in build_sources:
    if info['sources'].get(name) != sha((ROOT / name).read_bytes()):
        raise SystemExit('stale source: ' + name)
for name in spec['copiedSources']:
    if (site / name).read_bytes() != (ROOT / name).read_bytes():
        raise SystemExit('stale copied source: ' + name)
expected_html = (ROOT / 'web/index.html').read_text().replace('__MANIFEST_URL__', './data/' + info['version'] + '/manifest.json')
if (site / 'index.html').read_text() != expected_html:
    raise SystemExit('stale source: index.html')
allowed = set(spec['staticArtifacts'] + spec['copiedSources'])
for version in versions:
    allowed.add('data/' + version + '/manifest.json')
    allowed.update('data/' + version + '/' + format(i, '02x') + '.json' for i in range(256))
actual = {p.relative_to(site).as_posix() for p in site.rglob('*') if p.is_file()}
if actual != allowed or any(p.is_symlink() for p in site.rglob('*')):
    raise SystemExit('unexpected file outside public allowlist')
if sorted(p.name for p in (site / 'data').iterdir()) != sorted(versions):
    raise SystemExit('unexpected dictionary version directory')
for version in versions:
    folder = site / 'data' / version
    manifest = json.loads((folder / 'manifest.json').read_text())
    keys = [format(i, '02x') for i in range(256)]
    if (manifest.get('schemaVersion') != 1 or manifest.get('version') != version or not isinstance(manifest.get('sources'), list)
            or not isinstance(manifest.get('shards'), dict) or sorted(manifest['shards']) != keys):
        raise SystemExit('invalid dictionary manifest: ' + version)
    for key in keys:
        descriptor = manifest['shards'][key]
        data = (folder / (key + '.json')).read_bytes()
        if (not isinstance(descriptor, dict) or descriptor.get('url') != key + '.json'
                or type(descriptor.get('bytes')) is not int or descriptor['bytes'] != len(data) or descriptor.get('sha256') != sha(data)):
            raise SystemExit('invalid shard descriptor: ' + version + '/' + key)
        shard = json.loads(data)
        dataset = shard.get('dataset', {})
        if (shard.get('schemaVersion') != 1 or shard.get('version') != version or not isinstance(shard.get('review'), list)
                or not isinstance(dataset, dict) or dataset.get('schemaVersion') != 1 or not isinstance(dataset.get('entries'), list)
                or dataset.get('sources') != manifest['sources']):
            raise SystemExit('invalid dictionary shard: ' + version + '/' + key)
if dictionary and sha(dictionary.read_bytes()) != info['dictionarySha256']:
    raise SystemExit('dictionary source mismatch')
artifacts = {p.relative_to(site).as_posix(): sha(p.read_bytes()) for p in sorted(site.rglob('*')) if p.is_file()}
release = {'schemaVersion': 1, 'version': info['version'], 'foundationCommit': 'c16cf569b8d39922c1cc8ac6c19c626cbcd0175b', 'sources': {p: sha((ROOT / p).read_bytes()) for p in sources}, 'artifacts': artifacts}
release['dictionarySha256'] = info['dictionarySha256']
if retained:
    release['retainedVersions'] = sorted(retained)
output = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / 'publish'
output.mkdir(exist_ok=True)
archive_bytes = io.BytesIO()
with zipfile.ZipFile(archive_bytes, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in artifacts:
        info = zipfile.ZipInfo(name, date_time=(2026, 10, 5, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (site / name).read_bytes())
data = archive_bytes.getvalue()
release['zipSha256'] = sha(data)
release['zipBytes'] = len(data)
release['zipParts'] = []
part_bytes = 8 * 1024 * 1024
for i, start in enumerate(range(0, len(data), part_bytes), 1):
    name = 'site.zip.part' + format(i, '03d')
    part = data[start:start + part_bytes]
    (output / name).write_bytes(part)
    release['zipParts'].append({'path': name, 'bytes': len(part), 'sha256': sha(part)})
# 配布物は宣言した分割パートだけを保持し、単一ZIPを重ねて保存しない。
expected_parts = {p['path'] for p in release['zipParts']}
for path in output.iterdir():
    if (path.name == 'site.zip' or path.name.startswith('site.zip.part')) and path.name not in expected_parts:
        path.unlink()
(output / 'site-manifest.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'version': release['version'], 'files': len(artifacts), 'zipBytes': release['zipBytes'], 'parts': len(release['zipParts'])}))
