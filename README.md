# 安護交班｜居家服務交班平台

獨立研究專案 `BiuBiuSmile/home-care-handover`，與家電訪、服務衝突或其他專案完全分開。

## 首頁與功能

| 檔案 | 內容 | 目前狀態 |
|---|---|---|
| `index.html` | 真正的員工登入、審核與管理員後台 | 前端完成，**待 Supabase 啟用** |
| `portal.js` | 帳號驗證、個案指派、交班新增、已讀紀錄 | 已加入 |
| `config.js` | Supabase 公開網址及 publishable key | **目前空白，未啟用** |
| `supabase/schema.sql` | PostgreSQL 資料表、RLS、資料庫函數與權限 | 尚未在 Supabase 專案執行 |
| `demo.html` | 原始交班互動展示版（僅瀏覽器儲存） | 可直接試用 |
| `docs/LOGIN_ADMIN_SETUP.md` | 詳細啟用與首位管理員設定步驟 | 已提供 |

### 登入系統規劃
- 角色：管理員、居督、居服員。
- 新註冊帳號一律待審核，預設 `active=false`，不能查看個案。
- 管理員核准後，居督／居服員也只能查看已被指派的個案。
- 後端 RLS 限制個案與交班讀寫，前端顯示的角色不是安全依據。
- 管理員可以新增個案、編輯固定照顧重點、審核帳號及指派人員。
- 原始交班紀錄不允許一般使用者任意編輯或刪除。
- 首位管理員必須透過 Supabase SQL Editor 啟用，**不提供預設管理員密碼**。

## GitHub Pages
1. 在 `Settings → Pages` 選 `Deploy from a branch`、`main`、`/(root)`。
2. GitHub Free 方案若使用私人儲存庫，可能不符合 Pages 發佈條件；請依帳號方案處理。
3. 發佈後預計網址：`https://biubiusmile.github.io/home-care-handover/`。
4. 尚未連接資料庫時，正式首頁會顯示「登入尚未啟用」；仍可點「示範版」測試流程。

**立即參考：[登入與管理員啟用指南](docs/LOGIN_ADMIN_SETUP.md)。**

## 資訊安全提醒
此版本是研究原型，尚未完成正式服務的稽核、MFA、備份、資安與個資法規評估，**不要輸入真實個案或健康資訊**。絕不可將 service_role、secret key、資料庫密碼或任何私人憑證寫入公開網站或儲存庫。
