// notifyStore.js
import fs from "fs";

const FILE = "./notify.json";

// 初期値（ユーザー指定の通知チャンネルID）
const DEFAULT_CHANNEL_ID = "1419007375796338781";

function ensureShape(obj) {
  if (!obj || typeof obj !== "object") obj = {};
  if (!obj.channelId) obj.channelId = DEFAULT_CHANNEL_ID;
  if (!Array.isArray(obj.rules)) obj.rules = [];
  return obj;
}

export function loadNotify() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    return ensureShape(JSON.parse(raw));
  } catch {
    return ensureShape({});
  }
}

export function saveNotify(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

export function getChannelId() {
  const d = loadNotify();
  return d.channelId;
}

export function setChannelId(channelId) {
  const d = loadNotify();
  d.channelId = channelId;
  saveNotify(d);
  return channelId;
}

function makeId() {
  const rnd = Math.random().toString(16).slice(2, 6);
  return `n-${Date.now()}-${rnd}`;
}

export function addRule(rule) {
  // rule: { label, type: 'full'|'before_full'|'threshold', minutes?, threshold? }
  const d = loadNotify();
  const id = makeId();
  const rec = {
    id,
    label: rule.label,
    type: rule.type,
    minutes: rule.minutes ?? null,
    threshold: rule.threshold ?? null,
    enabled: true,
    // 通知の再発判定用の内部状態（初回は学習のみで発火しない）
    state: {
      lastPaint: null,
      lastEtaSec: null,
      lastFiredAt: null,
    },
  };
  d.rules.push(rec);
  saveNotify(d);
  return rec;
}

export function removeRule(id) {
  const d = loadNotify();
  const next = d.rules.filter((r) => r.id !== id);
  if (next.length === d.rules.length) throw new Error("rule not found");
  d.rules = next;
  saveNotify(d);
  return true;
}

export function listRules(label = null) {
  const d = loadNotify();
  return d.rules.filter((r) => !label || r.label === label);
}

export function updateRuleState(id, patch) {
  const d = loadNotify();
  const idx = d.rules.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error("rule not found");
  d.rules[idx] = {
    ...d.rules[idx],
    state: { ...(d.rules[idx].state || {}), ...patch },
  };
  saveNotify(d);
  return d.rules[idx];
}
