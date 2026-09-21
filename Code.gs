/**
 * 工作室財務健康 APP - 後端
 * V1.2 效能優化 + 備份機制
 */
const CONFIG = {
  SPREADSHEET_ID: '1OeJy1bhmGVMXdbbNx-l7ID5tTVJS1FCJxPNSbNJzjEU',
  SHEETS: {
    TRANSACTIONS: 'Transactions',
    PROJECTS: 'Projects',
    CATEGORIES: 'Categories',
    ACCOUNTS: 'Accounts',
    FIXED_COSTS: 'FixedCosts',
    SETTINGS: 'Settings'
  },
  BACKUP: {
    FOLDER_NAME: '工作室財務APP備份',
    EXPORT_FOLDER_NAME: 'CSV匯出',
    KEEP: 30,
    HOUR: 3
  },
  CACHE_SECONDS: 300,
  SETUP_VERSION: 'v1'
};

const BUSINESS_TYPES = ['AI課程', '接案', '電動車', '設計製作', '顧問', '工作室共用'];

const TX_HEADERS = ['ID', '日期', '收入/支出', '業務類型', '分類', '專案ID', '客戶', '說明', '金額', '付款方式', '帳戶', '付款狀態', '備註', '建立時間'];

/* ===================================================================
 * 單次執行的快取層
 * Apps Script 每個請求都是全新的執行環境，所以這些變數等於
 * 「這一次請求內共用」。原本 openById 會被呼叫 8 次，現在只有 1 次。
 * =================================================================== */
let SS_ = null;
let TX_ROWS_ = null;
let TZ_ = null;

function getSpreadsheet_() {
  if (SS_) return SS_;
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.indexOf('PUT_YOUR') >= 0) {
    throw new Error('請先在 Code.gs 的 CONFIG.SPREADSHEET_ID 貼上你的 Google Sheet ID。');
  }
  SS_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return SS_;
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('找不到工作表：' + name + '（請手動執行一次 setupSpreadsheet）');
  return sh;
}

function getTz_() {
  if (!TZ_) TZ_ = Session.getScriptTimeZone() || 'Asia/Taipei';
  return TZ_;
}

/** Transactions 整張表在一次請求內只讀一次，儀表板與帳本共用。 */
function getTransactionRows_() {
  if (TX_ROWS_) return TX_ROWS_;
  TX_ROWS_ = getRows_(getSheet_(CONFIG.SHEETS.TRANSACTIONS));
  return TX_ROWS_;
}

/* ===================================================================
 * 跨請求快取：分類 / 帳戶 / 固定成本 / 設定很少變動
 * =================================================================== */
function cacheGet_(key, producer) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) {
    try {
      return JSON.parse(hit);
    } catch (e) {
      // 快取內容壞掉就重算
    }
  }
  const value = producer();
  try {
    cache.put(key, JSON.stringify(value), CONFIG.CACHE_SECONDS);
  } catch (e) {
    // 超過快取大小上限就跳過，不影響功能
  }
  return value;
}

function cacheClear_() {
  CacheService.getScriptCache().removeAll(['cat', 'acc', 'fixed', 'settings']);
}

/* ===================================================================
 * 入口
 * =================================================================== */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('工作室財務健康 APP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 只在第一次（或換版本）時建表。
 * 原本每次開 APP 都跑 setupSpreadsheet()，等於白做 20 次以上的 Sheet 操作。
 */
function ensureReady_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_DONE') === CONFIG.SETUP_VERSION) return;
  setupSpreadsheet();
}

function setupSpreadsheet() {
  const ss = getSpreadsheet_();

  ensureSheet_(ss, CONFIG.SHEETS.TRANSACTIONS, TX_HEADERS);
  ensureSheet_(ss, CONFIG.SHEETS.PROJECTS, [
    '專案ID', '專案名稱', '客戶', '業務類型', '開始日期', '結束日期', '報價', '狀態', '備註'
  ]);
  ensureSheet_(ss, CONFIG.SHEETS.CATEGORIES, ['類型', '分類名稱', '業務類型', '啟用']);
  ensureSheet_(ss, CONFIG.SHEETS.ACCOUNTS, ['帳戶名稱', '帳戶類型', '期初餘額', '啟用']);
  ensureSheet_(ss, CONFIG.SHEETS.FIXED_COSTS, ['項目', '每月金額', '分類', '啟用', '備註']);
  ensureSheet_(ss, CONFIG.SHEETS.SETTINGS, ['設定鍵', '設定值', '說明']);

  seedDefaults_(ss);
  cacheClear_();
  PropertiesService.getScriptProperties().setProperty('SETUP_DONE', CONFIG.SETUP_VERSION);
  return { ok: true, message: '資料表初始化完成' };
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function seedDefaults_(ss) {
  const cat = ss.getSheetByName(CONFIG.SHEETS.CATEGORIES);
  if (cat.getLastRow() <= 1) {
    const rows = [
      ['收入', 'AI課程', 'AI課程', true], ['收入', '接案收入', '接案', true], ['收入', '維修收入', '電動車', true], ['收入', '車輛銷售', '電動車', true], ['收入', '設計收入', '設計製作', true], ['收入', '顧問費', '顧問', true],
      ['支出', '租金', '工作室共用', true], ['支出', '軟體訂閱', '工作室共用', true], ['支出', '廣告', '工作室共用', true], ['支出', '電話網路', '工作室共用', true], ['支出', '車輛分期', '工作室共用', true],
      ['支出', '教材印刷', 'AI課程', true], ['支出', '交通', '工作室共用', true], ['支出', '外包', '接案', true], ['支出', '零件', '電動車', true], ['支出', '進貨', '電動車', true], ['支出', '印刷製作', '設計製作', true], ['支出', '其他', '工作室共用', true]
    ];
    cat.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  const accounts = ss.getSheetByName(CONFIG.SHEETS.ACCOUNTS);
  if (accounts.getLastRow() <= 1) {
    accounts.getRange(2, 1, 4, 4).setValues([
      ['工作室銀行', '銀行', 0, true], ['現金', '現金', 0, true], ['信用卡', '信用卡', 0, true], ['個人代墊', '其他', 0, true]
    ]);
  }

  const fixed = ss.getSheetByName(CONFIG.SHEETS.FIXED_COSTS);
  if (fixed.getLastRow() <= 1) {
    fixed.getRange(2, 1, 9, 5).setValues([
      ['工作室租金', 19000, '租金', true, ''], ['ChatGPT', 650, '軟體訂閱', true, ''], ['Gemini', 650, '軟體訂閱', true, ''], ['Claude', 760, '軟體訂閱', true, '依實際台幣帳單調整'], ['Kling', 610, '軟體訂閱', true, '依實際台幣帳單調整'], ['Google Ads', 3000, '廣告', true, ''], ['Facebook Ads', 3000, '廣告', true, ''], ['電話＋網路', 2000, '電話網路', true, ''], ['貨車分期', 4790, '車輛分期', true, '48期']
    ]);
  }

  const settings = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (settings.getLastRow() <= 1) {
    settings.getRange(2, 1, 4, 3).setValues([
      ['OWNER_SALARY_TARGET', 40000, '老闆每月希望領取金額'], ['CASH_BALANCE', 0, '目前工作室可動用現金'], ['SAFE_MONTHS', 6, '健康現金續航月份'], ['LOW_MONTHS', 3, '危險現金續航月份']
    ]);
  }
}

/* ===================================================================
 * 讀取
 * =================================================================== */
function getBootstrapData() {
  ensureReady_();
  return {
    businessTypes: BUSINESS_TYPES,
    categories: getCategories_(),
    accounts: getAccounts_(),
    fixedCosts: getFixedCosts_(),
    dashboard: getDashboard(),
    recentTransactions: getTransactions({ limit: 30 })
  };
}

function getCategories_() {
  return cacheGet_('cat', function () {
    return getRows_(getSheet_(CONFIG.SHEETS.CATEGORIES))
      .filter(r => asBool_(r[3]))
      .map(r => ({ type: r[0], name: r[1], businessType: r[2] }));
  });
}

function getAccounts_() {
  return cacheGet_('acc', function () {
    return getRows_(getSheet_(CONFIG.SHEETS.ACCOUNTS))
      .filter(r => asBool_(r[3]))
      .map(r => ({ name: r[0], type: r[1], openingBalance: Number(r[2] || 0) }));
  });
}

function getFixedCosts_() {
  return cacheGet_('fixed', function () {
    return getRows_(getSheet_(CONFIG.SHEETS.FIXED_COSTS))
      .filter(r => asBool_(r[3]))
      .map(r => ({ item: r[0], amount: Number(r[1] || 0), category: r[2], note: r[4] || '' }));
  });
}

function getSettingsMap_() {
  return cacheGet_('settings', function () {
    const out = {};
    getRows_(getSheet_(CONFIG.SHEETS.SETTINGS)).forEach(r => out[r[0]] = r[1]);
    return out;
  });
}

function getRows_(sh) {
  const lr = sh.getLastRow();
  const lc = sh.getLastColumn();
  if (lr <= 1 || lc === 0) return [];
  return sh.getRange(2, 1, lr - 1, lc).getValues();
}

function rowToTx_(r) {
  return {
    id: r[0], date: formatDate_(r[1]), type: r[2], businessType: r[3], category: r[4],
    projectId: r[5] || '', customer: r[6] || '', description: r[7] || '', amount: Number(r[8] || 0),
    paymentMethod: r[9] || '', account: r[10] || '', paymentStatus: r[11] || '', note: r[12] || '',
    createdAt: formatDateTime_(r[13])
  };
}

/**
 * 只把「真正要回傳的那幾筆」轉成物件。
 * 原本是全部轉成物件 + 字串排序，再切 30 筆，資料越多越慢。
 */
function getTransactions(filter) {
  filter = filter || {};
  let rows = getTransactionRows_();

  if (filter.businessType) rows = rows.filter(r => r[3] === filter.businessType);
  if (filter.type) rows = rows.filter(r => r[2] === filter.type);
  if (filter.month) rows = rows.filter(r => formatDate_(r[1]).indexOf(filter.month) === 0);

  const idx = rows.map((r, i) => ({
    i: i,
    d: r[1] ? new Date(r[1]).getTime() : 0,
    c: r[13] ? new Date(r[13]).getTime() : 0
  }));
  idx.sort((a, b) => (b.d - a.d) || (b.c - a.c));

  const picked = filter.limit ? idx.slice(0, Number(filter.limit)) : idx;
  return picked.map(o => rowToTx_(rows[o.i]));
}

function getDashboard() {
  const rows = getTransactionRows_();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let revenue = 0;
  let expenses = 0;
  const byBusiness = {};
  BUSINESS_TYPES.forEach(k => byBusiness[k] = { revenue: 0, expense: 0, profit: 0, margin: 0 });

  rows.forEach(r => {
    const d = new Date(r[1]);
    if (d.getFullYear() !== y || d.getMonth() !== m) return;
    const type = r[2], biz = r[3] || '工作室共用', amount = Number(r[8] || 0);
    if (!byBusiness[biz]) byBusiness[biz] = { revenue: 0, expense: 0, profit: 0, margin: 0 };
    if (type === '收入') { revenue += amount; byBusiness[biz].revenue += amount; }
    if (type === '支出') { expenses += amount; byBusiness[biz].expense += amount; }
  });

  Object.keys(byBusiness).forEach(k => {
    const b = byBusiness[k];
    b.profit = b.revenue - b.expense;
    b.margin = b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0;
  });

  const fixedCosts = getFixedCosts_().reduce((s, x) => s + x.amount, 0);
  const settings = getSettingsMap_();
  const ownerSalary = Number(settings.OWNER_SALARY_TARGET || 0);
  const cashBalance = Number(settings.CASH_BALANCE || 0);

  // 固定成本由 FixedCosts 統一管理；記帳頁的支出用於專案/變動成本，避免固定成本重複計算。
  const netProfit = revenue - expenses - fixedCosts;
  const monthlyBurn = Math.max(fixedCosts + ownerSalary, 1);
  const runway = cashBalance / monthlyBurn;
  const safeMonths = Number(settings.SAFE_MONTHS || 6);
  const lowMonths = Number(settings.LOW_MONTHS || 3);
  let health = '紅燈';
  if (runway >= safeMonths && netProfit >= 0) health = '綠燈';
  else if (runway >= lowMonths) health = '黃燈';

  const totalBusinessRevenue = Object.values(byBusiness).reduce((s, b) => s + b.revenue, 0);
  const totalBusinessExpense = Object.values(byBusiness).reduce((s, b) => s + b.expense, 0);
  const avgMargin = totalBusinessRevenue > 0 ? (totalBusinessRevenue - totalBusinessExpense) / totalBusinessRevenue : 0;
  const breakevenRevenue = avgMargin > 0 ? (fixedCosts + ownerSalary) / avgMargin : 0;

  return {
    month: Utilities.formatDate(now, getTz_(), 'yyyy-MM'),
    revenue, expenses, netProfit, fixedCosts, ownerSalary, cashBalance,
    runwayMonths: runway,
    health,
    breakevenRevenue,
    avgMargin: avgMargin * 100,
    byBusiness
  };
}

/* ===================================================================
 * 寫入
 * =================================================================== */
function addTransaction(data) {
  validateTransaction_(data);
  const sh = getSheet_(CONFIG.SHEETS.TRANSACTIONS);
  const id = 'TX-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const row = [
    id,
    parseDate_(data.date),
    data.type,
    data.businessType,
    data.category,
    data.projectId || '',
    data.customer || '',
    data.description || '',
    Number(data.amount),
    data.paymentMethod || '',
    data.account || '',
    data.paymentStatus || '已收/付',
    data.note || '',
    new Date()
  ];
  sh.appendRow(row);

  // 直接把新資料塞進這次請求的快取，儀表板與帳本就不用再讀一次整張表。
  if (TX_ROWS_) TX_ROWS_.push(row);
  else TX_ROWS_ = getRows_(sh);

  return { ok: true, id: id, dashboard: getDashboard(), recentTransactions: getTransactions({ limit: 30 }) };
}

function validateTransaction_(d) {
  if (!d) throw new Error('缺少資料');
  ['date', 'type', 'businessType', 'category', 'amount'].forEach(k => {
    if (d[k] === undefined || d[k] === null || d[k] === '') throw new Error('欄位不可空白：' + k);
  });
  if (!['收入', '支出'].includes(d.type)) throw new Error('收入/支出格式錯誤');
  if (Number(d.amount) <= 0) throw new Error('金額必須大於 0');
}

function saveSettings(data) {
  const sh = getSheet_(CONFIG.SHEETS.SETTINGS);
  const rows = getRows_(sh);
  const keyToRow = {};
  rows.forEach((r, i) => keyToRow[r[0]] = i + 2);
  Object.keys(data || {}).forEach(key => {
    if (keyToRow[key]) sh.getRange(keyToRow[key], 2).setValue(data[key]);
    else sh.appendRow([key, data[key], '']);
  });
  cacheClear_();
  return { ok: true, dashboard: getDashboard() };
}

function addFixedCost(data) {
  if (!data || !data.item || Number(data.amount) <= 0) throw new Error('固定成本資料不完整');
  getSheet_(CONFIG.SHEETS.FIXED_COSTS)
    .appendRow([data.item, Number(data.amount), data.category || '其他', true, data.note || '']);
  cacheClear_();
  return { ok: true, fixedCosts: getFixedCosts_(), dashboard: getDashboard() };
}

/* ===================================================================
 * 備份機制
 * =================================================================== */
function getBackupFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.BACKUP.FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.BACKUP.FOLDER_NAME);
}

/** 複製整份 Sheet 到 Drive 備份資料夾，並保留最近 N 份。 */
function backupNow() {
  const ss = getSpreadsheet_();
  const folder = getBackupFolder_();
  const stamp = Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM-dd_HHmm');
  const copy = DriveApp.getFileById(CONFIG.SPREADSHEET_ID)
    .makeCopy('備份_' + stamp + '_' + ss.getName(), folder);
  const removed = pruneBackups_(folder);
  return {
    ok: true,
    name: copy.getName(),
    url: copy.getUrl(),
    folderUrl: folder.getUrl(),
    removed: removed
  };
}

/** 超過保留份數的舊備份移到垃圾桶（不是永久刪除，30 天內都救得回來）。 */
function pruneBackups_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    files.push({ f: f, t: f.getDateCreated().getTime() });
  }
  files.sort((a, b) => b.t - a.t);
  const old = files.slice(CONFIG.BACKUP.KEEP);
  old.forEach(o => o.f.setTrashed(true));
  return old.length;
}

function installBackupTrigger() {
  removeBackupTrigger();
  ScriptApp.newTrigger('backupNow')
    .timeBased()
    .atHour(CONFIG.BACKUP.HOUR)
    .everyDays(1)
    .create();
  return { ok: true, message: '每日自動備份已啟用（約凌晨 ' + CONFIG.BACKUP.HOUR + ' 點）' };
}

function removeBackupTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'backupNow') { ScriptApp.deleteTrigger(t); n++; }
  });
  return { ok: true, removed: n };
}

function getBackupStatus() {
  const enabled = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'backupNow');

  const folder = getBackupFolder_();
  let count = 0;
  let latest = null;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    count++;
    const t = f.getDateCreated();
    if (!latest || t.getTime() > latest.getTime()) latest = t;
  }
  return {
    enabled: enabled,
    count: count,
    keep: CONFIG.BACKUP.KEEP,
    latest: latest ? Utilities.formatDate(latest, getTz_(), 'yyyy-MM-dd HH:mm') : '',
    folderUrl: folder.getUrl()
  };
}

/* ===================================================================
 * CSV 匯出
 * =================================================================== */
function csvCell_(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function getExportFolder_() {
  const parent = getBackupFolder_();
  const it = parent.getFoldersByName(CONFIG.BACKUP.EXPORT_FOLDER_NAME);
  return it.hasNext() ? it.next() : parent.createFolder(CONFIG.BACKUP.EXPORT_FOLDER_NAME);
}

/**
 * 匯出 CSV 到 Drive 並回傳連結。
 * 不用瀏覽器直接下載，是因為 Apps Script 網頁被包在 iframe 沙箱裡，
 * 直接觸發下載常被擋；存到 Drive 再開連結最穩，而且等於多一份備份。
 */
function exportTransactionsCsv(filter) {
  const list = getTransactions(filter || {});
  const lines = [TX_HEADERS.map(csvCell_).join(',')];
  list.forEach(t => {
    lines.push([
      t.id, t.date, t.type, t.businessType, t.category, t.projectId, t.customer,
      t.description, t.amount, t.paymentMethod, t.account, t.paymentStatus, t.note, t.createdAt
    ].map(csvCell_).join(','));
  });

  const filename = '帳本_' + Utilities.formatDate(new Date(), getTz_(), 'yyyyMMdd_HHmm') + '.csv';
  // 開頭加 BOM，Excel 打開中文才不會變亂碼
  const blob = Utilities.newBlob('\ufeff' + lines.join('\r\n'), 'text/csv', filename);
  const file = getExportFolder_().createFile(blob);

  return {
    ok: true,
    rows: list.length,
    filename: filename,
    url: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

/* ===================================================================
 * 工具
 * =================================================================== */
function parseDate_(s) {
  const parts = String(s).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), getTz_(), 'yyyy-MM-dd');
}

function formatDateTime_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), getTz_(), 'yyyy-MM-dd HH:mm:ss');
}

function asBool_(v) {
  return v === true || String(v).toLowerCase() === 'true' || String(v) === '1';
}
