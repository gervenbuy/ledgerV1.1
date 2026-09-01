const CONFIG = {
  SPREADSHEET_ID: '1OeJy1bhmGVMXdbbNx-l7ID5tTVJS1FCJxPNSbNJzjEU',
  SHEETS: {
    TRANSACTIONS: 'Transactions',
    PROJECTS: 'Projects',
    CATEGORIES: 'Categories',
    ACCOUNTS: 'Accounts',
    FIXED_COSTS: 'FixedCosts',
    SETTINGS: 'Settings'
  }
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('工作室財務健康 APP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSpreadsheet_() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.includes('PUT_YOUR')) {
    throw new Error('請先在 Code.gs 的 CONFIG.SPREADSHEET_ID 貼上你的 Google Sheet ID。');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function setupSpreadsheet() {
  const ss = getSpreadsheet_();

  ensureSheet_(ss, CONFIG.SHEETS.TRANSACTIONS, [
    'ID','日期','收入/支出','業務類型','分類','專案ID','客戶','說明','金額','付款方式','帳戶','付款狀態','備註','建立時間'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.PROJECTS, [
    '專案ID','專案名稱','客戶','業務類型','開始日期','結束日期','報價','狀態','備註'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.CATEGORIES, ['類型','分類名稱','業務類型','啟用']);
  ensureSheet_(ss, CONFIG.SHEETS.ACCOUNTS, ['帳戶名稱','帳戶類型','期初餘額','啟用']);
  ensureSheet_(ss, CONFIG.SHEETS.FIXED_COSTS, ['項目','每月金額','分類','啟用','備註']);
  ensureSheet_(ss, CONFIG.SHEETS.SETTINGS, ['設定鍵','設定值','說明']);

  seedDefaults_(ss);
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
      ['收入','AI課程','AI課程',true],['收入','接案收入','接案',true],['收入','維修收入','電動車',true],['收入','車輛銷售','電動車',true],['收入','設計收入','設計製作',true],['收入','顧問費','顧問',true],
      ['支出','租金','工作室共用',true],['支出','軟體訂閱','工作室共用',true],['支出','廣告','工作室共用',true],['支出','電話網路','工作室共用',true],['支出','車輛分期','工作室共用',true],
      ['支出','教材印刷','AI課程',true],['支出','交通','工作室共用',true],['支出','外包','接案',true],['支出','零件','電動車',true],['支出','進貨','電動車',true],['支出','印刷製作','設計製作',true],['支出','其他','工作室共用',true]
    ];
    cat.getRange(2,1,rows.length,4).setValues(rows);
  }

  const accounts = ss.getSheetByName(CONFIG.SHEETS.ACCOUNTS);
  if (accounts.getLastRow() <= 1) {
    accounts.getRange(2,1,4,4).setValues([
      ['工作室銀行','銀行',0,true],['現金','現金',0,true],['信用卡','信用卡',0,true],['個人代墊','其他',0,true]
    ]);
  }

  const fixed = ss.getSheetByName(CONFIG.SHEETS.FIXED_COSTS);
  if (fixed.getLastRow() <= 1) {
    fixed.getRange(2,1,9,5).setValues([
      ['工作室租金',19000,'租金',true,''],['ChatGPT',650,'軟體訂閱',true,''],['Gemini',650,'軟體訂閱',true,''],['Claude',760,'軟體訂閱',true,'依實際台幣帳單調整'],['Kling',610,'軟體訂閱',true,'依實際台幣帳單調整'],['Google Ads',3000,'廣告',true,''],['Facebook Ads',3000,'廣告',true,''],['電話＋網路',2000,'電話網路',true,''],['貨車分期',4790,'車輛分期',true,'48期']
    ]);
  }

  const settings = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (settings.getLastRow() <= 1) {
    settings.getRange(2,1,4,3).setValues([
      ['OWNER_SALARY_TARGET',40000,'老闆每月希望領取金額'],['CASH_BALANCE',0,'目前工作室可動用現金'],['SAFE_MONTHS',6,'健康現金續航月份'],['LOW_MONTHS',3,'危險現金續航月份']
    ]);
  }
}

function getBootstrapData() {
  setupSpreadsheet();
  return {
    businessTypes: ['AI課程','接案','電動車','設計製作','顧問','工作室共用'],
    categories: getCategories_(),
    accounts: getAccounts_(),
    fixedCosts: getFixedCosts_(),
    dashboard: getDashboard(),
    recentTransactions: getTransactions({ limit: 30 })
  };
}

function getCategories_() {
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.CATEGORIES);
  const rows = getRows_(sh);
  return rows.filter(r => asBool_(r[3])).map(r => ({ type:r[0], name:r[1], businessType:r[2] }));
}

function getAccounts_() {
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.ACCOUNTS);
  const rows = getRows_(sh);
  return rows.filter(r => asBool_(r[3])).map(r => ({ name:r[0], type:r[1], openingBalance:Number(r[2]||0) }));
}

function getFixedCosts_() {
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.FIXED_COSTS);
  const rows = getRows_(sh);
  return rows.filter(r => asBool_(r[3])).map(r => ({ item:r[0], amount:Number(r[1]||0), category:r[2], note:r[4]||'' }));
}

function getRows_(sh) {
  const lr = sh.getLastRow();
  const lc = sh.getLastColumn();
  if (lr <= 1 || lc === 0) return [];
  return sh.getRange(2,1,lr-1,lc).getValues();
}

function addTransaction(data) {
  validateTransaction_(data);
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.SHEETS.TRANSACTIONS);
  const id = 'TX-' + Utilities.getUuid().slice(0,8).toUpperCase();
  const now = new Date();
  sh.appendRow([
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
    now
  ]);
  return { ok:true, id:id, dashboard:getDashboard(), recentTransactions:getTransactions({limit:30}) };
}

function validateTransaction_(d) {
  if (!d) throw new Error('缺少資料');
  ['date','type','businessType','category','amount'].forEach(k => {
    if (d[k] === undefined || d[k] === null || d[k] === '') throw new Error('欄位不可空白：' + k);
  });
  if (!['收入','支出'].includes(d.type)) throw new Error('收入/支出格式錯誤');
  if (Number(d.amount) <= 0) throw new Error('金額必須大於 0');
}

function parseDate_(s) {
  const parts = String(s).split('-').map(Number);
  return new Date(parts[0], parts[1]-1, parts[2]);
}

function getTransactions(filter) {
  filter = filter || {};
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.TRANSACTIONS);
  const rows = getRows_(sh);
  let list = rows.map(r => ({
    id:r[0], date:formatDate_(r[1]), type:r[2], businessType:r[3], category:r[4], projectId:r[5]||'', customer:r[6]||'', description:r[7]||'', amount:Number(r[8]||0), paymentMethod:r[9]||'', account:r[10]||'', paymentStatus:r[11]||'', note:r[12]||'', createdAt:formatDateTime_(r[13])
  }));

  if (filter.businessType) list = list.filter(x => x.businessType === filter.businessType);
  if (filter.type) list = list.filter(x => x.type === filter.type);
  if (filter.month) list = list.filter(x => x.date.startsWith(filter.month));

  list.sort((a,b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  if (filter.limit) list = list.slice(0, Number(filter.limit));
  return list;
}

function getDashboard() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.SHEETS.TRANSACTIONS);
  const rows = getRows_(sh);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  let revenue = 0;
  let expenses = 0;
  const byBusiness = {};
  ['AI課程','接案','電動車','設計製作','顧問','工作室共用'].forEach(k => byBusiness[k] = { revenue:0, expense:0, profit:0, margin:0 });

  rows.forEach(r => {
    const d = new Date(r[1]);
    if (d.getFullYear() !== y || d.getMonth() !== m) return;
    const type = r[2], biz = r[3] || '工作室共用', amount = Number(r[8]||0);
    if (!byBusiness[biz]) byBusiness[biz] = { revenue:0, expense:0, profit:0, margin:0 };
    if (type === '收入') { revenue += amount; byBusiness[biz].revenue += amount; }
    if (type === '支出') { expenses += amount; byBusiness[biz].expense += amount; }
  });

  Object.keys(byBusiness).forEach(k => {
    const b = byBusiness[k];
    b.profit = b.revenue - b.expense;
    b.margin = b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0;
  });

  const fixedCosts = getFixedCosts_().reduce((s,x)=>s+x.amount,0);
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

  const totalBusinessRevenue = Object.values(byBusiness).reduce((s,b)=>s+b.revenue,0);
  const totalBusinessExpense = Object.values(byBusiness).reduce((s,b)=>s+b.expense,0);
  const avgMargin = totalBusinessRevenue > 0 ? (totalBusinessRevenue-totalBusinessExpense)/totalBusinessRevenue : 0;
  const breakevenRevenue = avgMargin > 0 ? (fixedCosts + ownerSalary) / avgMargin : 0;

  return {
    month: Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM'),
    revenue, expenses, netProfit, fixedCosts, ownerSalary, cashBalance,
    runwayMonths: runway,
    health,
    breakevenRevenue,
    avgMargin: avgMargin * 100,
    byBusiness
  };
}

function getSettingsMap_() {
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
  const rows = getRows_(sh);
  const out = {};
  rows.forEach(r => out[r[0]] = r[1]);
  return out;
}

function saveSettings(data) {
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
  const rows = getRows_(sh);
  const keyToRow = {};
  rows.forEach((r,i)=> keyToRow[r[0]] = i+2);
  Object.keys(data || {}).forEach(key => {
    if (keyToRow[key]) sh.getRange(keyToRow[key],2).setValue(data[key]);
    else sh.appendRow([key, data[key], '']);
  });
  return { ok:true, dashboard:getDashboard() };
}

function addFixedCost(data) {
  if (!data || !data.item || Number(data.amount) <= 0) throw new Error('固定成本資料不完整');
  const sh = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.FIXED_COSTS);
  sh.appendRow([data.item, Number(data.amount), data.category || '其他', true, data.note || '']);
  return { ok:true, fixedCosts:getFixedCosts_(), dashboard:getDashboard() };
}

function formatDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd');
}

function formatDateTime_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}

function asBool_(v) {
  return v === true || String(v).toLowerCase() === 'true' || String(v) === '1';
}
