/**
 * 도르리 일일 매출 보고 웹앱
 * - '보고용 긴급' 시트의 '보고용' 탭을 읽어, 날짜별 매출·광고 보고서를 웹페이지로 보여줍니다.
 * - 배포: 배포 > 새 배포 > 유형 '웹 앱' > 실행 사용자 '나' > 액세스 권한 '모든 사용자'
 */

// ===== 설정 =====
const SPREADSHEET_ID = '1yyfXax86LTLFOwcrMzDmxcf0MHN0l5CoReyqpQbVhwo'; // 보고용 긴급
const SHEET_NAME = '보고용';
const PAGE_TITLE = '도르리 일일 매출 보고';
// 비워두면 링크만으로 열립니다. 값을 넣으면 링크 끝에 ?k=값 을 붙여야 열립니다.
const ACCESS_KEY = '';
const CACHE_SECONDS = 300; // 시트를 5분마다 새로 읽음

const CHANNELS = [
  { key: '쿠팡', name: '아이엔지스토리', code: 'A', plat: '쿠팡', logo: ':coupanglogo:', adCats: true, returns: true },
  { key: '케이케이리', name: '케이케이리', code: 'B', plat: '쿠팡', logo: ':coupanglogo:', adCats: true, returns: true },
  { key: '아이앤홈', name: '아이엔홈', code: 'E', plat: '쿠팡', logo: ':coupanglogo:', adCats: true, returns: true },
  { key: '네이버', name: '네이버', code: 'C', plat: '네이버', logo: ':naverlogo:', adCats: false, returns: false },
  { key: '오늘의집', name: '오늘의집', code: 'D', plat: '오늘의집', logo: ':myhouselogo:', adCats: false, returns: false },
  { key: '자사몰', name: '자사몰', code: 'F', plat: '자사몰', logo: ':dorrilogo:', adCats: false, returns: false }
];

// ===== 웹 진입점 =====
function doGet(e) {
  const key = (e && e.parameter && e.parameter.k) || '';
  if (ACCESS_KEY && key !== ACCESS_KEY) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">접근 권한이 없습니다.</p>')
      .setTitle(PAGE_TITLE);
  }
  const t = HtmlService.createTemplateFromFile('Index');
  t.accessKey = key;
  t.pageTitle = PAGE_TITLE;
  return t.evaluate()
    .setTitle(PAGE_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // 홈 화면 앱(PWA) 안에 띄우기 위해 필요
}

/** 화면에서 호출: 선택한 날짜의 보고서 (date 비우면 기본 날짜) */
function getReport(date, key) {
  if (ACCESS_KEY && key !== ACCESS_KEY) throw new Error('접근 권한이 없습니다.');
  const data = loadData_();
  return buildReport_(data, date || defaultDate_(data.dates));
}

// ===== 시트 읽기 (5분 캐시) =====
function loadData_() {
  const cache = CacheService.getScriptCache();
  const hit = getChunked_(cache, 'report_v1');
  if (hit) return JSON.parse(hit);
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`'${SHEET_NAME}' 탭을 찾을 수 없습니다.`);
  const values = sheet.getDataRange().getDisplayValues();
  const data = parseValues_(values);
  putChunked_(cache, 'report_v1', JSON.stringify(data), CACHE_SECONDS);
  return data;
}

// CacheService 한 칸은 100KB 제한이라 나눠서 저장
function putChunked_(cache, key, str, sec) {
  const size = 90000, n = Math.ceil(str.length / size), obj = {};
  for (let i = 0; i < n; i++) obj[key + '_' + i] = str.slice(i * size, (i + 1) * size);
  obj[key + '_n'] = String(n);
  try { cache.putAll(obj, sec); } catch (err) { /* 캐시 실패는 무시 */ }
}
function getChunked_(cache, key) {
  const n = Number(cache.get(key + '_n') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let s = '';
  for (const k of keys) { if (got[k] == null) return null; s += got[k]; }
  return s;
}

// ===== 셀 문구 → 숫자 =====
function toNum_(s) {
  const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}
function part_(s, label) {
  const m = String(s || '').replace(/,/g, '')
    .match(new RegExp(label + '\\s*:\\s*(-?\\d+(?:\\.\\d+)?)원?\\s*(?:(-?\\d+)개)?'));
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : 0] : [0, 0];
}

/** 시트 값 → { dates: [...], byDate: { 'YYYY-MM-DD': { note, ch: { 채널: { total:{}, cats:[{}] } } } } } */
function roasTxt_(s) {
  const m = String(s || '').match(/ROAS\s*:\s*([^|]+)/);
  return m ? m[1].trim() : '';
}

function parseValues_(values) {
  const head = values[0] || [];
  const cols = [];
  head.forEach((h, i) => {
    const t = String(h).replace(/\n/g, ' ');
    if (t.trim() === '특이사항') { cols.push({ i, kind: 'note' }); return; }
    const ch = (t.match(/\(([^)]+)\)/) || [])[1];
    if (!ch) return;
    if (/당일 매출/.test(t)) cols.push({ i, ch, kind: 'sales_total' });
    else if (/당일 광고비/.test(t)) cols.push({ i, ch, kind: 'ad_total' });
    else if (/ROAS/.test(t)) cols.push({ i, ch, kind: 'roas' });
    else {
      const m = t.match(/\d+-\d+\.\s*(\S+)\s+(매출|광고비)/);
      if (m) cols.push({ i, ch, cat: m[1], kind: m[2] === '매출' ? 'cat_sales' : 'cat_ad' });
    }
  });
  if (!cols.length) throw new Error('보고용 탭의 머리글을 찾지 못했습니다.');

  const blank = () => ({ sales: 0, qty: 0, trial: 0, returns: 0, return_qty: 0, ad: 0, ad_conv: 0, ad_total_sales: 0, roas: 0 });
  const byDate = {}, dates = [];
  values.slice(1).forEach(r => {
    const dm = String(r[0] || '').match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!dm) return;
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    const day = { note: '', ch: {} };
    cols.forEach(c => {
      const v = r[c.i];
      if (c.kind === 'note') { day.note = String(v || '').trim(); return; }
      const chd = day.ch[c.ch] = day.ch[c.ch] || { total: blank(), cats: [] };
      if (c.kind === 'sales_total') chd.total.sales = toNum_(v);
      else if (c.kind === 'ad_total') chd.total.ad = toNum_(v);
      else if (c.kind === 'roas') {
        chd.total.ad_conv = part_(v, '광고 전환 매출액')[0];
        chd.total.ad_total_sales = part_(v, '합계 매출액')[0];
        chd.total.roas = part_(v, 'ROAS')[0];
        chd.total.roas_txt = roasTxt_(v);
      } else {
        let o = chd.cats.find(x => x.cat === c.cat);
        if (!o) { o = Object.assign({ cat: c.cat }, blank()); chd.cats.push(o); }
        if (c.kind === 'cat_sales') {
          [o.sales, o.qty] = part_(v, '실매출');
          o.trial = part_(v, '체험단')[0];
          [o.returns, o.return_qty] = part_(v, '반품');
        } else {
          o.ad = part_(v, '광고비')[0];
          o.ad_conv = part_(v, '광고 전환 매출액')[0];
          o.ad_total_sales = part_(v, '합계 매출액')[0];
          o.roas = part_(v, 'ROAS')[0];
          o.roas_txt = roasTxt_(v);
        }
      }
    });
    byDate[date] = day;
    dates.push(date);
  });
  dates.sort();
  // 매출이 기록된 마지막 날까지만
  let last = -1;
  dates.forEach((d, i) => { if (Object.values(byDate[d].ch).some(x => x.total.sales !== 0)) last = i; });
  const kept = dates.slice(0, last + 1);
  const out = {};
  kept.forEach(d => { out[d] = byDate[d]; });
  return { dates: kept, byDate: out };
}

function defaultDate_(dates) {
  const y = Utilities.formatDate(new Date(Date.now() - 24 * 3600e3), 'Asia/Seoul', 'yyyy-MM-dd');
  return dates.indexOf(y) >= 0 ? y : dates[dates.length - 1];
}

// 채널 광고비·전환매출: 합계 칸이 비어 있으면 카테고리 합으로
function chAd_(chd) {
  const sum = f => chd.cats.reduce((a, c) => a + c[f], 0);
  return { ad: chd.total.ad || sum('ad'), conv: chd.total.ad_conv || sum('ad_conv') };
}

function buildReport_(data, date) {
  if (!data.byDate[date]) throw new Error(`${date} 데이터가 없습니다.`);
  const idx = data.dates.indexOf(date);
  const day = data.byDate[date];
  const prevDay = idx > 0 ? data.byDate[data.dates[idx - 1]] : null;
  const sumSales = d => Object.values(d.ch).reduce((a, x) => a + x.total.sales, 0);
  let ad = 0, conv = 0;
  Object.values(day.ch).forEach(x => { const a = chAd_(x); ad += a.ad; conv += a.conv; });
  const channels = CHANNELS.filter(c => day.ch[c.key]).map(c => Object.assign({}, c, day.ch[c.key]));
  return {
    date,
    dates: data.dates,
    isLatest: idx === data.dates.length - 1,
    note: day.note,
    totals: {
      sales: sumSales(day),
      prevSales: prevDay ? sumSales(prevDay) : null,
      ad, conv
    },
    channels,
    readAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'M/d HH:mm')
  };
}

/** 화면에서 호출: 전체 현황용 데이터 (일별 채널 매출·광고비, 월별 채널·카테고리 실적) */
function getOverview(key) {
  if (ACCESS_KEY && key !== ACCESS_KEY) throw new Error('접근 권한이 없습니다.');
  return buildOverview_(loadData_());
}

function buildOverview_(data) {
  const keys = CHANNELS.map(c => c.key);
  const daily = data.dates.map(d => {
    const day = data.byDate[d];
    const o = { date: d, ad: 0, ad_conv: 0 };
    keys.forEach(k => { o[k] = day.ch[k] ? day.ch[k].total.sales : 0; });
    Object.values(day.ch).forEach(x => { const a = chAd_(x); o.ad += a.ad; o.ad_conv += a.conv; });
    return o;
  });
  const m = {};
  data.dates.forEach(d => {
    Object.entries(data.byDate[d].ch).forEach(([ch, x]) => {
      x.cats.forEach(c => {
        const k = d.slice(0, 7) + '|' + ch + '|' + c.cat;
        const o = m[k] = m[k] || { month: d.slice(0, 7), channel: ch, category: c.cat, sales: 0, qty: 0, trial: 0, returns: 0, return_qty: 0, ad: 0 };
        o.sales += c.sales; o.qty += c.qty; o.trial += c.trial; o.returns += c.returns; o.return_qty += c.return_qty; o.ad += c.ad;
      });
    });
  });
  const monthly = Object.values(m).filter(o => o.sales || o.qty || o.returns || o.ad);
  return { daily, monthly, channels: keys, readAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'M/d HH:mm') };
}

/** 에디터에서 실행해 시트를 잘 읽는지 확인하는 테스트 */
function testReport() {
  CacheService.getScriptCache().remove('report_v1_n');
  const r = getReport('', ACCESS_KEY);
  Logger.log(`${r.date} 전 채널 매출 ${r.totals.sales}원, 광고비 ${r.totals.ad}원, 채널 ${r.channels.length}개`);
}
