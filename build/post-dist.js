/* ============================================================================
 *  post-dist.js  ——  打包完成后，把「安装说明.txt」复制进 dist
 *  （electron-builder 会清理输出目录，所以必须打完再复制）
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, '安装说明.txt');
const dstDir = path.join(root, 'dist');
const dst = path.join(dstDir, '安装说明.txt');

if (!fs.existsSync(src)) {
  console.log('（跳过）没找到 安装说明.txt');
  process.exit(0);
}
if (!fs.existsSync(dstDir)) {
  console.log('（跳过）dist 目录不存在，可能打包失败了');
  process.exit(0);
}
fs.copyFileSync(src, dst);
console.log('已复制 安装说明.txt -> dist\\安装说明.txt');

// 顺手清掉 electron-builder 留下的调试文件（自动更新用的 blockmap 我们也用不到）
['builder-debug.yml', '方框图化简工作室-安装包-1.0.0.exe.blockmap'].forEach(function (name) {
  const p = path.join(dstDir, name);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('已清理 ' + name);
  }
});
// 兜底：任何 *.blockmap 都删掉
fs.readdirSync(dstDir).forEach(function (name) {
  if (name.endsWith('.blockmap')) {
    try { fs.unlinkSync(path.join(dstDir, name)); console.log('已清理 ' + name); } catch (e) {}
  }
});
