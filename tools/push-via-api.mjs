#!/usr/bin/env node
// 当 github.com:443 被网络挡住、git push 走不通时，用 GitHub REST API（api.github.com）
// 把本地某个提交原样推上去：blobs → tree → commit → 更新 ref。
// 推之前会比对 tree 哈希，不一致就拒绝推送（不做破坏性操作）。
//
// 用法： GITHUB_TOKEN=xxx node tools/push-via-api.mjs [本地提交sha] [owner/repo] [分支]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GITHUB_TOKEN'); process.exit(2); }

const CWD = fileURLToPath(new URL('..', import.meta.url));
// core.quotePath=false：中文/特殊路径原样输出，别转成 \345\217\221 那种八进制
const GIT = ['-c', 'core.quotePath=false'];
const gitRaw = (...a) => execFileSync('git', [...GIT, ...a], { cwd: CWD, encoding: 'utf8' });
const git = (...a) => gitRaw(...a).trim();

const SHA = process.argv[2] || git('rev-parse', 'HEAD');
const REPO = process.argv[3] || 'Andersen216/dsh-whale-girl-live2d';
const BRANCH = process.argv[4] || 'main';
const API = `https://api.github.com/repos/${REPO}`;

const H = { authorization: `token ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'dsh-push' };

async function api(path, init = {}) {
  const t0 = Date.now();
  process.stderr.write(`→ ${init.method || 'GET'} ${path}\n`);
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) }, signal: AbortSignal.timeout(120000) });
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  process.stderr.write(`← ${r.status} ${path} ${Date.now() - t0}ms\n`);
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status} ${typeof body === 'string' ? body : body?.message || ''}`);
  return body;
}

const sha7 = (s) => String(s).slice(0, 7);

// 1) 远端当前 head
const remote = await api(`/git/ref/heads/${BRANCH}`);
const baseSha = remote.object.sha;
const localParent = git('rev-parse', `${SHA}^`);

// diff 的基准 = 本地那个「tree 与远端完全相同」的提交；正常情况下就是父提交。
// 之所以要这样找：API 造的提交 sha 和本地不同，本地没有它的 git 对象，不能直接拿来 diff。
let diffBase = localParent;
let baseTree;
if (baseSha === localParent) {
  baseTree = (await api(`/git/commits/${baseSha}`)).tree.sha;
} else {
  baseTree = (await api(`/git/commits/${baseSha}`)).tree.sha;
  const hit = gitRaw('rev-list', SHA).split('\n').map((s) => s.trim()).filter(Boolean)
    .find((s) => git('rev-parse', `${s}^{tree}`) === baseTree);
  if (!hit) {
    console.error(`远端 ${BRANCH} = ${sha7(baseSha)} 的 tree ${sha7(baseTree)} 在本地历史里找不到对应提交，不是快进推送，已停下。`);
    process.exit(1);
  }
  diffBase = hit;
  console.log(`远端 ${BRANCH} 对应本地提交 ${sha7(hit)}（tree 一致），以它为 diff 基准。`);
}
const localTree = git('rev-parse', `${SHA}^{tree}`);
const message = git('log', '-1', '--format=%B', SHA).replace(/\n+$/, '');

// 3) 逐个文件造 blob
const raw = gitRaw('diff', '--name-status', '-z', `${diffBase}..${SHA}`);
const changed = [];
{
  const tok = raw.split('\0');
  for (let i = 0; i < tok.length; i++) {
    const st = tok[i];
    if (!st) continue;
    if (st.startsWith('R') || st.startsWith('C')) changed.push({ status: st[0], from: tok[++i], to: tok[++i] });
    else changed.push({ status: st[0], path: tok[++i] });
  }
}
if (!changed.length) { console.log('没有差异，无事可做。'); process.exit(0); }

const tree = [];
const blobOf = async (p) => {
  const mode = (git('ls-tree', SHA, '--', p).split(/\s+/)[0]) || '100644';
  const b = await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: readFileSync(`${CWD}/${p}`).toString('base64'), encoding: 'base64' }) });
  return { mode, sha: b.sha };
};
for (const c of changed) {
  if (c.status === 'D') { tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); console.log(`D  ${c.path}`); continue; }
  if (c.status === 'R' || c.status === 'C') {
    if (c.status === 'R') tree.push({ path: c.from, mode: '100644', type: 'blob', sha: null });
    const b = await blobOf(c.to);
    tree.push({ path: c.to, mode: b.mode, type: 'blob', sha: b.sha });
    console.log(`R  ${c.from} → ${c.to} (${sha7(b.sha)})`);
    continue;
  }
  const b = await blobOf(c.path);
  tree.push({ path: c.path, mode: b.mode, type: 'blob', sha: b.sha });
  console.log(`${c.status}  ${c.path} (${sha7(b.sha)})`);
}

// 4) 造 tree（基于父 tree，只覆盖这些文件）
const newTree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
if (newTree.sha !== localTree) {
  console.error(`tree 不一致：远端造出 ${sha7(newTree.sha)}，本地应为 ${sha7(localTree)}。已停下，未更新分支。`);
  process.exit(1);
}
console.log(`tree 一致 ✓ ${sha7(newTree.sha)}`);

// 5) 造 commit，6) 更新分支
const commit = await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }) });
await api(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
console.log(`已推送 ${BRANCH} → ${commit.sha}`);
console.log(`https://github.com/${REPO}/commit/${commit.sha}`);
