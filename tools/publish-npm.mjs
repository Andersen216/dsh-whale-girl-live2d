#!/usr/bin/env node
// 发到 npm：一条命令搞定「预检 → 发布 → 回查」，并且不碰你本机的 ~/.npm 缓存。
//
// 用法：
//   NPM_TOKEN=npm_xxx node tools/publish-npm.mjs                 # 真发布
//   NPM_TOKEN=npm_xxx node tools/publish-npm.mjs --otp=123456    # 需要 2FA 时补验证码
//   NPM_TOKEN=npm_xxx node tools/publish-npm.mjs --check    # 只预检，不发布
//
// 为什么要单独写一个：这台机器的 ~/.npm 里有 root 权限的旧缓存文件，直接 npm publish
// 会 EACCES（老版本 npm 的 bug）。这里统一用临时缓存目录，并把 token 用命令行参数传给
// npm（不写进任何 .npmrc / git 配置 / 日志）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');
// npm 从 2026-07 起收紧 bypass-2FA token：没有 bypass 的 token 发布时必须补一次 2FA 验证码。
// 用法：--otp=123456（验证器里的 6 位数，30 秒一换）
const OTP = (process.argv.find((a) => a.startsWith('--otp=')) || '').split('=')[1]
  || (process.argv.includes('--otp') ? process.argv[process.argv.indexOf('--otp') + 1] : null);
const TOKEN = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
const REGISTRY = 'https://registry.npmjs.org';

const CACHE = path.join(os.tmpdir(), 'npm-publish-cache');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { name, version } = pkg;

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m) => console.log(`  ·  ${m}`);

// ---------- 1) 预检 ----------
console.log(`\n=== 预检 ${name}@${version} ===`);

// 1a) 打包内容与体积
const pack = JSON.parse(execFileSync('npm', ['--cache', CACHE, 'pack', '--dry-run', '--json'],
  { cwd: ROOT, encoding: 'utf8' }));
const p = pack[0];
const has = (f) => p.files.some((x) => x.path === f);
info(`打包 ${p.files.length} 个文件，压缩 ${(p.size / 1048576).toFixed(1)} MB / 解包 ${(p.unpackedSize / 1048576).toFixed(1)} MB`);
for (const f of ['lib/index.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE.md', 'tools/pet-ctl.mjs']) {
  has(f) ? ok(`包内含 ${f}`) : bad(`包内缺少 ${f}（检查 package.json 的 files）`);
}
if (!p.files.some((x) => x.path.endsWith('.moc3'))) bad('包内没有模型本体（.moc3）');
else ok('包内含模型本体（.moc3）');

// 1b) CHANGELOG 里有这个版本
const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
changelog.includes(`## ${version}`) ? ok(`CHANGELOG 里有 ${version}`) : bad(`CHANGELOG 里没写 ${version}`);

// 1c) git 是否干净（只警告，不拦）
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
dirty ? info(`注意：工作区有未提交改动\n${dirty.split('\n').map((l) => '     ' + l).join('\n')}`) : ok('git 工作区干净');

// 1d) registry 上这个名字/版本的情况
const reg = await fetch(`${REGISTRY}/${name}`, { signal: AbortSignal.timeout(30000) });
if (reg.status === 404) {
  ok(`${name} 在 npm 上还没有（这是首次发布）`);
} else if (reg.ok) {
  const doc = await reg.json();
  const published = Object.keys(doc.versions || {});
  info(`npm 上已有 ${published.length} 个版本，最新 = ${doc['dist-tags']?.latest}`);
  doc.versions?.[version]
    ? bad(`${version} 已经发布过了 —— 先升版本号（npm 不允许覆盖已发布版本）`)
    : ok(`${version} 尚未发布，可以发`);
} else {
  bad(`查询 registry 失败：HTTP ${reg.status}`);
}

if (CHECK_ONLY) {
  console.log(process.exitCode ? '\n预检没过，先修上面的问题。\n' : '\n预检通过（--check，未发布）。\n');
  process.exit(process.exitCode || 0);
}

// ---------- 2) 发布 ----------
if (!TOKEN) {
  console.error('\n缺少 NPM_TOKEN（在 https://www.npmjs.com/settings/<用户名>/tokens 建一个，权限只需 Packages: Read and write）。');
  process.exit(2);
}
console.log('\n=== 发布 ===');
if (OTP) info(`带 2FA 验证码发布（otp=${OTP.replace(/./g, '•')}）`);
try {
  const out = execFileSync('npm', [
    'publish', '--access', 'public', '--cache', CACHE,
    `--//registry.npmjs.org/:_authToken=${TOKEN}`,
    ...(OTP ? [`--otp=${OTP}`] : []),
  ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(out.trim().split('\n').slice(-4).join('\n'));
  ok('npm publish 成功');
} catch (e) {
  bad(`npm publish 失败：\n${e.stdout || ''}${e.stderr || ''}`);
  process.exit(1);
}

// ---------- 3) 回查（等 registry 真正可见） ----------
console.log('\n=== 回查 ===');
let seen = null;
for (let i = 1; i <= 12; i++) {
  await new Promise((s) => setTimeout(s, 2500));
  const r = await fetch(`${REGISTRY}/${name}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) { info(`第 ${i} 次：registry 还没更新（HTTP ${r.status}）`); continue; }
  const doc = await r.json();
  if (doc.versions?.[version]) { seen = doc; break; }
  info(`第 ${i} 次：${version} 还没出现在 registry`);
}
if (!seen) {
  bad('发布命令成功了，但 registry 上还没看到这个版本 —— 过几分钟再查一次');
} else {
  const v = seen.versions[version];
  ok(`registry 上已可见：${name}@${version}`);
  info(`tarball: ${v.dist.tarball}`);
  info(`shasum : ${v.dist.shasum}（本地预演 ${p.shasum}）`);
  v.dist.shasum === p.shasum ? ok('shasum 与本地打包一致（发上去的就是本地这份）')
    : info('shasum 不同：本地预演与发布内容有差异（例如打包时工作区又改了），确认一下');
  console.log(`\n  页面：https://www.npmjs.com/package/${name}`);
  console.log(`  装法：dsh plugin --profile web add ${name}`);
}
console.log('\n发完记得去 https://www.npmjs.com/settings/<用户名>/tokens 把这个 token 吊销。\n');
