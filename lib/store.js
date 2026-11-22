// データはこの端末のブラウザの中（localStorage）だけに保存する。外部には送らない。
import { emptyState, validate } from "./model.js";

const KEY = "dividend-memo:v1"; // 保存場所の名前は v0.1 から変えない（中身の version で区別）

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
