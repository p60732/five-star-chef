# 五星大主廚

手機上 1–8 人線上合作的限時料理遊戲：分工備料、烹調、出餐，在時間內完成訂單。

- 目前階段：M0 開工準備（關卡設計與關卡編輯器已完成，遊戲本體尚未開始）
- 架構與規則：[ARCHITECTURE.md](ARCHITECTURE.md)
- 關卡設計：[docs/關卡設計.md](docs/關卡設計.md)

## 目錄

| 路徑 | 內容 |
|---|---|
| `shared/level.js` | 關卡依人數展開、關卡檢查、菜單、人數難度（遊戲、伺服器、編輯器共用） |
| `data/levels.json` | 全部關卡（試玩版 5 關） |
| `tools/level-editor/` | 關卡編輯器原始碼與建置腳本 |
| `tests/` | 測試 |
| `docs/` | 設計文件 |

## 常用指令

```bash
npm test                 # 跑關卡測試
npm run build:editor     # 建置關卡編輯器 → tools/level-editor/dist/level-editor.html
```

## 改關卡的流程

1. 打開關卡編輯器，改好後按「全部關卡 JSON」→「複製」。
2. 貼進 `data/levels.json` 取代原內容。
3. 跑 `npm test`，全部通過才 commit。

## 規則

- 公開 repo：不放金鑰、伺服器設定值、簽章檔、個人資料。
- 素材只用可商用授權（優先 CC0），每個素材都要登記在 `docs/素材來源.md`。
- commit 訊息格式：`[積木名] 做了什麼`。
