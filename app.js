import { load, save, clearAll, requestPersist } from "./lib/store.js";
import { emptyState, validate, uid, ASSET_TYPES, TAX_TYPES, isNisa } from "./lib/model.js";
import { summary, holdingMetrics, monthItems, breakdown, recordHistory, series, yen, signedYen, pct, signedPct } from "./lib/calc.js";
import { decode, parseCSV, parseNumber, detectHeaderRow, guessColumns, extractHoldings, parseDividendText } from "./lib/csv.js";
import { monthBars, donut, line, PALETTE, OTHER_COLOR } from "./lib/chart.js";

// ---------- 小さな道具 ----------
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "style") Object.assign(e.style, v);
    else e[k] = v;
  }
  for (const c of children) if (c != null && c !== false) e.append(c);
  return e;
};
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (k) => { if (!k) return ""; const [y, m, d] = k.split("-"); return `${y}/${Number(m)}/${Number(d)}`; };
const fmtNum = (n, digits = 4) => (n == null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: digits }));
const fmtPrice = (h, v) => (v == null ? "—" : h.assetType === "us" ? `$${fmtNum(v, 2)}` : `${fmtNum(v, 2)}円`);
const uiGet = (k, d) => { try { return localStorage.getItem(`dividend-memo:ui:${k}`) ?? d; } catch { return d; } };
const uiSet = (k, v) => { try { localStorage.setItem(`dividend-memo:ui:${k}`, v); } catch { /* 無視 */ } };

let state = load();
const ui = {
  page: uiGet("page", "dividends"),
  account: uiGet("account", "all"),
  month: new Date().getMonth(),
};
if (ui.account !== "all" && !state.accounts.some((a) => a.id === ui.account)) ui.account = "all";

function commit() {
  state.history = recordHistory(state, todayKey());
  if (!save(state)) alert("保存できませんでした。iPhoneの空き容量を確認してください。");
  render();
}

// ---------- 画面切り替え ----------
const TITLES = { assets: "資産", dividends: "配当", holdings: "銘柄", edit: "銘柄", import: "CSV読込", update: "Claudeで更新", settings: "設定" };
const TAB_OF = { edit: "holdings", import: "holdings", update: "holdings" };
function go(page) {
  ui.page = page;
  if (!TAB_OF[page]) uiSet("page", page);
  const tab = TAB_OF[page] || page;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("active", b.dataset.page === tab);
  for (const p of document.querySelectorAll(".page")) p.classList.toggle("active", p.id === page);
  $("page-title").textContent = TITLES[page];
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll(".tabbar button")) b.addEventListener("click", () => go(b.dataset.page));
for (const b of document.querySelectorAll("button.back")) b.addEventListener("click", () => go("holdings"));

// ---------- 上部（口座・税の切り替え） ----------
$("account-filter").addEventListener("change", (e) => { ui.account = e.target.value; uiSet("account", ui.account); render(); });
for (const b of document.querySelectorAll("#tax-seg button")) b.addEventListener("click", () => { state.settings.tax = b.dataset.tax; save(state); render(); });
for (const b of document.querySelectorAll("#basis-seg button")) b.addEventListener("click", () => { state.settings.basis = b.dataset.basis; save(state); render(); });
for (const b of document.querySelectorAll("#font-seg button")) b.addEventListener("click", () => { state.settings.font = b.dataset.font; save(state); render(); });

function renderTop() {
  const sel = $("account-filter");
  sel.textContent = "";
  sel.append(el("option", { value: "all", textContent: "全口座" }));
  for (const a of state.accounts) sel.append(el("option", { value: a.id, textContent: a.name }));
  sel.value = ui.account;
  sel.hidden = state.accounts.length < 2;
  for (const b of document.querySelectorAll("#tax-seg button")) b.classList.toggle("on", b.dataset.tax === state.settings.tax);
  for (const b of document.querySelectorAll("#basis-seg button")) b.classList.toggle("on", b.dataset.basis === state.settings.basis);
  for (const b of document.querySelectorAll("#font-seg button")) b.classList.toggle("on", b.dataset.font === state.settings.font);
  document.documentElement.className = `font-${state.settings.font}`;
}

function renderNotice(s) {
  const box = $("notice");
  box.textContent = "";
  const msgs = [];
  if (!state.holdings.length) {
    box.append(el("div", {}, "まだ銘柄がありません。「銘柄」から追加するか、証券会社のCSVを読み込んでください。"),
      btn("CSVを読み込む", () => go("import")), btn("1つずつ追加", () => openEdit(null)));
    box.hidden = false;
    return;
  }
  if (s.missingFx) msgs.push(["米国株の計算にドル円レートが必要です。", "設定する", () => go("settings")]);
  if (s.missingDiv || s.missingPrice) {
    const parts = [];
    if (s.missingDiv) parts.push(`配当が未入力 ${s.missingDiv}件`);
    if (s.missingPrice) parts.push(`株価が未入力 ${s.missingPrice}件`);
    msgs.push([`${parts.join("・")}。`, "Claudeで更新", () => go("update")]);
  }
  for (const [t, label, fn] of msgs) box.append(el("div", {}, t, " ", btn(label, fn)));
  box.hidden = msgs.length === 0;
}
const btn = (label, fn) => { const b = el("button", { type: "button", textContent: label }); b.addEventListener("click", fn); return b; };

// ---------- 共通：銘柄の行 ----------
const accountName = (id) => state.accounts.find((a) => a.id === id)?.name || "";
function tags(h) {
  return [
    state.accounts.length > 1 ? el("span", { className: "tag", textContent: accountName(h.accountId) }) : null,
    h.taxType !== "taxable" ? el("span", { className: `tag ${isNisa(h.taxType) ? "nisa" : ""}`, textContent: TAX_TYPES[h.taxType] }) : null,
    h.assetType !== "jp" ? el("span", { className: "tag", textContent: ASSET_TYPES[h.assetType] }) : null,
  ];
}
function holdingRow(r, tax, extra) {
  const h = r.h;
  const div = tax === "net" ? r.net : r.gross;
  const li = el("li", {},
    el("div", { className: "l1" }, el("span", { className: "code", textContent: h.code.length > 8 ? "投信" : h.code }), el("span", { className: "nm", textContent: h.name || h.code }), ...tags(h)),
    el("div", { className: "kv" },
      el("span", { className: "k", textContent: h.assetType === "fund" ? "基準価額" : "株価" }), el("span", { className: "v", textContent: fmtPrice(h, h.price) }),
      el("span", { className: "k", textContent: h.assetType === "fund" ? "口数" : "株数" }), el("span", { className: "v", textContent: fmtNum(h.shares) }),
      el("span", { className: "k", textContent: "評価額" }), el("span", { className: "v", textContent: yen(r.value) }),
      el("span", { className: "k", textContent: "配当" }), el("span", { className: "v", textContent: r.missingDiv ? "未入力" : h.noDividend && !h.payments.length ? "なし" : yen(div) }),
      ...(extra || []),
    ),
  );
  li.addEventListener("click", () => openEdit(h.id));
  return li;
}

function legendFor(items, total, colors) {
  return el("ul", { className: "legend" }, ...items.map((x, i) => el("li", {},
    el("span", { className: "dot", style: { background: colors[i] || (x.other ? OTHER_COLOR : PALETTE[i % PALETTE.length]) } }),
    el("span", { className: "name", textContent: x.label }),
    el("span", { className: "pc", textContent: `${((x.v / total) * 100).toFixed(1)}%` }),
  )));
}
function drawDonut(box, s, by, metric, centerLabel) {
  box.textContent = "";
  const { items, total } = breakdown(s, state, by, metric);
  if (!items.length) { box.append(el("div", { className: "empty-chart", style: { gridColumn: "1 / -1" } }, "データを入れると表示されます")); return; }
  const svg = donut(items, [shortYen(total), centerLabel]);
  box.append(svg, legendFor(items, total, svg.colors || []));
}
const shortYen = (v) => (v >= 1e8 ? `¥${(v / 1e8).toFixed(2)}億` : v >= 1e4 ? `¥${(v / 1e4).toFixed(1)}万` : yen(v));

function drawLine(box, points, label) {
  box.textContent = "";
  if (points.length < 2) { box.append(el("div", { className: "empty-chart" }, "記録が2日分たまると表示されます（データを変えた日に自動で記録）")); return; }
  box.append(line(points, label));
  const first = points[0].v, last = points[points.length - 1].v;
  box.append(el("p", { className: "muted small" }, `${fmtDate(points[0].date)}から ${signedYen(last - first)}`));
}

// ---------- 資産 ----------
$("a-by").addEventListener("change", () => { uiSet("aBy", $("a-by").value); render(); });
$("a-sort").addEventListener("change", () => { uiSet("aSort", $("a-sort").value); render(); });
function renderAssets(s) {
  $("a-value").textContent = yen(s.value);
  const g = $("a-gain");
  g.className = `gain ${s.gain > 0 ? "up" : s.gain < 0 ? "down" : ""}`;
  g.textContent = s.gain != null ? `評価損益 ${signedYen(s.gain)}（${signedPct(s.gainPct)}）` : "";
  const sub = [];
  if (s.cost) sub.push(`取得額 ${yen(s.cost)}`);
  if (s.missingPrice) sub.push(`株価未入力 ${s.missingPrice}件は含まず`);
  $("a-sub").textContent = sub.join(" ／ ");
  drawDonut($("a-donut"), s, $("a-by").value, "value", "評価額");
  drawLine($("a-line"), series(state, ui.account, "value"), "資産の推移");
  const key = $("a-sort").value;
  const rows = [...s.rows].sort((a, b) => key === "code" ? a.h.code.localeCompare(b.h.code)
    : key === "gain" ? (b.gain ?? -Infinity) - (a.gain ?? -Infinity)
    : key === "gainPct" ? ((b.gain ?? 0) / (b.cost || Infinity)) - ((a.gain ?? 0) / (a.cost || Infinity))
    : (b.value ?? -1) - (a.value ?? -1));
  $("a-count").textContent = `銘柄一覧（${rows.length}）`;
  const ul = $("a-list"); ul.textContent = "";
  for (const r of rows) {
    const gp = r.gain != null && r.cost ? (r.gain / r.cost) * 100 : null;
    ul.append(holdingRow(r, state.settings.tax, [
      el("span", { className: "k", textContent: "損益" }),
      el("span", { className: `v ${r.gain > 0 ? "up" : r.gain < 0 ? "down" : ""}`, textContent: r.gain != null ? `${signedYen(r.gain)}` : "—" }),
      el("span", { className: "k", textContent: "損益率" }),
      el("span", { className: `v ${gp > 0 ? "up" : gp < 0 ? "down" : ""}`, textContent: signedPct(gp) }),
    ]));
  }
}

// ---------- 配当 ----------
$("d-by").addEventListener("change", () => { uiSet("dBy", $("d-by").value); render(); });
function renderDividends(s) {
  const tax = state.settings.tax;
  $("d-label").textContent = `年間配当金額（${tax === "net" ? "税引後" : "税引前"}）`;
  $("d-total").textContent = yen(tax === "net" ? s.net : s.gross);
  $("d-yield").textContent = s.yieldOnValue != null ? `年利 ${pct(s.yieldOnValue)}` : "";
  const sub = [];
  if (s.yieldOnCost != null) sub.push(`取得利回り ${pct(s.yieldOnCost)}`);
  if (s.value) sub.push(`評価額 ${yen(s.value)}`);
  if (s.yutai) sub.push(`優待 ${yen(s.yutai)}/年`);
  $("d-sub").textContent = sub.join(" ／ ");
  const vals = s.monthly.map((m) => ({ a: tax === "net" ? m.net : m.gross, b: m.yutai }));
  $("d-avg").textContent = `月平均 ${yen(vals.reduce((a, x) => a + x.a, 0) / 12)}`;
  const box = $("d-bars"); box.textContent = "";
  box.append(monthBars(vals, { selected: ui.month, now: new Date().getMonth(), onSelect: (i) => { ui.month = i; renderDividends(s); } }));
  const items = monthItems(s, ui.month, tax);
  const total = vals[ui.month].a + vals[ui.month].b;
  $("d-month-label").textContent = `内訳（${ui.month + 1}月${state.settings.basis === "record" ? "・確定月" : ""}）：${yen(total)}`;
  const ul = $("d-month"); ul.textContent = "";
  if (!items.length) ul.append(el("li", { className: "muted" }, "この月の配当はありません"));
  for (const x of items) {
    const li = el("li", {},
      el("span", {}, `${x.r.h.name || x.r.h.code}`, el("span", { className: "sub" }, [x.r.h.code.length > 8 ? "投資信託" : x.r.h.code, state.accounts.length > 1 ? accountName(x.r.h.accountId) : "", TAX_TYPES[x.r.h.taxType]].filter(Boolean).join(" ・ "))),
      el("span", { className: "right" }, yen(x.v), x.yutai ? el("span", { className: "sub" }, `優待 ${yen(x.yutai)}`) : null),
    );
    li.addEventListener("click", () => openEdit(x.r.h.id));
    ul.append(li);
  }
  drawDonut($("d-donut"), s, $("d-by").value, tax, tax === "net" ? "税引後" : "税引前");
  drawLine($("d-line"), series(state, ui.account, "div"), "配当の推移");
}

// ---------- 銘柄一覧 ----------
$("h-sort").addEventListener("change", () => { uiSet("hSort", $("h-sort").value); render(); });
$("add-holding").addEventListener("click", () => openEdit(null));
$("go-import").addEventListener("click", () => go("import"));
$("go-update").addEventListener("click", () => go("update"));
function renderHoldings(s) {
  const key = $("h-sort").value;
  const rows = [...s.rows].sort((a, b) => key === "code" ? a.h.code.localeCompare(b.h.code)
    : key === "yield" ? (b.yieldOnValue ?? -1) - (a.yieldOnValue ?? -1)
    : key === "value" ? (b.value ?? -1) - (a.value ?? -1)
    : (b.gross ?? -1) - (a.gross ?? -1));
  $("h-count").textContent = `${rows.length} 銘柄`;
  const ul = $("h-list"); ul.textContent = "";
  if (!rows.length) ul.append(el("li", { className: "muted" }, "まだ銘柄がありません"));
  for (const r of rows) {
    ul.append(holdingRow(r, state.settings.tax, [
      el("span", { className: "k", textContent: "利回り" }), el("span", { className: "v", textContent: pct(r.yieldOnValue) }),
      el("span", { className: "k", textContent: "取得" }), el("span", { className: "v", textContent: pct(r.yieldOnCost) }),
    ]));
  }
}

// ---------- 追加・編集 ----------
let editingId = null;
const monthOptions = (sel, withBlank) => {
  if (withBlank) sel.append(el("option", { value: "", textContent: "—" }));
  for (let m = 1; m <= 12; m++) sel.append(el("option", { value: String(m), textContent: `${m}月` }));
};
monthOptions($("f-yutai-month"), false);
for (const [k, v] of Object.entries(TAX_TYPES)) $("f-tax").append(el("option", { value: k, textContent: v }));

function paymentRow(p = {}) {
  const rec = el("select", {}); monthOptions(rec, true); rec.value = p.recordMonth ? String(p.recordMonth) : "";
  rec.setAttribute("aria-label", "確定月");
  const pay = el("select", {}); monthOptions(pay, false); pay.value = String(p.payMonth || 6);
  pay.setAttribute("aria-label", "支払月");
  const dps = el("input", { type: "text", inputMode: "decimal", value: p.dps == null ? "" : String(p.dps) });
  dps.setAttribute("aria-label", "1株あたりの配当");
  const del = el("button", { type: "button", className: "mini danger", textContent: "×" });
  const li = el("li", {}, rec, pay, dps, del);
  del.addEventListener("click", () => { li.remove(); updatePreview(); });
  for (const x of [rec, pay, dps]) x.addEventListener("input", updatePreview);
  return li;
}
function updateUnitLabels() {
  const t = $("f-asset").value;
  const cur = t === "us" ? "（ドル）" : t === "fund" ? "（1万口あたり・円）" : "（円）";
  $("f-shares-label").firstChild.textContent = t === "fund" ? "口数" : "株数";
  $("f-cost-label").firstChild.textContent = `取得単価${cur}`;
  $("f-price-label").firstChild.textContent = `${t === "fund" ? "基準価額" : "現在値"}${cur}`;
  $("f-dps-head").textContent = t === "fund" ? "分配金/1万口" : t === "us" ? "1株配当($)" : "1株配当(円)";
  $("f-unit-note").textContent = t === "us" ? "米国株は配当・株価をドルで入力。円への換算は「設定」のドル円レートを使います。" : t === "fund" ? "投資信託は、基準価額と分配金を1万口あたりで入力します。" : "";
}
$("f-asset").addEventListener("change", () => { updateUnitLabels(); updatePreview(); });
function readForm() {
  const payments = [];
  let bad = false;
  for (const li of $("f-payments").children) {
    const [rec, pay, dpsEl] = li.querySelectorAll("select, input");
    if (!dpsEl.value.trim()) continue;
    const dps = parseNumber(dpsEl.value);
    if (dps === null || dps < 0) { bad = true; continue; }
    payments.push({ recordMonth: rec.value ? Number(rec.value) : null, payMonth: Number(pay.value), dps });
  }
  const opt = (id) => ($(id).value.trim() ? parseNumber($(id).value) : null);
  const optBad = (id) => $(id).value.trim() !== "" && parseNumber($(id).value) === null;
  return {
    assetType: $("f-asset").value,
    code: $("f-code").value.trim().toUpperCase().slice(0, 16),
    name: $("f-name").value.trim().slice(0, 60),
    accountId: $("f-account").value,
    taxType: $("f-tax").value,
    shares: parseNumber($("f-shares").value),
    cost: opt("f-cost"), price: opt("f-price"),
    sector: $("f-sector").value.trim().slice(0, 30),
    yutai: opt("f-yutai"),
    yutaiMonth: $("f-yutai-month").value ? Number($("f-yutai-month").value) : null,
    memo: $("f-memo").value.trim().slice(0, 300),
    noDividend: $("f-nodiv").checked,
    payments,
    bad: bad || optBad("f-cost") || optBad("f-price") || optBad("f-yutai"),
  };
}
function updatePreview() {
  const f = readForm();
  if (f.shares == null) { $("f-preview").textContent = ""; return; }
  const m = holdingMetrics({ ...f, priceDate: null }, state.fx, "pay");
  const parts = [];
  if (m.gross != null && f.payments.length) parts.push(`年間配当 ${yen(m.gross)}（税引後 ${yen(m.net)}）`);
  if (m.value != null) parts.push(`評価額 ${yen(m.value)}`);
  if (m.yieldOnValue != null) parts.push(`利回り ${pct(m.yieldOnValue)}`);
  if (m.missingFx) parts.push("ドル円レート未設定");
  $("f-preview").textContent = parts.join(" ／ ");
}
for (const id of ["f-shares", "f-cost", "f-price", "f-tax", "f-yutai"]) $(id).addEventListener("input", updatePreview);
$("f-add-payment").addEventListener("click", () => {
  const ul = $("f-payments");
  const last = ul.lastElementChild;
  const lastPay = last ? Number(last.querySelectorAll("select")[1].value) : 0;
  ul.append(paymentRow({ payMonth: lastPay ? ((lastPay + (($("f-asset").value === "us") ? 2 : 5)) % 12) + 1 : 6 }));
});

function openEdit(id) {
  editingId = id;
  const h = state.holdings.find((x) => x.id === id) || {
    assetType: "jp", code: "", name: "", accountId: ui.account !== "all" ? ui.account : state.accounts[0].id,
    taxType: "taxable", shares: null, cost: null, price: null, sector: "", yutai: null, yutaiMonth: null, memo: "", noDividend: false, payments: [],
  };
  const acc = $("f-account"); acc.textContent = "";
  for (const a of state.accounts) acc.append(el("option", { value: a.id, textContent: a.name }));
  $("f-asset").value = h.assetType;
  $("f-code").value = h.code;
  $("f-name").value = h.name;
  acc.value = h.accountId;
  $("f-tax").value = h.taxType;
  const sv = (id, v) => { $(id).value = v == null ? "" : String(v); };
  sv("f-shares", h.shares); sv("f-cost", h.cost); sv("f-price", h.price); sv("f-yutai", h.yutai);
  $("f-sector").value = h.sector;
  $("f-yutai-month").value = h.yutaiMonth ? String(h.yutaiMonth) : "";
  if (!h.yutaiMonth) $("f-yutai-month").selectedIndex = -1;
  $("f-memo").value = h.memo || "";
  $("f-nodiv").checked = !!h.noDividend;
  const ul = $("f-payments"); ul.textContent = "";
  for (const p of h.payments) ul.append(paymentRow(p));
  if (!h.payments.length) ul.append(paymentRow({}));
  $("f-delete").hidden = !id;
  $("f-msg").textContent = "";
  TITLES.edit = id ? "銘柄の編集" : "銘柄の追加";
  updateUnitLabels();
  updatePreview();
  go("edit");
}
$("f-cancel").addEventListener("click", () => go("holdings"));
$("f-delete").addEventListener("click", () => {
  const h = state.holdings.find((x) => x.id === editingId);
  if (!h || !confirm(`「${h.name || h.code}」を削除しますか？`)) return;
  state.holdings = state.holdings.filter((x) => x.id !== editingId);
  commit();
  go("holdings");
});
$("edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = readForm();
  const msg = $("f-msg"); msg.className = "msg error";
  if (!f.code) { msg.textContent = "コードを入れてください"; return; }
  if (f.shares === null || f.shares <= 0) { msg.textContent = "株数（口数）を数字で入れてください"; return; }
  if (f.bad) { msg.textContent = "数字の欄に、数字でない値があります"; return; }
  const dup = state.holdings.find((x) => x.code === f.code && x.accountId === f.accountId && x.taxType === f.taxType && x.id !== editingId);
  if (dup) { msg.textContent = `同じ口座・口座区分に ${f.code} がすでにあります`; return; }
  const { bad, ...data } = f;
  const prev = state.holdings.find((x) => x.id === editingId);
  data.priceDate = data.price != null ? (prev && prev.price === data.price ? prev.priceDate : todayKey()) : null;
  if (prev) Object.assign(prev, data);
  else state.holdings.push({ id: uid(), ...data });
  commit();
  go("holdings");
});

// ---------- CSV 読み込み ----------
let csv = null; // { rows, header, found }
const COLS = [["c-code", "code"], ["c-name", "name", true], ["c-shares", "shares"], ["c-cost", "cost", true], ["c-price", "price", true]];
$("csv-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 同じファイルを選び直せるように。中身はメモリ上だけで扱い、保存しない。
  const msg = $("csv-msg"); msg.className = "msg"; msg.textContent = "";
  $("csv-step2").hidden = true;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { msg.className = "msg error"; msg.textContent = "ファイルが大きすぎます（5MBまで）"; return; }
  const rows = parseCSV(decode(await file.arrayBuffer()));
  if (rows.length < 2) { msg.className = "msg error"; msg.textContent = "CSVとして読めませんでした"; return; }
  const header = detectHeaderRow(rows);
  const width = Math.max(...rows.map((r) => r.length));
  const guess = guessColumns(rows[header]);
  for (const [id, key, optional] of COLS) {
    const sel = $(id); sel.textContent = "";
    if (optional) sel.append(el("option", { value: "-1", textContent: "（使わない）" }));
    for (let c = 0; c < width; c++) sel.append(el("option", { value: String(c), textContent: rows[header][c] || `${c + 1}列目` }));
    sel.value = String(guess[key] >= 0 ? guess[key] : optional ? -1 : 0);
  }
  csv = { rows, header, found: [] };
  $("csv-step2").hidden = false;
  readCsv();
});
for (const [id] of COLS) $(id).addEventListener("change", readCsv);
function readCsv() {
  if (!csv) return;
  const cols = Object.fromEntries(COLS.map(([id, key]) => [key, Number($(id).value)]));
  csv.found = extractHoldings(csv.rows, csv.header, cols).map((f) => ({ ...f, checked: true }));
  renderCsvList();
}
function renderCsvList() {
  const ul = $("c-list"); ul.textContent = "";
  for (const f of csv.found) {
    const cb = el("input", { type: "checkbox", checked: f.checked });
    cb.addEventListener("change", () => { f.checked = cb.checked; renderCsvCount(); });
    const price = f.price != null ? ` ／ ${f.assetType === "us" ? "$" : ""}${fmtNum(f.price, 2)}${f.assetType === "us" ? "" : "円"}` : "";
    ul.append(el("li", {}, cb,
      el("span", {}, `${f.assetType === "fund" ? "" : `${f.code} `}${f.name || ""}`, el("span", { className: "sub" }, `${ASSET_TYPES[f.assetType]} ・ ${TAX_TYPES[f.taxType]}${price}`)),
      el("span", { className: "right" }, `${fmtNum(f.shares)}${f.assetType === "fund" ? "口" : "株"}`),
    ));
  }
  renderCsvCount();
}
function renderCsvCount() {
  const n = csv.found.filter((f) => f.checked).length;
  $("c-count").textContent = `${n} / ${csv.found.length} 件選択中`;
  $("c-toggle").textContent = n ? "すべて解除" : "すべて選択";
  $("csv-apply").disabled = n === 0;
  const msg = $("csv-msg");
  msg.className = csv.found.length ? "msg" : "msg error";
  msg.textContent = csv.found.length ? "" : "銘柄を読み取れませんでした。「読み取る列を変える」で列を選び直してください。";
}
$("c-toggle").addEventListener("click", () => {
  const any = csv.found.some((f) => f.checked);
  for (const f of csv.found) f.checked = !any;
  renderCsvList();
});
$("csv-apply").addEventListener("click", () => {
  if (!csv) return;
  const accountId = $("c-account").value;
  const today = todayKey();
  // 同じ口座区分・同じ銘柄の複数行（買付日ごと等）はまとめる
  const merged = new Map();
  for (const f of csv.found.filter((x) => x.checked)) {
    const k = `${f.code}|${f.taxType}`;
    const m = merged.get(k);
    if (!m) { merged.set(k, { ...f }); continue; }
    const total = m.shares + f.shares;
    if (m.cost != null && f.cost != null) m.cost = (m.cost * m.shares + f.cost * f.shares) / total;
    m.shares = total;
    m.price = f.price ?? m.price;
  }
  let added = 0, updated = 0;
  for (const f of merged.values()) {
    const h = state.holdings.find((x) => x.accountId === accountId && x.code === f.code && x.taxType === f.taxType);
    if (h) {
      h.shares = f.shares;
      if (f.cost != null) h.cost = f.cost;
      if (f.price != null) { h.price = f.price; h.priceDate = today; }
      if (!h.name && f.name) h.name = f.name;
      updated++;
    } else {
      state.holdings.push({
        id: uid(), accountId, taxType: f.taxType, assetType: f.assetType, code: f.code, name: f.name,
        shares: f.shares, cost: f.cost, price: f.price, priceDate: f.price != null ? today : null,
        sector: "", yutai: null, yutaiMonth: null, memo: "", noDividend: false, payments: [],
      });
      added++;
    }
  }
  let removed = 0;
  if ($("c-remove").checked) {
    const before = state.holdings.length;
    state.holdings = state.holdings.filter((h) => h.accountId !== accountId || merged.has(`${h.code}|${h.taxType}`));
    removed = before - state.holdings.length;
  }
  commit();
  csv = null;
  $("csv-step2").hidden = true;
  $("csv-msg").className = "msg";
  $("csv-msg").textContent = `追加 ${added}件・更新 ${updated}件${removed ? `・削除 ${removed}件` : ""}。配当は「Claudeで更新」でまとめて入れられます。`;
});

// ---------- Claude で更新 ----------
// 送るのは銘柄コード・名前・種類だけ（株数・金額・口座は含めない）
$("copy-codes").addEventListener("click", async () => {
  const msg = $("div-msg");
  const seen = new Map();
  for (const h of state.holdings) if (!seen.has(h.code)) seen.set(h.code, `${h.code} ${h.name}（${ASSET_TYPES[h.assetType]}）`.replace(/\s+（/, "（"));
  if (!seen.size) { msg.className = "msg error"; msg.textContent = "先に銘柄を登録してください"; return; }
  const text = [
    "配当メモの更新をお願いします。次の銘柄を公開情報で調べて、下の形式の行だけで返してください。",
    "形式：コード,確定月,支払月,1株配当,株価,業種",
    "・配当は今期の会社予想（なければ直近の実績）。年に複数回なら回数分の行に分け、株価と業種は1行目だけでよい",
    "・米国株はドル、投資信託は1万口あたりの円（分配金・基準価額）",
    "・配当・分配金がない銘柄は「コード,,,0,株価,業種」の1行",
    "・1行目に USDJPY,現在のドル円",
    "・調べた情報源を最後に「#」で始まる行で書く",
    "銘柄：",
    ...seen.values(),
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    msg.className = "msg"; msg.textContent = `${seen.size} 銘柄の依頼文をコピーしました。Claude に貼り付けて送ってください。`;
  } catch {
    $("div-text").value = text;
    $("div-text").select();
    msg.className = "msg"; msg.textContent = "下の欄に表示しました。全部選んでコピーしてください。";
  }
});
$("div-apply").addEventListener("click", () => {
  const msg = $("div-msg"); msg.className = "msg error";
  const { byCode, errors, usdjpy } = parseDividendText($("div-text").value);
  if (!byCode.size && !usdjpy) { msg.textContent = errors.length ? `読めない行があります（${errors.slice(0, 5).join("・")}行目）` : "貼り付けてください"; return; }
  const today = todayKey();
  if (usdjpy) state.fx = { usdjpy, date: today };
  let updated = 0;
  const notFound = [];
  for (const [code, info] of byCode) {
    const targets = state.holdings.filter((h) => h.code.toUpperCase() === code);
    if (!targets.length) { notFound.push(code); continue; }
    for (const h of targets) {
      if (info.payments.length) { h.payments = info.payments.map((p) => ({ ...p })); h.noDividend = false; }
      else if (info.noDividend) { h.payments = []; h.noDividend = true; }
      if (info.price != null) { h.price = info.price; h.priceDate = today; }
      if (info.sector) h.sector = info.sector;
    }
    updated++;
  }
  commit();
  msg.className = "msg";
  msg.textContent = [
    `${updated} 銘柄を更新しました。`,
    usdjpy ? `ドル円 ${usdjpy}。` : "",
    notFound.length ? `登録していない銘柄：${notFound.join("・")}。` : "",
    errors.length ? `読めなかった行：${errors.slice(0, 5).join("・")}行目。` : "",
  ].join("");
  if (updated) $("div-text").value = "";
});

// ---------- 設定 ----------
$("s-account-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("s-account-name").value.trim().slice(0, 20);
  if (!name) return;
  if (state.accounts.length >= 10) { alert("口座は10個までです"); return; }
  state.accounts.push({ id: uid(), name });
  $("s-account-name").value = "";
  commit();
});
function renderSettings() {
  const ul = $("s-accounts"); ul.textContent = "";
  for (const a of state.accounts) {
    const n = state.holdings.filter((h) => h.accountId === a.id).length;
    const ren = el("button", { type: "button", className: "mini", textContent: "名前変更" });
    ren.addEventListener("click", () => {
      const v = prompt("新しい名前", a.name);
      if (v && v.trim()) { a.name = v.trim().slice(0, 20); commit(); }
    });
    const del = el("button", { type: "button", className: "mini danger", textContent: "削除" });
    del.addEventListener("click", () => {
      if (state.accounts.length === 1) { alert("口座は1つ以上必要です"); return; }
      if (n) { alert(`この口座には ${n} 銘柄あります。先に銘柄を削除するか、別の口座に移してください。`); return; }
      if (!confirm(`「${a.name}」を削除しますか？`)) return;
      state.accounts = state.accounts.filter((x) => x.id !== a.id);
      if (ui.account === a.id) { ui.account = "all"; uiSet("account", "all"); }
      commit();
    });
    ul.append(el("li", {}, el("span", {}, a.name, el("span", { className: "sub" }, `${n} 銘柄`)), el("span", { className: "right" }, ren, " ", del)));
  }
  $("s-fx").value = state.fx.usdjpy ?? "";
  $("s-fx-date").textContent = state.fx.date ? `${fmtDate(state.fx.date)} に設定` : "未設定";
  const ca = $("c-account"); const keep = ca.value; ca.textContent = "";
  for (const a of state.accounts) ca.append(el("option", { value: a.id, textContent: a.name }));
  ca.value = state.accounts.some((a) => a.id === keep) ? keep : (ui.account !== "all" ? ui.account : state.accounts[0].id);
  let last = null;
  try { last = localStorage.getItem("dividend-memo:lastExport"); } catch { /* 無視 */ }
  $("last-export").textContent = last ? `最後に書き出した日：${fmtDate(last)}` : "まだ書き出していません";
}
$("s-fx-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = parseNumber($("s-fx").value);
  if (v === null || v <= 0) { alert("ドル円レートを数字で入れてください（例：155.3）"); return; }
  state.fx = { usdjpy: v, date: todayKey() };
  commit();
});
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `dividend-memo-backup-${todayKey()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  try { localStorage.setItem("dividend-memo:lastExport", todayKey()); } catch { /* 無視 */ }
  renderSettings();
});
$("restore").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  const msg = $("backup-msg");
  if (!file) return;
  try {
    const next = validate(JSON.parse(await file.text()));
    if (!confirm(`${next.holdings.length} 銘柄のバックアップで、今のデータを置き換えますか？`)) return;
    state = next;
    ui.account = "all";
    save(state);
    render();
    msg.className = "msg"; msg.textContent = "バックアップから戻しました";
  } catch (err) {
    msg.className = "msg error"; msg.textContent = err.message || "読み込めませんでした";
  }
});
$("wipe").addEventListener("click", () => {
  if (!confirm("すべての銘柄・口座・履歴を削除します。元に戻せません。先にバックアップを書き出しましたか？")) return;
  if (!confirm("本当に削除しますか？")) return;
  clearAll();
  state = emptyState();
  ui.account = "all";
  render();
});

// ---------- 起動 ----------
$("a-by").value = uiGet("aBy", "holding");
$("a-sort").value = uiGet("aSort", "value");
$("d-by").value = uiGet("dBy", "holding");
$("h-sort").value = uiGet("hSort", "div");

function render() {
  renderTop();
  const s = summary(state, { accountId: ui.account, basis: state.settings.basis });
  renderNotice(s);
  renderAssets(s);
  renderDividends(s);
  renderHoldings(s);
  renderSettings();
}
render();
go(["assets", "dividends", "holdings", "settings"].includes(ui.page) ? ui.page : "dividends");

requestPersist().then((ok) => {
  $("persist-status").textContent = ok ? "このiPhoneに、データを消さずに保管するよう設定されています。" : "";
});
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* オフライン対応なしでも動く */ });
}
