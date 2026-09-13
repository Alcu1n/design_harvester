#!/usr/bin/env python3
"""Exercise Docker Compose's real merge semantics against platform-style mounts.

This is a local regression check, not a substitute for inspecting LZCOS output.
"""
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
services = {}
for name in ('app', 'web', 'worker', 'postgres', 'browser', 'egress'):
    services[name] = {
        'image': 'alpine:3.21', 'networks': ['default'],
        'volumes': [{'type': 'bind', 'source': '/tmp/harvester-test-var', 'target': '/lzcapp/var'}],
    }
services['web']['volumes'].append({'type': 'bind', 'source': '/tmp/harvester-test-library', 'target': '/data/library', 'read_only': False})
services['browser']['entrypoint'] = ['/lzcapp/platform-wrapper']
with tempfile.TemporaryDirectory(prefix='harvester-compose-') as temp:
    baseline = Path(temp) / 'base.json'
    baseline.write_text(json.dumps({'services': services, 'networks': {'default': {}}}))
    result = subprocess.check_output(['docker', 'compose', '-f', str(baseline), '-f', str(root / 'lazycat/compose.override.yml'), 'config', '--format', 'json'])
merged = json.loads(result)
s = merged['services']
assert set(s['browser']['networks']) == {'harvester_capture'}
assert set(s['postgres']['networks']) == {'harvester_backend'}
assert set(s['egress']['networks']) == {'harvester_capture', 'harvester_internet'}
assert not s['browser'].get('volumes') and not s['egress'].get('volumes')
assert s['browser']['entrypoint'] == ['node', '/browser/browser.mjs']
assert any(v['target'] == '/lzcapp/var' and v['type'] == 'tmpfs' for v in s['web']['volumes'])
assert any(v['target'] == '/data/library' and v['read_only'] for v in s['web']['volumes'])
assert merged['networks']['harvester_capture']['internal']
assert merged['networks']['harvester_backend']['internal']
print('Compose merge isolation checks passed')
