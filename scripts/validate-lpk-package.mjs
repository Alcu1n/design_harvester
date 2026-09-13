import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/core/package.json', import.meta.url));
const YAML = require('yaml');
const config = YAML.parse(fs.readFileSync(new URL('../package.yml', import.meta.url), 'utf8'));
const clients = new Set(['ios', 'android', 'linux', 'windows', 'macos', 'tvos']);
for (const platform of config.unsupported_platforms ?? []) {
  if (!clients.has(platform)) throw new Error(`Invalid client platform: ${platform}. unsupported_platforms describes clients, not Docker CPU architectures.`);
}
if (!/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error('Invalid package version');
console.log('LPK package metadata validated');
