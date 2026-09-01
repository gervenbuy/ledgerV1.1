# 工作室財務健康 APP - MVP V1

## 目前功能
- 手機 / 電腦 RWD 介面
- Google Sheets 當資料庫
- 快速記收入 / 支出
- 五大業務分類：AI課程、接案、電動車、設計製作、顧問
- 儀表板：營收、支出、淨利、固定成本、現金、損益兩平、現金續航、健康燈號
- 最近 30 筆帳目
- 固定成本設定
- 老闆月薪目標、可動用現金設定

## 建置步驟
1. 建立一份新的 Google Sheet。
2. 從網址取得 Sheet ID：
   https://docs.google.com/spreadsheets/d/【這一段就是ID】/edit
3. 前往 script.google.com 建立新的 Apps Script 專案。
4. 將 `Code.gs` 全部貼入 Apps Script 的 Code.gs。
5. 新增 HTML 檔，名稱必須為 `Index`，貼入 `Index.html` 內容。
6. 在 `Code.gs` 修改：
   `SPREADSHEET_ID: 'PUT_YOUR_GOOGLE_SHEET_ID_HERE'`
   換成你的 Sheet ID。
7. 在 Apps Script 編輯器手動執行一次 `setupSpreadsheet()`。
8. 第一次執行會要求 Google 權限，完成授權。
9. 點「部署」→「新增部署作業」→ 類型選「網頁應用程式」。
10. 執行身分：我；存取權限：依你的使用需求選擇（若只自己使用，建議限制自己帳號）。
11. 部署後取得 Web App 網址，手機與電腦都可以使用。
12. 手機瀏覽器可使用「加入主畫面」建立 APP 圖示。

## Google Sheet 會自動建立的工作表
- Transactions
- Projects
- Categories
- Accounts
- FixedCosts
- Settings

## 已預設固定成本
- 工作室租金 19,000
- ChatGPT 650
- Gemini 650
- Claude 760
- Kling 610
- Google Ads 3,000
- Facebook Ads 3,000
- 電話＋網路 2,000
- 貨車分期 4,790

## V2 建議
- 編輯 / 刪除交易
- 月份與業務篩選
- 應收 / 應付帳款
- 專案損益
- 電動車庫存與零件成本
- 圖表
- 匯出 PDF / CSV
