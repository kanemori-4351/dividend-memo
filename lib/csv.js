// CSV の読み込み（銀行・証券会社からダウンロードしたファイル用）
// 日本の金融機関の CSV は Shift_JIS のことが多いので、UTF-8 で読めなければ Shift_JIS で読み直す。

export function decode(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(buffer);
  }
}

// ダブルクォートで囲まれた値（中のカンマ・改行・"" を含む）に対応した CSV 解析
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ""));
}

// "¥1,234,567" "+12,000円" "△3,000" "(500)" などを数値に。数値でなければ null。
export function parseNumber(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/[¥￥円,，\s]/g, "");
  t = t.replace(/[０-９．－＋]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  let neg = false;
  if (/^[△▲]/.test(t)) { neg = true; t = t.slice(1); }
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return neg ? -n : n;
}

// 見出しの行を推測する：数値でない値が2つ以上あり、その下の行に数値がある最初の行
export function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length - 1, 30); i++) {
    const textCells = rows[i].filter((v) => v !== "" && parseNumber(v) === null).length;
    const nextHasNumber = rows[i + 1].some((v) => parseNumber(v) !== null);
    if (textCells >= 2 && nextHasNumber) return i;
  }
  return 0;
}

// 見出しの下で、指定した列が数値の行だけを使う
function numericCells(rows, headerRow, col) {
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const n = parseNumber(rows[i][col]);
    if (n !== null) out.push(n);
  }
  return out;
}

export function sumColumn(rows, headerRow, col) {
  const cells = numericCells(rows, headerRow, col);
  return cells.length ? cells.reduce((a, b) => a + b, 0) : null;
}

export function lastValue(rows, headerRow, col) {
  const cells = numericCells(rows, headerRow, col);
  return cells.length ? cells[cells.length - 1] : null;
}

// 銘柄コード
// 日本株：4けた、または 285A のような3けた＋英字
const JP_RE = /(?<![0-9A-Za-z])(\d{3}[0-9A-Z])(?![0-9A-Za-z])/;
// 米国株：英字1〜5文字（BRK.B のような形も）
const US_RE = /^([A-Z]{1,5}(?:[.\-][A-Z])?)(?![A-Za-z0-9])/;
// 投資信託の協会コード：8文字の英数字（数字を含む）
const FUND_RE = /(?<![0-9A-Za-z])((?=[0-9A-Z]{8}(?![0-9A-Za-z]))(?=[0-9A-Z]*\d)[0-9A-Z]{8})/;

export const extractCode = (s) => (String(s ?? "").match(JP_RE) || [])[1] || null;

// 文字列から銘柄コードと種類を推測する
export function detectCode(s, hint = null) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const fund = t.match(FUND_RE);
  if (fund && hint === "fund") return { code: fund[1], assetType: "fund" };
  const jp = t.match(JP_RE);
  if (jp && hint !== "us") return { code: jp[1], assetType: "jp" };
  const us = t.toUpperCase() === t || /^[A-Z]/.test(t) ? t.match(US_RE) : null;
  if (us && hint !== "fund") return { code: us[1], assetType: "us" };
  if (fund) return { code: fund[1], assetType: "fund" };
  return null;
}

// 口座区分を文字から推測する
export function detectTaxType(text) {
  if (/iDeCo|ｉＤｅＣｏ|確定拠出/i.test(text)) return "ideco";
  if (/NISA|ＮＩＳＡ/i.test(text)) {
    if (/つみたて|積立/.test(text)) return "nisa_tsumitate";
    if (/旧|ジュニア|20\d\d年/.test(text)) return "nisa_old";
    return "nisa_growth";
  }
  if (/特定|一般|課税/.test(text)) return "taxable";
  return null;
}
function detectAssetSection(text) {
  if (/米国|外国株|海外株|US株/.test(text)) return "us";
  if (/投資信託|投信|ファンド/.test(text)) return "fund";
  if (/国内株|日本株|株式|現物/.test(text)) return "jp";
  return null;
}

// 見出しの名前から、列の役割を推測する
export function guessColumns(headerCells) {
  const find = (re, not) => headerCells.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const code = find(/コード|ティッカー/);
  let name = find(/^銘柄(名)?$|銘柄名|ファンド名|^名称$/);
  if (name < 0) name = find(/銘柄/);
  return {
    code: code >= 0 ? code : name,
    name,
    shares: find(/保有(株|口)?数|数量|株数|口数/),
    cost: find(/取得(単価|価額)|平均取得/, /総額|合計/),
    price: find(/現在値|現在価格|基準価額|時価|^価格$/, /評価|総額|損益|前日/),
  };
}

// 証券会社の保有一覧から、銘柄・数量・取得単価・現在値・種類・口座区分を取り出す。
// 「NISA預り」「米国株式」のような区切りの行があれば、その下の銘柄に当てはめる。
export function extractHoldings(rows, headerRow, cols) {
  const out = [];
  let taxType = "taxable", section = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const joined = row.join(" ");
    const shares = i > headerRow ? parseNumber(row[cols.shares]) : null;
    let found = i > headerRow && shares !== null && shares > 0 ? detectCode(row[cols.code], section) : null;
    // 投資信託でコードがない場合は、名前をコードの代わりにする
    if (!found && section === "fund" && shares > 0) {
      const fundName = (cols.name >= 0 && row[cols.name]) || row[cols.code] || "";
      if (fundName && parseNumber(fundName) === null) found = { code: fundName.replace(/\s+/g, "").slice(0, 16), assetType: "fund", name: fundName };
    }
    if (!found) {
      taxType = detectTaxType(joined) || taxType;
      section = detectAssetSection(joined) || section;
      continue;
    }
    let name = found.name || (cols.name >= 0 ? row[cols.name] : "");
    if (cols.name === cols.code || !name) name = String(row[cols.code] ?? "").replace(found.code, "").replace(/^[\s　:：/／-]+/, "").trim();
    const cost = cols.cost >= 0 ? parseNumber(row[cols.cost]) : null;
    const price = cols.price >= 0 ? parseNumber(row[cols.price]) : null;
    // 行の中に口座区分の列があれば、それを優先する（コード・名前の列は見ない）
    const other = row.filter((_, c) => c !== cols.code && c !== cols.name).join(" ");
    out.push({
      code: found.code,
      assetType: found.assetType,
      name: name.slice(0, 60),
      shares,
      cost: cost !== null && cost > 0 ? cost : null,
      price: price !== null && price > 0 ? price : null,
      taxType: detectTaxType(other) || taxType,
    });
  }
  return out;
}

// Claude の調査結果の貼り付け用。
// 新しい形：1行に「コード,確定月,支払月,1株配当,株価,業種」（確定月・株価・業種は空でもよい）
// 古い形：「コード,支払月,1株配当」
// ドル円：「USDJPY,155.3」
// 「#」で始まる行、見出し行、空行は無視。全角の数字・カンマも可。
export function parseDividendText(text) {
  const byCode = new Map();
  const errors = [];
  let usdjpy = null;
  const norm = String(text)
    .replace(/[０-９Ａ-Ｚａ-ｚ，．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/、/g, ",");
  norm.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim().replace(/^[-*・]\s*/, "");
    if (!t || t.startsWith("#") || /^(コード|code)\b/i.test(t) || /^```/.test(t)) return;
    const cells = t.split(/[,\t]/).map((c) => c.trim());
    const code = cells[0].toUpperCase().slice(0, 16);
    if (/^USD\/?JPY$|^ドル円$/.test(code)) {
      const v = parseNumber(cells[1]);
      if (v > 0) usdjpy = v; else errors.push(i + 1);
      return;
    }
    const m = (v) => { const n = Number(String(v ?? "").replace(/月$/, "")); return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null; };
    const money = (v) => (String(v ?? "").trim() === "" ? null : parseNumber(String(v).replace(/円$|ドル$|\$/g, "")));
    let rec;
    if (cells.length <= 3) {
      rec = { recordMonth: null, payMonth: m(cells[1]), dps: money(cells[2]), price: null, sector: "" };
    } else {
      rec = { recordMonth: m(cells[1]), payMonth: m(cells[2]), dps: money(cells[3]), price: money(cells[4]), sector: (cells[5] || "").slice(0, 30) };
    }
    const hasPayment = rec.payMonth && rec.dps !== null && rec.dps >= 0;
    const hasInfo = rec.price !== null || rec.sector || rec.dps === 0;
    if (!code || (!hasPayment && !hasInfo) || (rec.dps !== null && rec.dps < 0)) { errors.push(i + 1); return; }
    if (!byCode.has(code)) byCode.set(code, { payments: [], price: null, sector: "", noDividend: false });
    const e = byCode.get(code);
    if (rec.dps === 0) e.noDividend = true; // 1株配当0＝無配・分配なし
    if (hasPayment && rec.dps > 0) e.payments.push({ payMonth: rec.payMonth, recordMonth: rec.recordMonth, dps: rec.dps });
    if (rec.price !== null && rec.price > 0) e.price = rec.price;
    if (rec.sector) e.sector = rec.sector;
  });
  return { byCode, errors, usdjpy };
}

export function firstValue(rows, headerRow, col) {
  const cells = numericCells(rows, headerRow, col);
  return cells.length ? cells[0] : null;
}
