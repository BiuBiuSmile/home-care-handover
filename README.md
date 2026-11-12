# 居家服務交班平台｜研究原型

**獨立研究專案：** `home-care-handover`，不與家電訪／服務衝突平台共用儲存庫或部署。

## 專案狀態

- 單頁靜態網站：`index.html`，無須建置，適用於 GitHub Pages。
- 功能：查看個案交班、虛構居服員 A/B/C 身分切換、新增交班、歷史查詢、已讀確認。
- 目前只使用瀏覽器 `localStorage`，資料**不會**同步到其他裝置或其他居服員。
- 切換角色只是原型模擬，**不是**真實登入或授權。
- 所有預設資料均為測試範例。**禁止輸入真實個案姓名、疾病、身分資料或聯絡方式。**
- `noindex` 只表示建議搜尋引擎不索引，不是存取限制。GitHub Pages 公開網站仍可被任何知道網址的人開啟。

## GitHub Pages 發佈

1. 在 GitHub 帳號 `BiuBiuSmile` 建立新的**獨立** Repository：`home-care-handover`，設為 Public（GitHub Free 的 Pages 需要公開儲存庫）。
2. 在 `main` 分支根目錄放置本資料夾的 `index.html`、`.nojekyll`、`README.md`。
3. 開啟 `Settings → Pages`，在 `Build and deployment` 選 `Deploy from a branch`、`main`、`/(root)`，按 `Save`。
4. 發佈後預設網址為 `https://biubiusmile.github.io/home-care-handover/`。

## 上線前的必要工作

真正可用於跨裝置的居家服務交班，需要補上伺服器資料庫、後端授權、居服員指派關係、角色與個案存取控制、稽核軌跡、已讀通知、資料保存和備份，以及個人資料保護措施。此原型不具備這些條件。