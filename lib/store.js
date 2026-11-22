// データはこの端末のブラウザの中（localStorage）だけに保存する。外部には送らない。

const KEY = "dividend-memo:v1";

export function emptyState() {
  return { app: "dividend-memo", version: 1, holdings: [] };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return validate(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearAll() {
  try { localStorage.removeItem(KEY); } catch { /* 何もしない */ }
}

// iPhone の Safari がデータを自動で消さないよう、永続保存をお願いする（対応していれば）
export async function requestPersist() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* 非対応 */ }
  return false;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// 読み込んだデータ（保存済み・バックアップ）の形のチェックと整形
export function validate(obj) {
  if (!obj || obj.app !== "dividend-memo" || obj.version !== 1 || !Array.isArray(obj.holdings)) {
    throw new Error("配当メモのバックアップではないか、形式が正しくありません");
  }
  const holdings = obj.holdings
    .filter((h) => h && typeof h.id === "string" && typeof h.code === "string" && num(h.shares) !== null)
    .map((h) => ({
      id: h.id,
      code: h.code.slice(0, 12),
      name: typeof h.name === "string" ? h.name.slice(0, 60) : "",
      shares: h.shares,
      cost: num(h.cost),
      account: h.account === "nisa" ? "nisa" : "taxable",
      payments: Array.isArray(h.payments)
        ? h.payments
          .filter((p) => p && Number.isInteger(p.month) && p.month >= 1 && p.month <= 12 && num(p.dps) !== null)
          .map((p) => ({ month: p.month, dps: p.dps }))
          .slice(0, 12)
        : [],
    }));
  return { app: "dividend-memo", version: 1, holdings };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
