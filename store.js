// store.js
import fs from "fs";

const FILE = "./accounts.json";

export function loadAccounts() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveAccounts(accounts) {
  fs.writeFileSync(FILE, JSON.stringify(accounts, null, 2), "utf8");
}

export function addAccount({ label, token, mode }) {
  const accounts = loadAccounts();
  if (accounts.some(a => a.label === label)) {
    throw new Error("同じ label が既に存在します");
  }
  accounts.push({ label, token, mode });
  saveAccounts(accounts);
  return accounts;
}

export function removeAccount(label) {
  const accounts = loadAccounts();
  const next = accounts.filter(a => a.label !== label);
  if (next.length === accounts.length) throw new Error("指定の label は見つかりません");
  saveAccounts(next);
  return next;
}
