/**
 * 工作室財務健康 APP - Apps Script 後端 v4
 * ============================================
 * v4 重點：
 *   - 業務「迪特軍EV／電動車」統一改名為「電車男電能車」（舊資料讀取時自動轉換，另可執行 upgradeToV4() 直接改寫試算表）
 *   - 預設密碼 053005（可在 APP「設定」頁修改，新密碼存在 Script Properties，不寫在程式碼裡）
 *   - 寫入加上 LockService，避免兩台裝置同時記帳時資料錯亂
 *   - 防止試算表公式注入（輸入 = + - @ 開頭的文字不會被當成公式執行）
 *   - 「個人」收支不計入工作室損益（可用 INCLUDE_PERSONAL_IN_STUDIO 切換）
 *   - 現金續航改用近 3 個月平均燒錢速度，不會因為單月波動大起大落
 *   - 新增：一鍵標記已收/已付、刪除固定成本、修改密碼、與上月比較、支出結構、客戶自動完成
 *
 * 分頁結構：
 *   - 交易紀錄：所有收支明細
 *   - 設定：現金餘額、老闆月薪目標
 *   - 固定成本：每月固定支出項目
 *
 * 部署方式：
 *   Apps Script 編輯器整段覆蓋貼上 → 存檔 → 執行一次 upgradeToV4 →
 *   部署 → 管理部署作業 → 編輯現有部署 → 版本選「新版本」→ 部署
 * ============================================
 */

// ===== 設定區 =====
const APP_VERSION = 'v4.0';
const DEFAULT_PASSWORD = '053005';

const TRANSACTION_SHEET = '交易紀錄';
const TRANSACTION_HEADER = ['ID', '日期', '收支類型', '業務類型', '分類', '客戶', '說明', '金額', '帳戶', '付款方式', '付款狀態', '專案ID', '備註', '建立時間', '更新時間'];
const COL = { ID: 1, DATE: 2, TYPE: 3, BIZ: 4, STATUS: 11, UPDATED: 15 };

const SETTINGS_SHEET = '設定';
const FIXED_COST_SHEET = '固定成本';

const PAID = '已收/付';
const UNPAID = '未收/付';

const EV_BIZ = '電車男電能車';
const PERSONAL_BIZ = '個人';
const SHARED_BIZ = '工作室共用';
const BUSINESS_TYPES = [EV_BIZ, '電商神助手', '課程教學', SHARED_BIZ, PERSONAL_BIZ];

// 個人收支要不要算進工作室的營收／支出／淨利？（false = 只顯示在「個人」卡片，不影響工作室數字）
const INCLUDE_PERSONAL_IN_STUDIO = false;

// 舊業務名稱 → 新名稱（比對時忽略大小寫與空白）
const BUSINESS_ALIASES = {
  '迪特軍ev': EV_BIZ,
  '迪特軍': EV_BIZ,
  '電動車': EV_BIZ,
  'ev': EV_BIZ
};

const OLD_LEDGER_NAMES = ['個人', '迪特軍EV', '電商神助手', '課程教學'];

const CATEGORIES = {};
CATEGORIES[EV_BIZ] = {
  '收入': ['車輛銷售', '維修收入', '零件銷售', '其他收入'],
  '支出': ['零件採購', '店租', '水電', '人事', '工具設備', '其他支出']
};
CATEGORIES['電商神助手'] = {
  '收入': ['顧問服務費', 'AI行銷服務', '網站建置費', '其他收入'],
  '支出': ['廣告投放', '軟體訂閱', '外包費用', '其他支出']
};
CATEGORIES['課程教學'] = {
  '收入': ['線上課程', '實體課程', '企業培訓', '其他收入'],
  '支出': ['場地費', '教材製作', '行銷推廣', '其他支出']
};
CATEGORIES[SHARED_BIZ] = {
  '收入': ['其他收入'],
  '支出': ['軟體訂閱', '辦公用品', '共同行銷', '雜項支出', '其他支出']
};
CATEGORIES[PERSONAL_BIZ] = {
  '收入': ['薪資', '其他收入'],
  '支出': ['餐飲', '交通', '居住', '娛樂', '醫療', '其他支出']
};

const ACCOUNTS = [{ name: '現金' }, { name: '銀行帳戶' }, { name: '電子支付' }, { name: '信用卡' }];

// ===== 主要進入點 =====
function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

const ACTIONS = {
  getBootstrapData: function (r) { return getBootstrapData(r.month); },
  addTransaction: function (r) { const t = addTransaction(r.data); return getBootstrapData(t.date.substring(0, 7)); },
  updateTransaction: function (r) { const t = updateTransaction(r.data); return getBootstrapData(t.date.substring(0, 7)); },
  deleteTransaction: function (r) { deleteTransaction(r.data && r.data.id); return getBootstrapData(r.month); },
  setPaymentStatus: function (r) { setPaymentStatus(r.data); return getBootstrapData(r.month); },
  saveSettings: function (r) { saveSettings(r.data); return getBootstrapData(r.month); },
  addFixedCost: function (r) { addFixedCost(r.data); return getBootstrapData(r.month); },
  deleteFixedCost: function (r) { deleteFixedCost(r.data); return getBootstrapData(r.month); },
  changePassword: function (r) { changePassword(r.data); return {}; }
};

function handleRequest(e) {
  try {
    const req = parseRequest(e);
    if (req.action === 'verifyPassword') {
      return jsonResponse({ success: checkPassword(req.password) });
    }
    if (!checkPassword(req.password)) {
      return jsonResponse({ success: false, code: 'AUTH', error: '密碼錯誤或未驗證' });
    }
    const handler = ACTIONS[req.action];
    if (!handler) return jsonResponse({ success: false, error: '未知的操作: ' + req.action });
    return jsonResponse(Object.assign({ success: true }, handler(req)));
  } catch (err) {
    return jsonResponse({ success: false, error: (err && err.message) || String(err) });
  }
}

function parseRequest(e) {
  if (e && e.postData && e.postData.contents) {
    const body = JSON.parse(e.postData.contents);
    return { action: body.action, password: body.password, month: body.month, data: body.data };
  }
  const p = (e && e.parameter) || {};
  return { action: p.action, password: p.password, month: p.month, data: p.data ? JSON.parse(p.data) : null };
}

// ===== 密碼 =====
function getPassword() {
  return PropertiesService.getScriptProperties().getProperty('ACCESS_PASSWORD') || DEFAULT_PASSWORD;
}
function checkPassword(pw) {
  return String(pw == null ? '' : pw) === getPassword();
}
function changePassword(data) {
  const pw = String((data && data.newPassword) || '').trim();
  if (!/^\S{4,32}$/.test(pw)) throw new Error('新密碼需 4～32 個字元，不能有空白');
  PropertiesService.getScriptProperties().setProperty('ACCESS_PASSWORD', pw);
}
// 忘記密碼時：在 Apps Script 編輯器執行這個函式，就會恢復成預設密碼 053005
function resetPasswordToDefault() {
  PropertiesService.getScriptProperties().deleteProperty('ACCESS_PASSWORD');
  Logger.log('密碼已重設為預設值 ' + DEFAULT_PASSWORD);
}

// ===== 工具函式 =====
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

let _tz = null;
function tz() {
  if (!_tz) _tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Taipei';
  return _tz;
}
function nowStr() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd HH:mm:ss'); }

// 把 Sheet 讀出來的日期值統一轉成 'yyyy-MM-dd'（Date 物件、2026/9/1、2026-09-01 都可以）
function toYMD(val) {
  if (val === null || val === undefined || val === '') return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return isNaN(val.getTime()) ? '' : Utilities.formatDate(val, tz(), 'yyyy-MM-dd');
  }
  const m = String(val).match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}
function toStamp(val) {
  if (Object.prototype.toString.call(val) === '[object Date]') return Utilities.formatDate(val, tz(), 'yyyy-MM-dd HH:mm:ss');
  return String(val || '');
}

function shiftMonth(yyyyMM, delta) {
  const parts = yyyyMM.split('-');
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10) + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return y + '-' + (m < 10 ? '0' + m : m);
}

function normBiz(b) {
  const s = String(b == null ? '' : b).trim();
  const key = s.replace(/\s/g, '').toLowerCase();
  return BUSINESS_ALIASES[key] || s;
}

function str(v) { return String(v == null ? '' : v).trim().slice(0, 500); }

// 防止文字被試算表當成公式執行
function safeText(v) {
  const s = str(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('系統忙碌中，請稍後再試');
  try { return fn(); } finally { lock.releaseLock(); }
}

function genId() {
  return 'T' + new Date().getTime() + Math.floor(Math.random() * 1000);
}

function getSheetOrCreate(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function getTransactionSheet() { return getSheetOrCreate(TRANSACTION_SHEET, TRANSACTION_HEADER); }
function getSettingsSheet() { return getSheetOrCreate(SETTINGS_SHEET, ['項目', '數值']); }
function getFixedCostSheet() { return getSheetOrCreate(FIXED_COST_SHEET, ['項目', '金額', '分類']); }

function findRowById(sheet, id) {
  if (!id) return -1;
  const cell = sheet.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : -1;
}

// ===== 交易 =====
function readTransactions() {
  const sheet = getTransactionSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, TRANSACTION_HEADER.length).getValues();
  const list = [];
  data.forEach(function (row) {
    const type = row[2];
    if (type !== '收入' && type !== '支出') return; // 跳過異常列
    const date = toYMD(row[1]);
    if (!date) return;
    list.push({
      id: String(row[0]),
      date: date,
      type: type,
      businessType: normBiz(row[3]),
      category: str(row[4]),
      customer: str(row[5]),
      description: str(row[6]),
      amount: parseFloat(row[7]) || 0,
      account: str(row[8]),
      paymentMethod: str(row[9]),
      paymentStatus: row[10] === UNPAID ? UNPAID : PAID,
      projectId: str(row[11]),
      note: str(row[12]),
      createdAt: toStamp(row[13])
    });
  });
  return list;
}

function cleanTx(d) {
  if (!d) throw new Error('缺少資料');
  const date = toYMD(d.date);
  if (!date) throw new Error('日期格式錯誤');
  if (d.type !== '收入' && d.type !== '支出') throw new Error('收支類型錯誤');
  const amount = Math.round((parseFloat(d.amount) || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error('金額必須大於 0');
  return {
    date: date,
    type: d.type,
    businessType: normBiz(d.businessType) || SHARED_BIZ,
    category: str(d.category) || '其他',
    customer: d.customer,
    description: d.description,
    amount: amount,
    account: d.account,
    paymentMethod: d.paymentMethod,
    paymentStatus: d.paymentStatus === UNPAID ? UNPAID : PAID,
    projectId: d.projectId,
    note: d.note
  };
}

// 第 2～13 欄（日期～備註）
function txCells(t) {
  return [
    t.date, t.type, t.businessType, safeText(t.category),
    safeText(t.customer), safeText(t.description), t.amount,
    safeText(t.account), safeText(t.paymentMethod), t.paymentStatus,
    safeText(t.projectId), safeText(t.note)
  ];
}

function addTransaction(data) {
  const t = cleanTx(data);
  const now = nowStr();
  withLock(function () {
    getTransactionSheet().appendRow([genId()].concat(txCells(t), [now, now]));
  });
  return t;
}

function updateTransaction(data) {
  if (!data || !data.id) throw new Error('缺少交易 ID');
  const t = cleanTx(data);
  withLock(function () {
    const sheet = getTransactionSheet();
    const row = findRowById(sheet, data.id);
    if (row < 2) throw new Error('找不到這筆交易，可能已被刪除');
    sheet.getRange(row, COL.DATE, 1, 12).setValues([txCells(t)]);
    sheet.getRange(row, COL.UPDATED).setValue(nowStr());
  });
  return t;
}

function deleteTransaction(id) {
  if (!id) throw new Error('缺少交易 ID');
  withLock(function () {
    const sheet = getTransactionSheet();
    const row = findRowById(sheet, id);
    if (row >= 2) sheet.deleteRow(row);
  });
}

function setPaymentStatus(data) {
  if (!data || !data.id) throw new Error('缺少交易 ID');
  const status = data.status === UNPAID ? UNPAID : PAID;
  withLock(function () {
    const sheet = getTransactionSheet();
    const row = findRowById(sheet, data.id);
    if (row < 2) throw new Error('找不到這筆交易，可能已被刪除');
    sheet.getRange(row, COL.STATUS).setValue(status);
    sheet.getRange(row, COL.UPDATED).setValue(nowStr());
  });
}

// ===== 設定 =====
function getSettings() {
  const sheet = getSettingsSheet();
  const lastRow = sheet.getLastRow();
  const result = { CASH_BALANCE: 0, OWNER_SALARY_TARGET: 0 };
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(function (r) {
      if (r[0] in result) result[r[0]] = parseFloat(r[1]) || 0;
    });
  }
  return result;
}

function saveSettings(data) {
  if (!data) throw new Error('缺少資料');
  withLock(function () {
    const sheet = getSettingsSheet();
    const lastRow = sheet.getLastRow();
    const keys = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
    ['CASH_BALANCE', 'OWNER_SALARY_TARGET'].forEach(function (key) {
      if (!(key in data)) return;
      const val = parseFloat(data[key]) || 0;
      const i = keys.indexOf(key);
      if (i >= 0) sheet.getRange(i + 2, 2).setValue(val);
      else { sheet.appendRow([key, val]); keys.push(key); }
    });
  });
}

// ===== 固定成本 =====
function getFixedCostList() {
  const sheet = getFixedCostSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 3).getValues()
    .map(function (r, i) { return { row: i + 2, item: str(r[0]), amount: parseFloat(r[1]) || 0, category: str(r[2]) || '其他' }; })
    .filter(function (x) { return x.item; });
}

function addFixedCost(data) {
  if (!data || !str(data.item) || !(parseFloat(data.amount) > 0)) throw new Error('請填項目與金額');
  withLock(function () {
    getFixedCostSheet().appendRow([safeText(data.item), parseFloat(data.amount), safeText(data.category) || '其他']);
  });
}

function deleteFixedCost(data) {
  if (!data || !data.row) throw new Error('缺少資料');
  withLock(function () {
    const sheet = getFixedCostSheet();
    const row = parseInt(data.row, 10);
    if (row < 2 || row > sheet.getLastRow()) throw new Error('找不到這筆固定成本');
    // 確認該列的項目名稱一致，避免清單已變動時刪錯
    if (str(sheet.getRange(row, 1).getValue()) !== str(data.item)) throw new Error('資料已變動，請重新整理後再試');
    sheet.deleteRow(row);
  });
}

// ===== 主要彙總：儀表板 + 帳本 + 趨勢 + 應收應付 =====
function getBootstrapData(month) {
  const target = /^\d{4}-\d{2}$/.test(month || '') ? month : Utilities.formatDate(new Date(), tz(), 'yyyy-MM');
  const all = readTransactions();

  const byMonth = {};
  all.forEach(function (t) {
    const m = t.date.substring(0, 7);
    (byMonth[m] = byMonth[m] || []).push(t);
  });
  const txOf = function (m) { return byMonth[m] || []; };
  const inStudio = function (t) { return INCLUDE_PERSONAL_IN_STUDIO || t.businessType !== PERSONAL_BIZ; };
  const sumStudio = function (list) {
    let r = 0, x = 0;
    list.forEach(function (t) {
      if (!inStudio(t)) return;
      if (t.type === '收入') r += t.amount; else x += t.amount;
    });
    return { revenue: r, expense: x };
  };

  const fixedCostList = getFixedCostList();
  const fixedCosts = fixedCostList.reduce(function (s, x) { return s + x.amount; }, 0);
  const settings = getSettings();
  const cashBalance = settings.CASH_BALANCE;
  const ownerSalary = settings.OWNER_SALARY_TARGET;

  const monthTx = txOf(target);
  const cur = sumStudio(monthTx);
  const prevMonth = shiftMonth(target, -1);
  const prev = sumStudio(txOf(prevMonth));
  const prevHasData = txOf(prevMonth).length > 0;

  const netProfit = cur.revenue - cur.expense - fixedCosts;
  const breakevenRevenue = cur.expense + fixedCosts;

  // 現金續航：用近 3 個月（有資料的月份）平均燒錢速度
  const burns = [];
  for (let i = 0; i < 3; i++) {
    const m = shiftMonth(target, -i);
    if (!txOf(m).length) continue;
    const s = sumStudio(txOf(m));
    burns.push(s.expense + fixedCosts - s.revenue);
  }
  const avgBurn = burns.length ? burns.reduce(function (a, b) { return a + b; }, 0) / burns.length : fixedCosts;
  let runwayMonths = null; // null = 沒有在燒錢
  if (avgBurn > 0) runwayMonths = cashBalance > 0 ? Math.round(cashBalance / avgBurn * 10) / 10 : 0;

  let health, healthReason;
  if (netProfit >= 0 && (runwayMonths === null || runwayMonths >= 3)) {
    health = '綠燈'; healthReason = '本月獲利，現金續航充足';
  } else if (runwayMonths === null || runwayMonths >= 1) {
    health = '黃燈'; healthReason = netProfit < 0 ? '本月還沒達到損益兩平' : '現金續航少於 3 個月';
  } else {
    health = '紅燈'; healthReason = cashBalance <= 0 ? '尚未設定現金餘額，或現金已不足' : '現金續航少於 1 個月';
  }

  // 各業務
  const byBusiness = {};
  BUSINESS_TYPES.forEach(function (b) { byBusiness[b] = { revenue: 0, expense: 0, profit: 0, margin: 0, count: 0 }; });
  const expenseByCat = {};
  monthTx.forEach(function (t) {
    const b = byBusiness[t.businessType] || (byBusiness[t.businessType] = { revenue: 0, expense: 0, profit: 0, margin: 0, count: 0 });
    b.count++;
    if (t.type === '收入') b.revenue += t.amount;
    else {
      b.expense += t.amount;
      if (inStudio(t)) expenseByCat[t.category] = (expenseByCat[t.category] || 0) + t.amount;
    }
  });
  Object.keys(byBusiness).forEach(function (k) {
    const x = byBusiness[k];
    x.profit = x.revenue - x.expense;
    x.margin = x.revenue > 0 ? x.profit / x.revenue * 100 : 0;
  });
  const topExpenses = Object.keys(expenseByCat)
    .map(function (k) { return { name: k, amount: expenseByCat[k] }; })
    .sort(function (a, b) { return b.amount - a.amount; })
    .slice(0, 6);

  // 應收應付（跨所有月份，只要還沒結清）
  const todayMs = new Date(toYMD(new Date()) + 'T00:00:00').getTime();
  const unsettled = all.filter(function (t) { return t.paymentStatus === UNPAID; });
  const receivable = unsettled.filter(function (t) { return t.type === '收入'; }).reduce(function (s, x) { return s + x.amount; }, 0);
  const payable = unsettled.filter(function (t) { return t.type === '支出'; }).reduce(function (s, x) { return s + x.amount; }, 0);
  const outstandingItems = unsettled
    .slice()
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .slice(0, 100)
    .map(function (t) {
      const o = Object.assign({}, t);
      o.ageDays = Math.max(0, Math.round((todayMs - new Date(t.date + 'T00:00:00').getTime()) / 86400000));
      return o;
    });

  // 近 6 個月趨勢
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(target, -i);
    const s = sumStudio(txOf(m));
    trend.push({ month: m, revenue: s.revenue, expense: s.expense });
  }

  // 客戶清單（依最近交易排序，給自動完成用）
  const customerSeen = {};
  const customers = [];
  all.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (t) {
    if (t.customer && !customerSeen[t.customer] && customers.length < 80) {
      customerSeen[t.customer] = true;
      customers.push(t.customer);
    }
  });

  const categories = [];
  Object.keys(CATEGORIES).forEach(function (biz) {
    ['收入', '支出'].forEach(function (type) {
      (CATEGORIES[biz][type] || []).forEach(function (cat) {
        categories.push({ name: cat, type: type, businessType: biz });
      });
    });
  });

  const transactions = monthTx.slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  return {
    month: target,
    dashboard: {
      month: target,
      revenue: cur.revenue,
      expenses: cur.expense,
      netProfit: netProfit,
      fixedCosts: fixedCosts,
      prev: { month: prevMonth, hasData: prevHasData, revenue: prev.revenue, expenses: prev.expense, netProfit: prev.revenue - prev.expense - fixedCosts },
      cashBalance: cashBalance,
      ownerSalary: ownerSalary,
      breakevenRevenue: breakevenRevenue,
      breakevenWithSalary: breakevenRevenue + ownerSalary,
      avgBurn: avgBurn,
      runwayMonths: runwayMonths,
      health: health,
      healthReason: healthReason,
      byBusiness: byBusiness,
      topExpenses: topExpenses
    },
    transactions: transactions,
    trend: trend,
    outstanding: { receivable: receivable, payable: payable, count: unsettled.length, items: outstandingItems },
    fixedCosts: fixedCostList,
    businessTypes: BUSINESS_TYPES,
    categories: categories,
    accounts: ACCOUNTS,
    customers: customers,
    meta: { version: APP_VERSION, includePersonal: INCLUDE_PERSONAL_IN_STUDIO, personalBiz: PERSONAL_BIZ, sharedBiz: SHARED_BIZ }
  };
}

// ===== v4 升級工具（在 Apps Script 編輯器手動執行一次）=====
// 把「交易紀錄」裡的 迪特軍EV／電動車 等舊名稱直接改寫成「電車男電能車」
// 不執行也能用（讀取時會自動轉換），但執行後試算表本身也會是新名稱，比較乾淨
function upgradeToV4() {
  const sheet = getTransactionSheet();
  getSettingsSheet();
  getFixedCostSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) { Logger.log('交易紀錄是空的，不需要改名。'); return; }
  const range = sheet.getRange(2, COL.BIZ, lastRow - 1, 1);
  const values = range.getValues();
  let changed = 0;
  values.forEach(function (r) {
    const n = normBiz(r[0]);
    if (n !== r[0]) { r[0] = n; changed++; }
  });
  if (changed) range.setValues(values);
  Logger.log('升級完成：共把 ' + changed + ' 筆業務類型改成新名稱。');
}

// ===== 一次性搬移工具：把舊的四個分頁資料搬進「交易紀錄」總表 =====
// 已經在 v3 搬過的話不用再跑（有防重複機制，第二次執行會直接跳過）
function migrateOldLedgersToTransactions() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('OLD_LEDGERS_MIGRATED')) {
    Logger.log('之前已經搬移過，這次略過。若確定要重搬，先刪除 Script Properties 的 OLD_LEDGERS_MIGRATED。');
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const newSheet = getTransactionSheet();
  const rows = [];

  OLD_LEDGER_NAMES.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() <= 1) return;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues().forEach(function (row) {
      const type = row[1];
      if (type !== '收入' && type !== '支出') return;
      const dateVal = toYMD(row[0]);
      if (!dateVal) return;
      const createdAt = toStamp(row[7]) || dateVal;
      const paymentMethod = str(row[5]);
      rows.push([
        'M' + Utilities.getUuid().substring(0, 8), dateVal, type, normBiz(name), safeText(row[2]),
        '', safeText(row[4]), parseFloat(row[3]) || 0,
        paymentMethod || '現金', paymentMethod, PAID, '', safeText(row[6]), createdAt, createdAt
      ]);
    });
  });

  if (rows.length) {
    newSheet.getRange(newSheet.getLastRow() + 1, 1, rows.length, TRANSACTION_HEADER.length).setValues(rows);
  }
  props.setProperty('OLD_LEDGERS_MIGRATED', nowStr());
  Logger.log('搬移完成，共搬移 ' + rows.length + ' 筆資料到「' + TRANSACTION_SHEET + '」分頁。');
}
