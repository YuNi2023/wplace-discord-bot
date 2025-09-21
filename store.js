// store.js
import fs from "fs";

const FILE = "./accounts.json";

export function loadAccounts() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
    return [];
  } catch {
    return [];
  }
}

function saveAccounts(arr) {
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2), "utf8");
}

export function addAccount({ label, token, mode }) {
  if (!label || !token || !mode) throw new Error("label, token, mode は必須です");
  const arr = loadAccounts();

  // 同じ label があれば上書き（重複回避）
  const idx = arr.findIndex((a) => a.label === label);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], token, mode };
  } else {
    arr.push({ label, token, mode });
  }
  saveAccounts(arr);
  return true;
}

export function removeAccount(label) {
  const arr = loadAccounts();
  const next = arr.filter((a) => a.label !== label);
  if (next.length === arr.length) throw new Error("見つかりませんでした");
  saveAccounts(next);
  return true;
}

/** ラベルを指定して token を更新（mode は既存のまま） */
export function updateTokenByLabel(label, token) {
  const arr = loadAccounts();
  const idx = arr.findIndex((a) => a.label === label);
  if (idx === -1) throw new Error("指定ラベルのアカウントがありません");
  arr[idx].token = token;
  saveAccounts(arr);
  return arr[idx];
}
