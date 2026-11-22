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

// 銘柄コード（4けた、または 285A のような3けた＋英字）を取り出す
const CODE_RE = /(?<![0-9A-Za-z])(\d{3}[0-9A-Z])(?![0-9A-Za-z])/;
export const extractCode = (s) => (String(s ?? "").match(CODE_RE) || [])[1] || null;

// 見出しの名前から、列の役割を推測する
export function guessColumns(headerCells) {
  const find = (re) => headerCells.findIndex((h) => re.test(h));
  const code = find(/コード|ティッカー|銘柄\s*[(（]?\s*コード/);
  let name = find(/^銘柄(名)?$|銘柄名/);
  if (name < 0) name = find(/銘柄/);
  return {
    code: code >= 0 ? code : name,
    name,
    shares: find(/保有(株)?数|数量|株数/),
    cost: find(/取得(単価|価額)|平均取得/),
  };
}

// 証券会社の保有一覧から、銘柄・株数・取得単価・口座区分を取り出す。
// 「NISA預り」「特定預り」のような区切りの行があれば、その下の銘柄の口座区分にする。
export function extractHoldings(rows, headerRow, cols) {
  const out = [];
  let account = "taxable";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const joined = row.join(" ");
    const code = i > headerRow ? extractCode(row[cols.code]) : null;
    const shares = i > headerRow ? parseNumber(row[cols.shares]) : null;
    if (!code || shares === null || shares <= 0) {
      if (/NISA|ＮＩＳＡ/i.test(joined)) account = "nisa";
      else if (/特定|一般|課税/.test(joined)) account = "taxable";
      continue;
    }
    let name = cols.name >= 0 ? row[cols.name] : "";
    if (cols.name === cols.code || !name) name = String(row[cols.code] ?? "").replace(CODE_RE, "").replace(/^[\s　:：/／-]+/, "").trim();
    const cost = cols.cost >= 0 ? parseNumber(row[cols.cost]) : null;
    // 行の中に口座区分の列があれば、それを優先する
    const rowAccount = row.some((v) => /NISA|ＮＩＳＡ/i.test(v)) ? "nisa" : row.some((v) => /^(特定|一般|課税)/.test(v)) ? "taxable" : account;
    out.push({ code, name: name.slice(0, 60), shares, cost: cost !== null && cost > 0 ? cost : null, account: rowAccount });
  }
  return out;
}

// 配当データの貼り付け用。1行に「コード,月,1株配当」（例：7203,6,50）。
// 「#」で始まる行、見出し行、空行は無視。全角の数字・カンマも可。
// 戻り値：{ byCode: Map(code → [{month,dps}]), errors: [行番号...] }
export function parseDividendText(text) {
  const byCode = new Map();
  const errors = [];
  const norm = String(text).replace(/[０-９Ａ-Ｚ，．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/、/g, ",");
  norm.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#") || /コード|code/i.test(t)) return;
    const cells = t.split(/[,\t]/).map((c) => c.trim());
    const code = extractCode(cells[0]);
    const month = Number(String(cells[1] ?? "").replace(/月$/, ""));
    const dps = parseNumber(String(cells[2] ?? "").replace(/円$/, ""));
    if (!code || !Number.isInteger(month) || month < 1 || month > 12 || dps === null || dps < 0) { errors.push(i + 1); return; }
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ month, dps });
  });
  return { byCode, errors };
}

export function firstValue(rows, headerRow, col) {
  const cells = numericCells(rows, headerRow, col);
  return cells.length ? cells[0] : null;
}
