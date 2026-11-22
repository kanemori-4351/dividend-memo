// グラフ（SVG）。外部のライブラリは使わない。
const NS = "http://www.w3.org/2000/svg";

function svgRoot(w, h, label) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("role", "img");
  if (label) svg.setAttribute("aria-label", label);
  return svg;
}
function mk(parent, tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  parent.append(n);
  return n;
}
const shortYen = (v) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}億` : v >= 1e4 ? `${(v / 1e4).toFixed(v >= 1e5 ? 0 : 1)}万` : Math.round(v).toLocaleString("ja-JP"));

// 色（明るい画面・暗い画面の両方で見分けやすい順）
export const PALETTE = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#eab308"];
export const OTHER_COLOR = "#9ca3af";

// 月別の積み上げ棒グラフ。bars: [{a, b}]（a=配当, b=優待）。onSelect(月の番号0〜11)
export function monthBars(bars, { selected = null, now = null, onSelect } = {}) {
  const W = 340, H = 190, L = 4, R = 4, T = 18, B = 20;
  const svg = svgRoot(W, H, "月ごとの配当の棒グラフ");
  const max = Math.max(...bars.map((x) => x.a + x.b), 1);
  const slot = (W - L - R) / 12, bw = slot * 0.64;
  mk(svg, "line", { x1: L, x2: W - R, y1: H - B, y2: H - B, class: "grid" });
  bars.forEach((x, i) => {
    const total = x.a + x.b;
    const hA = (x.a / max) * (H - T - B), hB = (x.b / max) * (H - T - B);
    const bx = L + i * slot + (slot - bw) / 2;
    const g = mk(svg, "g", { class: `mbar${i === selected ? " sel" : ""}${i === now ? " now" : ""}` });
    mk(g, "rect", { x: L + i * slot, y: 0, width: slot, height: H, class: "hit" });
    if (x.a > 0) mk(g, "rect", { x: bx, y: H - B - hA, width: bw, height: Math.max(hA, 1), rx: 2, class: "a" });
    if (x.b > 0) mk(g, "rect", { x: bx, y: H - B - hA - hB, width: bw, height: Math.max(hB, 1), rx: 2, class: "b" });
    if (total > 0) mk(g, "text", { x: bx + bw / 2, y: H - B - hA - hB - 4, "text-anchor": "middle", class: "val" }, shortYen(total));
    mk(g, "text", { x: bx + bw / 2, y: H - 6, "text-anchor": "middle", class: "axis" }, `${i + 1}`);
    if (onSelect) g.addEventListener("click", () => onSelect(i));
  });
  return svg;
}

// ドーナツグラフ。items: [{label, v, other}]。中央に center の文字（2行まで）
export function donut(items, center = []) {
  const W = 220, H = 220, cx = 110, cy = 110, r = 92, w = 30;
  const svg = svgRoot(W, H, "割合のドーナツグラフ");
  const total = items.reduce((a, x) => a + x.v, 0);
  if (!total) return svg;
  let ang = -Math.PI / 2;
  const colors = [];
  items.forEach((x, i) => {
    const color = x.other ? OTHER_COLOR : PALETTE[i % PALETTE.length];
    colors.push(color);
    const frac = x.v / total;
    if (frac >= 0.9999) {
      mk(svg, "circle", { cx, cy, r: r - w / 2, fill: "none", stroke: color, "stroke-width": w });
      return;
    }
    const a2 = ang + frac * Math.PI * 2;
    const p = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    const [x1, y1] = p(ang, r), [x2, y2] = p(a2, r), [x3, y3] = p(a2, r - w), [x4, y4] = p(ang, r - w);
    const large = a2 - ang > Math.PI ? 1 : 0;
    mk(svg, "path", { d: `M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${r - w},${r - w} 0 ${large} 0 ${x4},${y4}Z`, fill: color, class: "slice" });
    if (frac >= 0.05) {
      const [lx, ly] = p((ang + a2) / 2, r - w / 2);
      mk(svg, "text", { x: lx, y: ly + 4, "text-anchor": "middle", class: "slice-label" }, (frac * 100).toFixed(frac >= 0.1 ? 0 : 1));
    }
    ang = a2;
  });
  center.forEach((t, i) => mk(svg, "text", { x: cx, y: cy + (i - (center.length - 1) / 2) * 20 + 5, "text-anchor": "middle", class: i === 0 ? "center-big" : "center-small" }, t));
  svg.colors = colors;
  return svg;
}

// 折れ線グラフ。points: [{date, v}]
export function line(points, label) {
  const W = 340, H = 160, L = 6, R = 6, T = 14, B = 20;
  const svg = svgRoot(W, H, label);
  const vals = points.map((p) => p.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= Math.abs(min) * 0.1 + 1; max += Math.abs(max) * 0.1 + 1; }
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date) || t0 + 1;
  const x = (d) => L + ((Date.parse(d) - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  for (const f of [0, 0.5, 1]) mk(svg, "line", { x1: L, x2: W - R, y1: T + f * (H - T - B), y2: T + f * (H - T - B), class: "grid" });
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  mk(svg, "path", { d: `${d}L${x(points[points.length - 1].date)},${H - B}L${x(points[0].date)},${H - B}Z`, class: "area" });
  mk(svg, "path", { d, class: "line" });
  const fmt = (s) => { const [, m, dd] = s.split("-"); return `${Number(m)}/${Number(dd)}`; };
  mk(svg, "text", { x: L, y: H - 5, class: "axis" }, fmt(points[0].date));
  mk(svg, "text", { x: W - R, y: H - 5, "text-anchor": "end", class: "axis" }, fmt(points[points.length - 1].date));
  mk(svg, "text", { x: W - R, y: T - 3, "text-anchor": "end", class: "axis" }, shortYen(Math.max(...vals)));
  return svg;
}
