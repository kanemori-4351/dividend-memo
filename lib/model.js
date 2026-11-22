// データの形・読み込み時のチェック・古い形からの移行

export const ASSET_TYPES = { jp: "日本株", us: "米国株", fund: "投資信託" };
export const TAX_TYPES = {
  taxable: "特定・一般",
  nisa_growth: "NISA成長",
  nisa_tsumitate: "NISAつみたて",
  nisa_old: "旧NISA",
  ideco: "iDeCo",
};
export const isNisa = (t) => t === "nisa_growth" || t === "nisa_tsumitate" || t === "nisa_old";

export function emptyState() {
  return {
    app: "dividend-memo",
    version: 2,
    accounts: [{ id: "main", name: "メイン" }],
    holdings: [],
    fx: { usdjpy: null, date: null },
    history: [],
    settings: { tax: "net", basis: "pay", font: "m" },
  };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const month = (v) => (Number.isInteger(v) && v >= 1 && v <= 12 ? v : null);

function cleanHolding(h, accountIds, fallbackAccount) {
  const assetType = ASSET_TYPES[h.assetType] ? h.assetType : "jp";
  return {
    id: str(h.id, 40) || Math.random().toString(36).slice(2),
    accountId: accountIds.has(h.accountId) ? h.accountId : fallbackAccount,
    taxType: TAX_TYPES[h.taxType] ? h.taxType : "taxable",
    assetType,
    code: str(h.code, 16).toUpperCase(),
    name: str(h.name, 60),
    shares: num(h.shares) ?? 0,
    cost: num(h.cost),
    price: num(h.price),
    priceDate: /^\d{4}-\d{2}-\d{2}$/.test(h.priceDate) ? h.priceDate : null,
    sector: str(h.sector, 30),
    yutai: num(h.yutai),
    yutaiMonth: month(h.yutaiMonth),
    memo: str(h.memo, 300),
    noDividend: h.noDividend === true,
    payments: (Array.isArray(h.payments) ? h.payments : [])
      .map((p) => ({ payMonth: month(p.payMonth), recordMonth: month(p.recordMonth), dps: num(p.dps) }))
      .filter((p) => p.payMonth && p.dps !== null && p.dps >= 0)
      .slice(0, 12),
  };
}

// 古い形（version 1）から新しい形へ
export function migrate(obj) {
  if (obj && obj.app === "dividend-memo" && obj.version === 1 && Array.isArray(obj.holdings)) {
    const s = emptyState();
    s.holdings = obj.holdings.map((h) => ({
      ...h,
      accountId: "main",
      taxType: h.account === "nisa" ? "nisa_growth" : "taxable",
      assetType: "jp",
      payments: (h.payments || []).map((p) => ({ payMonth: p.month, recordMonth: null, dps: p.dps })),
    }));
    return s;
  }
  return obj;
}

export function validate(input) {
  const obj = migrate(input);
  if (!obj || obj.app !== "dividend-memo" || obj.version !== 2 || !Array.isArray(obj.holdings)) {
    throw new Error("配当メモのバックアップではないか、形式が正しくありません");
  }
  const base = emptyState();
  let accounts = (Array.isArray(obj.accounts) ? obj.accounts : [])
    .filter((a) => a && typeof a.id === "string" && typeof a.name === "string")
    .map((a) => ({ id: a.id.slice(0, 40), name: a.name.slice(0, 20) }))
    .slice(0, 10);
  if (!accounts.length) accounts = base.accounts;
  const ids = new Set(accounts.map((a) => a.id));
  const holdings = obj.holdings.filter((h) => h && typeof h.code === "string" && h.code.trim()).map((h) => cleanHolding(h, ids, accounts[0].id));
  const fx = { usdjpy: num(obj.fx?.usdjpy), date: /^\d{4}-\d{2}-\d{2}$/.test(obj.fx?.date) ? obj.fx.date : null };
  const history = (Array.isArray(obj.history) ? obj.history : [])
    .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.byAccount && typeof e.byAccount === "object")
    .map((e) => {
      const byAccount = {};
      for (const [k, v] of Object.entries(e.byAccount)) {
        if (v && typeof v === "object") byAccount[k.slice(0, 40)] = { value: num(v.value) ?? 0, cost: num(v.cost) ?? 0, div: num(v.div) ?? 0 };
      }
      return { date: e.date, byAccount };
    })
    .slice(-1000);
  const st = obj.settings || {};
  const settings = {
    tax: st.tax === "gross" ? "gross" : "net",
    basis: st.basis === "record" ? "record" : "pay",
    font: ["s", "m", "l", "xl"].includes(st.font) ? st.font : "m",
  };
  return { app: "dividend-memo", version: 2, accounts, holdings, fx, history, settings };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
