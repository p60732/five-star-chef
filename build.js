// node build.js [輸出路徑] [--pages]
// 把共用規則、關卡、畫面程式組成一個檔案。規則只有 shared/ 一份，這裡只負責組裝，不手動複製。
// --pages：加上完整 HTML 外殼（GitHub Pages 用）；不加：給 artifact 試玩頁用。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const parts = {
  '/*LEVEL_JS*/': R('shared/level.js'),
  '/*GAME_JS*/': R('shared/rules/game.js'),
  '/*LEVELS_JSON*/': JSON.stringify(JSON.parse(R('data/levels.json'))).replace(/</g, '\\u003c'),
  '/*RENDER_JS*/': R('client/render.js'),
  '/*MAIN_JS*/': R('client/main.js')
};
let html = R('client/index.src.html');
for (const k in parts) {
  if (!html.includes(k)) throw new Error('index.src.html 缺少佔位字 ' + k);
  html = html.replace(k, () => parts[k]);
}
const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 8);
html = html.replace('<title>五星大主廚</title>', '<title>五星大主廚</title>\n<meta name="build" content="' + hash + '">');

const args = process.argv.slice(2);
const pages = args.includes('--pages');
if (pages) {
  html = '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' +
    '<meta name="apple-mobile-web-app-capable" content="yes">\n</head>\n<body>\n' + html + '\n</body>\n</html>\n';
}
const out = args.find((a) => !a.startsWith('--')) || path.join(__dirname, 'dist', pages ? 'index.html' : 'play.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('已建置', out, (html.length / 1024).toFixed(1) + ' KB', 'build ' + hash);
