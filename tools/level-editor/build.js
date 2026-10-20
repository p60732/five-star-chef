// node tools/level-editor/build.js <輸出路徑>
// 把共用規則 shared/level.js 與內建關卡 data/levels.json 組進編輯器，避免手動複製。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(__dirname, 'editor.src.html'), 'utf8');
const levelJs = fs.readFileSync(path.join(root, 'shared', 'level.js'), 'utf8');
const levels = JSON.parse(fs.readFileSync(path.join(root, 'data', 'levels.json'), 'utf8'));
if (!src.includes('/*LEVEL_JS*/') || !src.includes('/*LEVELS_JSON*/')) throw new Error('editor.src.html 缺少佔位字');
const out = src
  .replace('/*LEVEL_JS*/', () => levelJs)
  .replace('/*LEVELS_JSON*/', () => JSON.stringify(levels).replace(/</g, '\\u003c'));
const dest = process.argv[2] || path.join(__dirname, 'dist', 'level-editor.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('已建置', dest, out.length, 'bytes');
