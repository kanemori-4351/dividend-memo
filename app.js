import { load, save, clearAll, requestPersist, validate, uid, emptyState } from "./lib/store.js";
import { summary, upcoming, annualGross, annualDps, yieldOnCost, yen, pct, ACCOUNTS, TAX_RATE } from "./lib/calc.js";
import { decode, parseCSV, parseNumber, detectHeaderRow, guessColumns, extractHoldings, parseDividendText } from "./lib/csv.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) if (c != null) e.append(c);
  return e;
};
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (k) => { const [y, m, d] = k.split("-"); return `${y}/${Number(m)}/${Number(d)}`; };
const fmtNum = (n) => (n == null ? "" : n.toLocaleString("ja-JP", { maximumFractionDigits: 4 }));
const tag = (account) => el("span", { className: `tag ${account}`, textContent: ACCOUNTS[account] });

let state = load();
const commit = () => {
  if (!save(state)) alert("保存できませんでした。iPhoneの空き容量を確認してください。");
  render();
};

// ---------- 画面切り替え ----------
const TITLES = { home: "ホーム", holdings: "銘柄", edit: "銘柄の編集", import: "CSVから読み込み", settings: "設定" };
function go(page) {
  const tab = page === "edit" ? "holdings" : page;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("active", b.dataset.page === tab);
  for (const p of document.querySelectorAll(".page")) p.classList.toggle("active", p.id === page);
  $("page-title").textContent = TITLES[page];
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll(".tabbar button")) b.addEventListener("click", () => go(b.dataset.page));

// ---------- ホーム ----------
function renderHome() {
  const empty = state.holdings.length === 0;
  $("empty-home").hidden = !empty;
  $("home-body").hidden = empty;
  if (empty) return;

  const s = summary(state);
  $("annual-net").textContent = yen(s.net);
  $("annual-gross").textContent = yen(s.gross);
  $("monthly-avg").textContent = yen(s.monthlyAvgNet);
  $("yoc").textContent = s.yieldOnCost != null ? `取得額に対する利回り（税引前・取得単価を入れた銘柄）：${pct(s.yieldOnCost)}` : "";
  $("missing").hidden = s.missing === 0;
  $("missing").textContent = `配当が未入力の銘柄が ${s.missing} 件あります（「銘柄」から入力）`;

  drawMonthChart(s.monthly, $("show-net").checked);

  const up = $("upcoming"); up.textContent = "";
  const list = upcoming(state, new Date(), 3);
  if (!list.length) up.append(el("li", { className: "muted" }, "配当を入力すると、ここに出ます"));
  for (const u of list) {
    const uniq = [...new Set(u.items.map((x) => x.h.name || x.h.code))]; // NISAと課税口座の同じ銘柄は1つに
    const names = uniq.slice(0, 3).join("、") + (uniq.length > 3 ? ` ほか${uniq.length - 3}件` : "");
    up.append(el("li", {},
      el("span", {}, `${u.month}月`, el("span", { className: "sub" }, names)),
      el("span", { className: "right" }, yen(u.net), el("span", { className: "sub" }, `税引前 ${yen(u.gross)}`)),
    ));
  }

  const sl = $("share-list"); sl.textContent = "";
  // 同じ銘柄（NISAと課税口座の両方で持っている等）はまとめる
  const byCode = new Map();
  for (const r of s.rows) {
    if (r.gross <= 0) continue;
    const cur = byCode.get(r.holding.code) || { label: r.holding.name || r.holding.code, v: 0 };
    cur.v += r.gross;
    byCode.set(r.holding.code, cur);
  }
  const top = [...byCode.values()].sort((a, b) => b.v - a.v);
  const shown = top.slice(0, 8);
  const rest = top.slice(8).reduce((a, r) => a + r.v, 0);
  const items = [...shown];
  if (rest > 0) items.push({ label: `その他 ${top.length - 8}銘柄`, v: rest });
  for (const it of items) {
    const p = s.gross > 0 ? (it.v / s.gross) * 100 : 0;
    const fill = el("div", { className: "fill" }); fill.style.width = `${p}%`;
    sl.append(el("li", {},
      el("div", { className: "row-between" }, el("span", {}, it.label), el("span", {}, `${yen(it.v)}（${p.toFixed(1)}%）`)),
      el("div", { className: "track" }, fill),
    ));
  }
}
$("show-net").addEventListener("change", renderHome);

function drawMonthChart(monthly, net) {
  const box = $("month-chart"); box.textContent = "";
  const NS = "http://www.w3.org/2000/svg";
  const W = 340, H = 180, L = 4, R = 4, T = 16, B = 20;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "月ごとの配当の棒グラフ");
  const mk = (t, attrs, text) => {
    const n = document.createElementNS(NS, t);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n); return n;
  };
  const vals = monthly.map((m) => (net ? m.net : m.gross));
  const max = Math.max(...vals, 1);
  const slot = (W - L - R) / 12, bw = slot * 0.62;
  const now = new Date().getMonth();
  mk("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, class: "grid" });
  vals.forEach((v, i) => {
    const h = (v / max) * (H - T - B);
    const x = L + i * slot + (slot - bw) / 2;
    if (v > 0) {
      mk("rect", { x, y: H - B - h, width: bw, height: Math.max(h, 1), rx: 2, class: i === now ? "bar now" : "bar" });
      const short = v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万` : Math.round(v).toLocaleString("ja-JP");
      mk("text", { x: x + bw / 2, y: H - B - h - 3, "text-anchor": "middle", class: "val" }, short);
    }
    mk("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "axis" }, `${i + 1}`);
  });
  box.append(svg);
  box.append(el("p", { className: "muted small" }, "数字は月（1〜12月）。緑は今月。"));
}

// ---------- 銘柄一覧 ----------
function renderHoldings() {
  const ul = $("holding-list"); ul.textContent = "";
  if (!state.holdings.length) { ul.append(el("li", { className: "muted" }, "まだ銘柄がありません")); return; }
  const rows = [...state.holdings].sort((a, b) => annualGross(b) - annualGross(a));
  for (const h of rows) {
    const g = annualGross(h);
    const y = yieldOnCost(h);
    const li = el("li", {},
      el("span", {}, `${h.name || "（名前なし）"}`, tag(h.account),
        el("span", { className: "sub" }, `${h.code} ／ ${fmtNum(h.shares)}株${h.payments.length ? ` ／ 1株 ${fmtNum(annualDps(h))}円` : ""}`)),
      el("span", { className: "right" }, h.payments.length ? yen(g) : "配当未入力",
        el("span", { className: "sub" }, y != null ? `利回り ${pct(y)}` : "")),
    );
    li.addEventListener("click", () => openEdit(h.id));
    ul.append(li);
  }
}
$("add-holding").addEventListener("click", () => openEdit(null));

// ---------- 追加・編集 ----------
let editingId = null;
function paymentRow(p = { month: 6, dps: null }) {
  const sel = el("select", { "aria-label": "支払い月" });
  for (let m = 1; m <= 12; m++) sel.append(el("option", { value: String(m), textContent: `${m}月` }));
  sel.value = String(p.month);
  const inp = el("input", { type: "text", inputMode: "decimal", placeholder: "1株あたり 円", value: p.dps == null ? "" : String(p.dps) });
  inp.setAttribute("aria-label", "1株あたりの配当（円）");
  const del = el("button", { type: "button", className: "mini danger", textContent: "×" });
  const li = el("li", {}, sel, inp, del);
  del.addEventListener("click", () => { li.remove(); updatePreview(); });
  sel.addEventListener("change", updatePreview);
  inp.addEventListener("input", updatePreview);
  return li;
}
function readForm() {
  const payments = [];
  let bad = false;
  for (const li of $("f-payments").children) {
    const [sel, inp] = li.querySelectorAll("select, input");
    if (!inp.value.trim()) continue;
    const dps = parseNumber(inp.value);
    if (dps === null || dps < 0) { bad = true; continue; }
    payments.push({ month: Number(sel.value), dps });
  }
  return {
    code: $("f-code").value.trim().toUpperCase(),
    name: $("f-name").value.trim(),
    shares: parseNumber($("f-shares").value),
    cost: $("f-cost").value.trim() ? parseNumber($("f-cost").value) : null,
    account: $("f-account").value,
    payments, bad,
  };
}
function updatePreview() {
  const f = readForm();
  if (f.shares == null || !f.payments.length) { $("f-preview").textContent = ""; return; }
  const g = annualGross(f);
  const n = f.account === "nisa" ? g : g * (1 - TAX_RATE);
  const y = yieldOnCost(f);
  $("f-preview").textContent = `年間 ${yen(g)}（税引後 ${yen(n)}）${y != null ? ` ／ 取得利回り ${pct(y)}` : ""}`;
}
for (const id of ["f-shares", "f-cost", "f-account"]) $(id).addEventListener("input", updatePreview);
$("f-add-payment").addEventListener("click", () => {
  const ul = $("f-payments");
  const lastMonth = ul.lastElementChild ? Number(ul.lastElementChild.querySelector("select").value) : 0;
  ul.append(paymentRow({ month: lastMonth ? ((lastMonth + 5) % 12) + 1 : 6, dps: null }));
});

function openEdit(id) {
  editingId = id;
  const h = state.holdings.find((x) => x.id === id) || { code: "", name: "", shares: null, cost: null, account: "taxable", payments: [] };
  $("f-code").value = h.code;
  $("f-name").value = h.name;
  $("f-shares").value = h.shares == null ? "" : String(h.shares);
  $("f-cost").value = h.cost == null ? "" : String(h.cost);
  $("f-account").value = h.account;
  const ul = $("f-payments"); ul.textContent = "";
  for (const p of h.payments) ul.append(paymentRow(p));
  if (!h.payments.length) ul.append(paymentRow({ month: 6, dps: null }));
  $("f-delete").hidden = !id;
  $("f-msg").textContent = "";
  updatePreview();
  TITLES.edit = id ? "銘柄の編集" : "銘柄の追加";
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
  if (!f.code) { msg.textContent = "銘柄コードを入れてください"; return; }
  if (f.shares === null || f.shares <= 0) { msg.textContent = "株数を数字で入れてください"; return; }
  if (f.cost !== null && (Number.isNaN(f.cost) || f.cost < 0)) { msg.textContent = "取得単価を数字で入れてください"; return; }
  if ($("f-cost").value.trim() && f.cost === null) { msg.textContent = "取得単価を数字で入れてください"; return; }
  if (f.bad) { msg.textContent = "1株あたりの配当を数字で入れてください"; return; }
  const dup = state.holdings.find((x) => x.code === f.code && x.account === f.account && x.id !== editingId);
  if (dup) { msg.textContent = `同じ口座に ${f.code} がすでにあります`; return; }
  const data = { code: f.code.slice(0, 12), name: f.name.slice(0, 60), shares: f.shares, cost: f.cost, account: f.account, payments: f.payments };
  if (editingId) Object.assign(state.holdings.find((x) => x.id === editingId), data);
  else state.holdings.push({ id: uid(), ...data });
  commit();
  go("holdings");
});

// ---------- CSV 読み込み ----------
let csv = null; // { rows, header, width }
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
  csv = { rows, header, width };
  const guess = guessColumns(rows[header]);
  for (const [id, key, optional] of [["c-code", "code"], ["c-name", "name", true], ["c-shares", "shares"], ["c-cost", "cost", true]]) {
    const sel = $(id); sel.textContent = "";
    if (optional) sel.append(el("option", { value: "-1", textContent: "（使わない）" }));
    for (let c = 0; c < width; c++) sel.append(el("option", { value: String(c), textContent: rows[header][c] || `${c + 1}列目` }));
    sel.value = String(guess[key] >= 0 ? guess[key] : optional ? -1 : 0);
  }
  $("csv-step2").hidden = false;
  updateCsvPreview();
});
for (const id of ["c-code", "c-name", "c-shares", "c-cost"]) $(id).addEventListener("change", updateCsvPreview);

const csvCols = () => ({ code: Number($("c-code").value), name: Number($("c-name").value), shares: Number($("c-shares").value), cost: Number($("c-cost").value) });
function updateCsvPreview() {
  if (!csv) return;
  const found = extractHoldings(csv.rows, csv.header, csvCols());
  const t = $("csv-preview"); t.textContent = "";
  t.append(el("tr", {}, ...["コード", "銘柄名", "株数", "取得単価", "口座"].map((h) => el("th", { textContent: h }))));
  for (const f of found.slice(0, 50)) {
    t.append(el("tr", {}, ...[f.code, f.name, fmtNum(f.shares), fmtNum(f.cost), ACCOUNTS[f.account]].map((v) => el("td", { textContent: v ?? "" }))));
  }
  const msg = $("csv-msg");
  msg.className = found.length ? "msg" : "msg error";
  msg.textContent = found.length ? `${found.length} 銘柄を読み取りました。内容を確認して「登録する」を押してください。` : "銘柄を読み取れませんでした。使う列を選び直してください。";
  $("csv-apply").disabled = !found.length;
}
$("csv-apply").addEventListener("click", () => {
  if (!csv) return;
  const found = extractHoldings(csv.rows, csv.header, csvCols());
  let added = 0, updated = 0;
  const seen = new Set();
  for (const f of found) {
    const k = `${f.code}|${f.account}`;
    if (seen.has(k)) { // 同じ口座に同じ銘柄が複数行（買付日ごと等）→株数を足す
      const h = state.holdings.find((x) => x.code === f.code && x.account === f.account);
      if (h) h.shares += f.shares;
      continue;
    }
    seen.add(k);
    const h = state.holdings.find((x) => x.code === f.code && x.account === f.account);
    if (h) { h.shares = f.shares; if (f.cost != null) h.cost = f.cost; if (!h.name && f.name) h.name = f.name; updated++; }
    else { state.holdings.push({ id: uid(), code: f.code, name: f.name, shares: f.shares, cost: f.cost, account: f.account, payments: [] }); added++; }
  }
  let removed = 0;
  if ($("c-remove").checked) {
    const before = state.holdings.length;
    state.holdings = state.holdings.filter((h) => seen.has(`${h.code}|${h.account}`));
    removed = before - state.holdings.length;
  }
  commit();
  csv = null;
  $("csv-step2").hidden = true;
  $("csv-msg").className = "msg";
  $("csv-msg").textContent = `追加 ${added} 件・更新 ${updated} 件${removed ? `・削除 ${removed} 件` : ""}。新しい銘柄は「銘柄」で配当を入力してください。`;
});

// ---------- 配当の貼り付け ----------
// 送るのは銘柄コードと名前だけ（株数・取得単価・口座は含めない）
$("copy-codes").addEventListener("click", async () => {
  const msg = $("div-msg");
  const seen = new Set();
  const lines = [];
  for (const h of state.holdings) {
    if (seen.has(h.code)) continue;
    seen.add(h.code);
    lines.push(`${h.code} ${h.name}`.trim());
  }
  if (!lines.length) { msg.className = "msg error"; msg.textContent = "先に銘柄を登録してください"; return; }
  const text = `次の銘柄の、1株あたり配当（予想）と支払い月を調べて、「コード,月,1株配当」の形で返してください。\n${lines.join("\n")}`;
  try {
    await navigator.clipboard.writeText(text);
    msg.className = "msg"; msg.textContent = `${lines.length} 銘柄のコードをコピーしました。Claude に貼り付けて送ってください。`;
  } catch {
    $("div-text").value = text;
    $("div-text").select();
    msg.className = "msg"; msg.textContent = "下の欄に表示しました。全部選んでコピーしてください。";
  }
});
$("div-apply").addEventListener("click", () => {
  const msg = $("div-msg"); msg.className = "msg error";
  const { byCode, errors } = parseDividendText($("div-text").value);
  if (!byCode.size) { msg.textContent = errors.length ? `読めない行があります（${errors.slice(0, 5).join("・")}行目）` : "貼り付けてください"; return; }
  let updated = 0;
  const notFound = [];
  for (const [code, payments] of byCode) {
    const targets = state.holdings.filter((h) => h.code === code);
    if (!targets.length) { notFound.push(code); continue; }
    for (const h of targets) h.payments = payments.map((p) => ({ ...p }));
    updated++;
  }
  commit();
  msg.className = "msg";
  msg.textContent = `${updated} 銘柄の配当を反映しました。`
    + (notFound.length ? `登録していない銘柄：${notFound.join("・")}。` : "")
    + (errors.length ? `読めなかった行：${errors.slice(0, 5).join("・")}行目。` : "");
  if (updated) $("div-text").value = "";
});

// ---------- 設定・バックアップ ----------
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
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
    commit();
    msg.className = "msg"; msg.textContent = "バックアップから戻しました";
  } catch (err) {
    msg.className = "msg error"; msg.textContent = err.message || "読み込めませんでした";
  }
});
$("wipe").addEventListener("click", () => {
  if (!confirm("すべての銘柄を削除します。元に戻せません。先にバックアップを書き出しましたか？")) return;
  if (!confirm("本当に削除しますか？")) return;
  clearAll();
  state = emptyState();
  render();
});
function renderSettings() {
  let last = null;
  try { last = localStorage.getItem("dividend-memo:lastExport"); } catch { /* 無視 */ }
  $("last-export").textContent = last ? `最後に書き出した日：${fmtDate(last)}` : "まだ書き出していません";
}

// ---------- 起動 ----------
function render() {
  renderHome();
  renderHoldings();
  renderSettings();
}
render();

requestPersist().then((ok) => {
  $("persist-status").textContent = ok ? "このiPhoneに、データを消さずに保管するよう設定されています。" : "";
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* オフライン対応なしでも動く */ });
}
