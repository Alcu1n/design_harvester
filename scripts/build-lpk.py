#!/usr/bin/env python3
"""Build an offline amd64 LPK with the official pinned CLI, then attach Compose tags.

lzc-cli 2.0.9's YAML serializer cannot retain !override. The final tar operation
adds this mandatory file without changing OCI blobs or their content digests.
The .raw.lpk is intermediate and must never be installed.
"""
import argparse
import hashlib
import gzip
import os
import io
import json
import re
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--finalize-only', action='store_true')
args = parser.parse_args()
subprocess.run(['node', 'scripts/validate-lpk-package.mjs'], cwd=ROOT, check=True)
release = ROOT / 'release'
release.mkdir(exist_ok=True)
version = re.search(r'^version: ([0-9]+\.[0-9]+\.[0-9]+)$', (ROOT / 'package.yml').read_text(), re.M).group(1)
raw = release / f'design-harvester-{version}-amd64.raw.lpk'
final = release / f'design-harvester-{version}-amd64.lpk'
if not args.finalize_only:
    subprocess.run(['python3', 'scripts/verify-lpk-isolation.py'], cwd=ROOT, check=True)
    # The CLI inspects external parents; buildx cache alone is insufficient.
    for parent in ('node:24-bookworm-slim', 'postgres:17-alpine'):
        subprocess.run(['docker', 'pull', '--platform', 'linux/amd64', parent], check=True)
    base = (ROOT / 'docker/Dockerfile').read_text()
    for name in ('web', 'worker', 'egress'):
        text = base + f'\nFROM {name} AS lazycat\n'
        if name == 'worker':
            text += 'ENTRYPOINT ["sh", "/app/lazycat/worker-start.sh"]\n'
        (ROOT / f'lazycat/{name}.Dockerfile').write_text(text)
    for name in ('web', 'worker', 'browser', 'egress'):
        subprocess.run(['docker', 'buildx', 'build', '--platform', 'linux/amd64',
                        '--load', '-f', f'lazycat/{name}.Dockerfile',
                        '-t', f'harvester-lpk-stage-{name}', '.'], cwd=ROOT, check=True)
    cli_env = os.environ.copy()
    cli_env['NODE_OPTIONS'] = cli_env.get('NODE_OPTIONS', '') + ' --import=' + (ROOT / 'scripts/lzc-loader-register.mjs').as_uri()
    subprocess.run(['npx', '-y', '@lazycatcloud/lzc-cli@2.0.9', 'project',
                    'build', '-o', str(raw)], cwd=ROOT, env=cli_env, check=True)

with tarfile.open(raw, 'r:') as archive:
    names = archive.getnames()
    for required in ('package.yml', 'manifest.yml', 'images.lock', 'images/index.json'):
        if required not in names:
            raise RuntimeError(f'LPK missing {required}')
    # Validate all embedded content-addressed blobs before producing a release.
    for member in archive:
        if member.isfile() and member.name.startswith('images/blobs/sha256/'):
            stream = archive.extractfile(member)
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if digest != Path(member.name).name:
                raise RuntimeError(f'OCI checksum mismatch: {member.name}')
    index = json.load(archive.extractfile('images/index.json'))
    if len(index['manifests']) != 5:
        raise RuntimeError('Expected five embedded images')
    checked_layers = set()
    for entry in index['manifests']:
        manifest = json.load(archive.extractfile('images/blobs/sha256/' + entry['digest'].split(':')[1]))
        config = json.load(archive.extractfile('images/blobs/sha256/' + manifest['config']['digest'].split(':')[1]))
        if config['architecture'] != 'amd64' or config['os'] != 'linux':
            raise RuntimeError('Unexpected image platform')
        if len(manifest['layers']) != len(config['rootfs']['diff_ids']):
            raise RuntimeError('Image layer count mismatch')
        for layer, expected in zip(manifest['layers'], config['rootfs']['diff_ids']):
            key = (layer['digest'], expected)
            if key in checked_layers:
                continue
            member = archive.getmember('images/blobs/sha256/' + layer['digest'].split(':')[1])
            if member.size != layer['size']:
                raise RuntimeError('OCI descriptor size mismatch')
            stream = archive.extractfile(member)
            unpacked = gzip.GzipFile(fileobj=stream) if 'gzip' in layer['mediaType'] else stream
            actual = 'sha256:' + hashlib.file_digest(unpacked, 'sha256').hexdigest()
            if actual != expected:
                raise RuntimeError('Uncompressed layer checksum mismatch: ' + layer['digest'])
            checked_layers.add(key)

# A tar-based LPK has no archive-level signature; OCI digests remain unchanged.
# Stream members without extraction, avoiding symlinks and host path traversal.
partial = final.with_suffix('.lpk.partial')
with tarfile.open(raw, 'r:') as source, tarfile.open(partial, 'w') as output:
    for member in source:
        if member.name == 'compose.override.yml':
            continue
        output.addfile(member, source.extractfile(member) if member.isfile() else None)
    for name, content in [('compose.override.yml', (ROOT / 'lazycat/compose.override.yml').read_bytes())]:
        member = tarfile.TarInfo(name)
        member.size, member.mode, member.mtime = len(content), 0o644, 0
        output.addfile(member, io.BytesIO(content))
partial.replace(final)
with final.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
final.with_suffix('.lpk.sha256').write_text(f'{digest}  {final.name}\n')
raw.unlink()
print(f'LPK: {final}\nSHA256: {digest}\nBytes: {final.stat().st_size}')
