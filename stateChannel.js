// stateChannel.js
import fs from "fs";
import path from "path";

/** ここで永続化対象のファイルを指定（必要なら増減OK） */
const FILES = ["accounts.json", "panels.json", "notify.json"];

function readJsonSafe(file) {
  try {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) return Array.isArrayTemplate(file) ? [] : [];
    const txt = fs.readFileSync(full, "utf8");
    return JSON.parse(txt || "[]");
  } catch {
    return [];
  }
}

function writeJsonSafe(file, data) {
  const full = path.join(process.cwd(), file);
  fs.writeFileSync(full, JSON.stringify(data ?? [], null, 2), "utf8");
}

function extractJsonFromCodeBlock(content) {
  const m = content.match(/```json\s*([\s\S]*?)\s*```/);
  return m ? m[1] : null;
}

/** 即時スナップショット保存（Discordの STATE_CHANNEL_ID に投稿） */
export async function saveStateNow(client, reason = "") {
  const channelId = process.env.STATE_CHANNEL_ID;
  if (!channelId) {
    console.warn("[state] STATE_CHANNEL_ID が未設定です。");
    return false;
  }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased?.()) {
    console.error("[state] state channel が無効です:", channelId);
    return false;
  }

  const payload = { version: 1, ts: Date.now(), reason, data: {} };
  for (const f of FILES) payload.data[f] = readJsonSafe(f);

  const json = JSON.stringify(payload);
  const content = `# [WPLACE_STATE]\n\`\`\`json\n${json}\n\`\`\``;

  await ch.send({ content });
  console.log("[state] snapshot saved:", channelId, "size=", json.length, "bytes");
  return true;
}

/** 起動時の自動復元（最新の [WPLACE_STATE] を読み戻す） */
export async function restoreFromStateChannel(client) {
  const channelId = process.env.STATE_CHANNEL_ID;
  if (!channelId) return { restored: false, reason: "STATE_CHANNEL_ID not set" };

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased?.()) return { restored: false, reason: "invalid channel" };

  const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
  if (!msgs) return { restored: false, reason: "fetch failed" };

  const snap = msgs.find((m) => typeof m.content === "string" && m.content.includes("[WPLACE_STATE]"));
  if (!snap) return { restored: false, reason: "no snapshot" };

  const jsonText = extractJsonFromCodeBlock(snap.content);
  if (!jsonText) return { restored: false, reason: "no json block" };

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { restored: false, reason: "json parse error" };
  }
  const data = parsed?.data;
  if (!data || typeof data !== "object") return { restored: false, reason: "no data" };

  for (const f of FILES) {
    if (f in data) writeJsonSafe(f, data[f]);
  }
  console.log("[state] restored from snapshot");
  return { restored: true };
}

/** 変更の度に軽くディレイして保存（スパム防止の簡易デバウンス） */
let saveTimer = null;
export function scheduleStateSave(client, reason = "") {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStateNow(client, reason).catch(() => {});
  }, 1000);
}
