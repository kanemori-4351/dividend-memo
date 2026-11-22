// 配当の集計（画面に依存しない計算だけ。テストできるように分けてある）

export const TAX_RATE = 0.20315; // 課税口座の配当にかかる税率（所得税15.315%＋住民税5%）
export const ACCOUNTS = { nisa: "NISA", taxable: "課税口座" };

const netRate = (account) => (account === "nisa" ? 1 : 1 - TAX_RATE);

// 1銘柄の、月ごとの配当（税引前）。12要素（1月〜12月）
export function holdingMonthly(h) {
  const out = Array(12).fill(0);
  for (const p of h.payments) {
    if (p.month >= 1 && p.month <= 12 && Number.isFinite(p.dps)) out[p.month - 1] += p.dps * h.shares;
  }
  return out;
}

export const annualGross = (h) => holdingMonthly(h).reduce((a, b) => a + b, 0);
export const annualDps = (h) => h.payments.reduce((a, p) => a + (Number.isFinite(p.dps) ? p.dps : 0), 0);

// 取得単価に対する利回り（%）。取得単価がなければ null
export const yieldOnCost = (h) => (h.cost > 0 ? (annualDps(h) / h.cost) * 100 : null);

export function summary(state) {
  const monthly = Array.from({ length: 12 }, () => ({ gross: 0, net: 0 }));
  const rows = [];
  let gross = 0, net = 0, costTotal = 0, dividendOnCosted = 0;
  for (const h of state.holdings) {
    const m = holdingMonthly(h);
    const g = m.reduce((a, b) => a + b, 0);
    m.forEach((v, i) => { monthly[i].gross += v; monthly[i].net += v * netRate(h.account); });
    gross += g;
    net += g * netRate(h.account);
    if (h.cost > 0) { costTotal += h.cost * h.shares; dividendOnCosted += g; }
    rows.push({ holding: h, gross: g, net: g * netRate(h.account), missing: h.payments.length === 0 });
  }
  rows.sort((a, b) => b.gross - a.gross);
  return {
    gross, net, monthly, rows,
    monthlyAvgNet: net / 12,
    yieldOnCost: costTotal > 0 ? (dividendOnCosted / costTotal) * 100 : null,
    missing: rows.filter((r) => r.missing).length,
  };
}

// 今月から先 n か月の入金予定（金額があるものだけ）
export function upcoming(state, today = new Date(), n = 3) {
  const s = summary(state);
  const out = [];
  for (let i = 0; i < 12 && out.length < n; i++) {
    const idx = (today.getMonth() + i) % 12;
    if (s.monthly[idx].gross > 0) {
      const items = state.holdings
        .map((h) => ({ h, v: holdingMonthly(h)[idx] }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v);
      out.push({ month: idx + 1, ...s.monthly[idx], items });
    }
  }
  return out;
}

export const yen = (n) => (n == null ? "—" : (n < 0 ? "-" : "") + "¥" + Math.round(Math.abs(n)).toLocaleString("ja-JP"));
export const pct = (n) => (n == null ? "—" : `${n.toFixed(2)}%`);
