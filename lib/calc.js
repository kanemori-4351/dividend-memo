// 集計（画面に依存しない計算だけ。テストできるように分けてある）
import { ASSET_TYPES, TAX_TYPES, isNisa } from "./model.js";

export const JP_TAX = 0.20315; // 日本の配当課税（所得税15.315%＋住民税5%）
export const US_TAX = 0.10;    // 米国株の配当に米国でかかる税

// 投資信託は「1万口あたり」で値段と分配金が決まる
export const units = (h) => (h.assetType === "fund" ? h.shares / 10000 : h.shares);
// 円に直す倍率。米国株はドル円が必要（なければ null）
export const toYen = (h, fx) => (h.assetType === "us" ? (fx?.usdjpy > 0 ? fx.usdjpy : null) : 1);

// 税引後の割合
export function netFactor(h) {
  let f = 1;
  if (h.assetType === "us") f *= 1 - US_TAX;            // 米国の税は NISA でもかかる
  if (h.taxType === "taxable") f *= 1 - JP_TAX;          // 日本の税は特定・一般口座だけ
  return f;
}

export function holdingMetrics(h, fx, basis = "pay") {
  const r = toYen(h, fx);
  const u = units(h);
  const monthly = Array.from({ length: 12 }, () => ({ gross: 0, net: 0, yutai: 0 }));
  let dpsYear = 0;
  for (const p of h.payments) {
    const m = (basis === "record" && p.recordMonth) ? p.recordMonth : p.payMonth;
    dpsYear += p.dps;
    if (r == null) continue;
    const g = p.dps * u * r;
    monthly[m - 1].gross += g;
    monthly[m - 1].net += g * netFactor(h);
  }
  if (h.yutai > 0 && h.yutaiMonth) monthly[h.yutaiMonth - 1].yutai += h.yutai;
  const gross = r == null ? null : monthly.reduce((a, m) => a + m.gross, 0);
  const net = r == null ? null : monthly.reduce((a, m) => a + m.net, 0);
  const value = h.price != null && r != null ? h.price * u * r : null;
  const cost = h.cost != null && r != null ? h.cost * u * r : null;
  return {
    h, monthly, gross, net, value, cost,
    yutai: h.yutai > 0 ? h.yutai : 0,
    gain: value != null && cost != null ? value - cost : null,
    yieldOnValue: h.price > 0 ? (dpsYear / h.price) * 100 : null,
    yieldOnCost: h.cost > 0 ? (dpsYear / h.cost) * 100 : null,
    missingDiv: h.payments.length === 0 && !h.noDividend,
    missingPrice: h.price == null,
    missingFx: r == null,
  };
}

export const filterHoldings = (state, accountId) => (accountId && accountId !== "all" ? state.holdings.filter((h) => h.accountId === accountId) : state.holdings);

export function summary(state, { accountId = "all", basis = "pay" } = {}) {
  const rows = filterHoldings(state, accountId).map((h) => holdingMetrics(h, state.fx, basis));
  const monthly = Array.from({ length: 12 }, () => ({ gross: 0, net: 0, yutai: 0 }));
  let gross = 0, net = 0, yutai = 0, value = 0, cost = 0, valueForCostGain = 0, grossOnValued = 0, valued = 0, grossOnCosted = 0;
  for (const r of rows) {
    r.monthly.forEach((m, i) => { monthly[i].gross += m.gross; monthly[i].net += m.net; monthly[i].yutai += m.yutai; });
    gross += r.gross ?? 0; net += r.net ?? 0; yutai += r.yutai;
    if (r.value != null) { value += r.value; valued += r.value; grossOnValued += r.gross ?? 0; }
    if (r.value != null && r.cost != null) { cost += r.cost; valueForCostGain += r.value; }
    if (r.cost != null) grossOnCosted += r.gross ?? 0;
  }
  const costAll = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
  return {
    rows, monthly, gross, net, yutai, value,
    cost,
    gain: cost > 0 ? valueForCostGain - cost : null,
    gainPct: cost > 0 ? ((valueForCostGain - cost) / cost) * 100 : null,
    yieldOnValue: valued > 0 ? (grossOnValued / valued) * 100 : null,
    yieldOnCost: costAll > 0 ? (grossOnCosted / costAll) * 100 : null,
    missingDiv: rows.filter((r) => r.missingDiv).length,
    missingPrice: rows.filter((r) => r.missingPrice).length,
    missingFx: rows.some((r) => r.missingFx),
  };
}

// 月の内訳（その月にもらえる銘柄）
export function monthItems(sum, monthIndex, tax = "net") {
  return sum.rows
    .map((r) => ({ r, v: tax === "net" ? r.monthly[monthIndex].net : r.monthly[monthIndex].gross, yutai: r.monthly[monthIndex].yutai }))
    .filter((x) => x.v > 0 || x.yutai > 0)
    .sort((a, b) => b.v + b.yutai - (a.v + a.yutai));
}

// グラフ用のまとめ方
const GROUPERS = {
  holding: (r) => [r.h.code, r.h.name || r.h.code],
  account: (r, s) => [r.h.accountId, s.accounts.find((a) => a.id === r.h.accountId)?.name || "?"],
  tax: (r) => [r.h.taxType, TAX_TYPES[r.h.taxType]],
  asset: (r) => [r.h.assetType, ASSET_TYPES[r.h.assetType]],
  sector: (r) => [r.h.sector || "-", r.h.sector || "業種未入力"],
};
export function breakdown(sum, state, by = "holding", metric = "gross", otherPct = 2) {
  const map = new Map();
  for (const r of sum.rows) {
    const v = metric === "value" ? r.value : metric === "net" ? r.net : r.gross;
    if (!(v > 0)) continue;
    const [k, label] = GROUPERS[by](r, state);
    const cur = map.get(k) || { label, v: 0 };
    cur.v += v;
    map.set(k, cur);
  }
  const all = [...map.values()].sort((a, b) => b.v - a.v);
  const total = all.reduce((a, x) => a + x.v, 0);
  if (!total) return { items: [], total: 0 };
  const items = [], small = [];
  for (const x of all) ((x.v / total) * 100 >= otherPct && items.length < 12 ? items : small).push(x);
  if (small.length === 1) items.push(small[0]);
  else if (small.length) items.push({ label: `その他（${small.length}）`, v: small.reduce((a, x) => a + x.v, 0), other: true });
  return { items, total };
}

// 推移グラフ用：今日の数字を口座ごとに記録
export function snapshot(state, date) {
  const byAccount = {};
  for (const a of state.accounts) {
    const s = summary(state, { accountId: a.id });
    byAccount[a.id] = { value: s.value, cost: s.cost, div: s.net };
  }
  return { date, byAccount };
}
export function recordHistory(state, date) {
  const snap = snapshot(state, date);
  const hist = state.history.filter((e) => e.date !== date);
  hist.push(snap);
  hist.sort((a, b) => a.date.localeCompare(b.date));
  return hist.slice(-1000);
}
export function series(state, accountId, field) {
  return state.history.map((e) => {
    let v = 0;
    for (const [k, x] of Object.entries(e.byAccount)) if (accountId === "all" || accountId === k) v += x[field] || 0;
    return { date: e.date, v };
  });
}

export const yen = (n) => (n == null ? "—" : (n < 0 ? "-" : "") + "¥" + Math.round(Math.abs(n)).toLocaleString("ja-JP"));
export const signedYen = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + yen(n));
export const pct = (n, d = 2) => (n == null ? "—" : `${n.toFixed(d)}%`);
export const signedPct = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
export const isNisaType = isNisa;
