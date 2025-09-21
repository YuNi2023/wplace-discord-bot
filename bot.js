// bot.js
import "./web.js";
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { addAccount, loadAccounts, removeAccount, updateTokenByLabel } from "./store.js";
import { loadPanels, addPanel, removePanel } from "./panelStore.js";
import { fetchMe, calcNextLevelPixels } from "./wplace.js";
import { loadNotify, getChannelId as getNotifyChannelId, setChannelId as setNotifyChannelId,
         addRule as addNotifyRule, removeRule as removeNotifyRule, listRules as listNotifyRules,
         updateRuleState } from "./notifyStore.js";

import { restoreFromStateChannel, scheduleStateSave, saveStateNow } from "./stateChannel.js";

/* ------------ ユーティリティ ------------ */
const RECOVER_PER_UNIT_SEC = 30;
function calcFullRecovery(paintCurrent, paintMax) {
  const cur = Number(paintCurrent ?? 0), max = Number(paintMax ?? 0);
  const missing = Math.max(0, max - cur);
  const seconds = missing * RECOVER_PER_UNIT_SEC;
  return { missing, seconds, eta: new Date(Date.now() + seconds * 1000) };
}
function fmtDurationJa(seconds) {
  let s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600);  s %= 3600;
  const m = Math.floor(s / 60);    s %= 60;
  const parts = [];
  if (d) parts.push(`${d}日`);
  if (h) parts.push(`${h}時間`);
  if (m) parts.push(`${m}分`);
  if (!parts.length) parts.push(`${s}秒`);
  else if (s && d === 0 && h === 0) parts.push(`${s}秒`);
  return parts.join(" ");
}
function fmtJST(dt) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(dt) + " JST";
}

/* ------------ Discord Client ------------ */
const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const r = await restoreFromStateChannel(client);
    console.log("[state] restore result:", r);
  } catch (e) {
    console.error("[state] restore error:", e);
  }
  // 起動時に動いているパネルがあれば再開
  const panels = loadPanels();
  for (const p of panels) schedulePanel(p);
});

/* ------------ Embed / Buttons ------------ */
function buildEmbedsForAccounts(results, { hideErrors = false } = {}) {
  const embeds = results.map((r) => {
    if (r.status === "fulfilled") {
      const { a, me, needed } = r.value;
      const { missing, seconds, eta } = calcFullRecovery(me.paintCurrent, me.paintMax);
      const fullIn = missing === 0 ? "満タン" : `${fmtDurationJa(seconds)}（残り ${missing}）`;
      const fullAt = missing === 0 ? "-" : fmtJST(eta);
      return new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle(`Wplace: ${a.label}`)
        .addFields(
          { name: "アカウント名", value: String(me.name), inline: true },
          { name: "Droplets", value: Number(me.droplets).toLocaleString(), inline: true },
          { name: "Paint", value: `${Number(me.paintCurrent).toLocaleString()} / ${Number(me.paintMax).toLocaleString()}`, inline: true },
          { name: "レベル", value: `${me.level}`, inline: true },
          { name: "次レベルまで", value: `${needed.toLocaleString()} px`, inline: true },
          { name: "全回復まで", value: fullIn, inline: true },
          { name: "全回復予定", value: fullAt, inline: true },
        )
        .setFooter({ text: `モード: ${a.mode}` })
        .setTimestamp(new Date());
    } else {
      if (hideErrors) return null;
      const err = r.reason;
      const status = err?.response?.status ?? "N/A";
      const body = typeof err?.response?.data === "object"
        ? JSON.stringify(err.response.data)
        : String(err?.response?.data ?? err?.message ?? err);
      return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle("取得失敗")
        .addFields(
          { name: "Status", value: String(status), inline: true },
          { name: "Detail", value: body.slice(0, 1000) || "（詳細なし）" },
        );
    }
  }).filter(Boolean);

  if (!embeds.length) {
    embeds.push(new EmbedBuilder().setColor(Colors.Grey)
      .setTitle("表示できるアカウントがありません")
      .setDescription("取得に成功したアカウントがないか、未登録です。")
      .setTimestamp(new Date()));
  }
  return embeds;
}

function buildTokenButtons(results) {
  const btns = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { a } = r.value;
    const labelText = a.mode === "cookie" ? `Cookie更新（${a.label}）` : `Bearer更新（${a.label}）`;
    btns.push(new ButtonBuilder()
      .setCustomId(`token:update:${a.mode}:${a.label}`)
      .setLabel(labelText)
      .setStyle(ButtonStyle.Primary));
  }
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  return rows;
}

/* ------------ データ取得（必要最小限） ------------ */
async function fetchForLabels(labels) {
  const accounts = loadAccounts();
  const targets = labels?.length ? accounts.filter((a) => labels.includes(a.label)) : accounts;
  const use = targets.slice(0, 20);
  const settled = await Promise.allSettled(use.map(async (a) => {
    const me = await fetchMe(a.token, a.mode);
    const needed = calcNextLevelPixels(me.level, me.pixelsPainted);
    return { a, me, needed };
  }));
  return { results: settled, count: settled.length };
}

/* ------------ コマンド ------------ */
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isChatInputCommand() && !i.isButton() && !i.isModalSubmit()) return;

    /* /wplace */
    if (i.isChatInputCommand() && i.commandName === "wplace") {
      const sub = i.options.getSubcommand();

      if (sub === "add") {
        const label = i.options.getString("label", true);
        const mode = i.options.getString("mode", true).toLowerCase();
        const token = i.options.getString("token", true);
        if (!["cookie", "bearer"].includes(mode)) {
          return i.reply({ content: "mode は cookie | bearer のどちらかです。", ephemeral: true });
        }
        addAccount({ label, token, mode });
        scheduleStateSave(client, "account-add");
        return i.reply({ content: `✅ 追加しました：**${label}** (${mode})`, ephemeral: true });
      }

      if (sub === "list") {
        const accounts = loadAccounts();
        if (!accounts.length) return i.reply("（登録なし）");
        return i.reply(accounts.map((a) => `• **${a.label}** (${a.mode})`).join("\n"));
      }

      if (sub === "remove") {
        const label = i.options.getString("label", true);
        removeAccount(label);
        scheduleStateSave(client, "account-remove");
        return i.reply({ content: `🗑️ 削除しました：**${label}**`, ephemeral: true });
      }

      if (sub === "me") {
        await i.deferReply();
        const label = i.options.getString("label");
        const labels = label ? [label] : null;
        const { results } = await fetchForLabels(labels);
        const embeds = buildEmbedsForAccounts(results, { hideErrors: false });
        const components = buildTokenButtons(results);
        return i.editReply({ embeds, components });
      }
    }

    /* /panel */
    if (i.isChatInputCommand() && i.commandName === "panel") {
      const sub = i.options.getSubcommand();

      if (sub === "start") {
        await i.deferReply({ ephemeral: true });
        const intervalMin = i.options.getInteger("interval", true);
        const labelsStr = i.options.getString("labels") || "";
        const labels = labelsStr ? labelsStr.split(",").map((s) => s.trim()).filter(Boolean) : null;
        const targetChannel = i.options.getChannel("channel") || i.channel;
        if (!targetChannel?.isTextBased?.()) {
          return i.editReply("❌ このチャンネルには投稿できません。");
        }

        const { results } = await fetchForLabels(labels);
        const embeds = buildEmbedsForAccounts(results, { hideErrors: true });
        const components = buildTokenButtons(results);
        const msg = await targetChannel.send({ content: "Wplace パネル（準備中）", embeds, components });

        const panel = { id: `${msg.channelId}:${msg.id}`, channelId: msg.channelId, messageId: msg.id,
                        labels, intervalSec: Math.max(60, intervalMin * 60) };
        addPanel(panel);
        scheduleStateSave(client, "panel-start");
        schedulePanel(panel);

        await msg.edit({ content: `Wplace パネル（${panel.id}）`, embeds, components });
        return i.editReply(`✅ パネル開始: \`${panel.id}\`（${intervalMin}分間隔 / 投稿先: <#${panel.channelId}>）`);
      }

      if (sub === "list") {
        const panels = loadPanels();
        if (!panels.length) return i.reply("（稼働中パネルなし）");
        const lines = panels.map((p) => `• \`${p.id}\` interval=${Math.round(p.intervalSec / 60)}分 labels=${p.labels?.join(",") || "(all)"} / channel=<#${p.channelId}>`);
        return i.reply(lines.join("\n"));
      }

      if (sub === "stop") {
        await i.deferReply({ ephemeral: true });
        const id = i.options.getString("id", true);
        stopOne(id);
        removePanel(id);
        scheduleStateSave(client, "panel-stop");
        return i.editReply(`🛑 停止: \`${id}\``);
      }

      if (sub === "refresh") {
        await i.deferReply({ ephemeral: true });
        const id = i.options.getString("id", true);
        await runOnce(id);
        return i.editReply(`🔄 リフレッシュ済み: \`${id}\``);
      }
    }

    /* /notify（必要なら） */
    if (i.isChatInputCommand() && i.commandName === "notify") {
      const sub = i.options.getSubcommand();

      if (sub === "channel") {
        const ch = i.options.getChannel("channel", true);
        if (!ch?.isTextBased?.()) return i.reply({ content: "❌ テキストチャンネルを指定してください。", ephemeral: true });
        setNotifyChannelId(ch.id);
        scheduleStateSave(client, "notify-channel");
        return i.reply({ content: `✅ 通知チャンネルを <#${ch.id}> に設定しました。`, ephemeral: true });
      }

      if (sub === "add_full") {
        const label = i.options.getString("label", true);
        const rec = addNotifyRule({ label, type: "full" });
        scheduleStateSave(client, "notify-add");
        return i.reply({ content: `✅ 追加: 満タン通知 id=\`${rec.id}\` label=\`${label}\``, ephemeral: true });
      }

      if (sub === "add_before_full") {
        const label = i.options.getString("label", true);
        const minutes = i.options.getInteger("minutes", true);
        const rec = addNotifyRule({ label, type: "before_full", minutes });
        scheduleStateSave(client, "notify-add");
        return i.reply({ content: `✅ 追加: 満タン${minutes}分前通知 id=\`${rec.id}\` label=\`${label}\``, ephemeral: true });
      }

      if (sub === "add_threshold") {
        const label = i.options.getString("label", true);
        const value = i.options.getInteger("value", true);
        const rec = addNotifyRule({ label, type: "threshold", threshold: value });
        scheduleStateSave(client, "notify-add");
        return i.reply({ content: `✅ 追加: しきい値 ${value} 通知 id=\`${rec.id}\` label=\`${label}\``, ephemeral: true });
      }

      if (sub === "list") {
        const label = i.options.getString("label") || null;
        const items = listNotifyRules(label);
        if (!items.length) return i.reply("（設定なし）");
        const lines = items.map((r) => {
          if (r.type === "full") return `• id=\`${r.id}\` label=\`${r.label}\` type=満タン`;
          if (r.type === "before_full") return `• id=\`${r.id}\` label=\`${r.label}\` type=満タン${r.minutes}分前`;
          if (r.type === "threshold") return `• id=\`${r.id}\` label=\`${r.label}\` type=しきい値>=${r.threshold}`;
          return `• id=\`${r.id}\` label=\`${r.label}\` type=${r.type}`;
        });
        const chId = getNotifyChannelId();
        lines.push(`通知チャンネル: <#${chId}>`);
        return i.reply(lines.join("\n"));
      }

      if (sub === "remove") {
        const id = i.options.getString("id", true);
        removeNotifyRule(id);
        scheduleStateSave(client, "notify-remove");
        return i.reply({ content: `🗑️ 削除: \`${id}\``, ephemeral: true });
      }
    }

    /* ボタン→モーダル（トークン更新） */
    if (i.isButton()) {
      const parts = i.customId.split(":");
      if (parts[0] === "token" && parts[1] === "update") {
        const mode = parts[2];
        const label = parts.slice(3).join(":");
        const modal = new ModalBuilder()
          .setCustomId(`tokenmodal:${mode}:${label}`)
          .setTitle(`Wplace ${label} の ${mode === "cookie" ? "Cookie" : "Bearer"} 更新`);
        const input = new TextInputBuilder()
          .setCustomId("token")
          .setLabel(mode === "cookie" ? "j= から始まるCookie文字列" : "Bearer トークン（'Bearer 'を含めて貼付）")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder(mode === "cookie" ? "例: j=xxxxx.yyyyy.zzzzz" : "例: Bearer eyJhbGciOi...");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }
    }

    /* モーダルSubmit → 保存＆即反映 */
    if (i.isModalSubmit() && i.customId.startsWith("tokenmodal:")) {
      const [, mode, label] = i.customId.split(":");
      const token = i.fields.getTextInputValue("token").trim();
      await i.deferReply({ ephemeral: true });
      try {
        const me = await fetchMe(token, mode); // 検証
        updateTokenByLabel(label, token);      // 保存
        scheduleStateSave(client, "token-update");
        await i.editReply(`✅ **${label}** の ${mode === "cookie" ? "Cookie" : "Bearer"} を更新しました。\n検証OK：アカウント名 **${me.name}**`);
        await refreshPanelsForLabel(label);
      } catch (e) {
        const status = e?.response?.status ? `HTTP ${e.response.status}` : "";
        const detail = typeof e?.response?.data === "object" ? JSON.stringify(e.response.data) : e?.message || "検証に失敗しました。";
        await i.editReply(`❌ 更新できませんでした。${status}\n${detail.slice(0, 500)}`);
      }
      return;
    }

    /* /state save|restore */
    if (i.isChatInputCommand() && i.commandName === "state") {
      const sub = i.options.getSubcommand();
      if (sub === "save") {
        await i.deferReply({ ephemeral: true });
        const ok = await saveStateNow(client, "manual");
        return i.editReply(ok ? "✅ 保存しました。" : "❌ 保存できませんでした（STATE_CHANNEL_ID未設定？）");
      }
      if (sub === "restore") {
        await i.deferReply({ ephemeral: true });
        const r = await restoreFromStateChannel(client);
        // 復元後、パネル再開
        const panels = loadPanels();
        for (const p of panels) schedulePanel(p);
        return i.editReply(r.restored ? "✅ 復元しました。" : `❌ 復元できませんでした（${r.reason || "unknown"}）`);
      }
    }
  } catch (err) {
    console.error(err);
    if (i.deferred || i.replied) return i.editReply("エラーが発生しました。ログを確認してください。");
    return i.reply({ content: "エラーが発生しました。", ephemeral: true });
  }
});

/* ------------ パネル スケジューラ ------------ */
const timers = new Map();

function schedulePanel(panel) {
  stopOne(panel.id);
  const fn = async () => {
    try { await runOnce(panel.id); } catch (e) { console.error("panel run error:", e); }
  };
  fn(); // すぐ1回
  const t = setInterval(fn, panel.intervalSec * 1000);
  timers.set(panel.id, t);
}
function stopOne(id) {
  const t = timers.get(id);
  if (t) { clearInterval(t); timers.delete(id); }
}
async function runOnce(id) {
  const panels = loadPanels();
  const p = panels.find((x) => x.id === id);
  if (!p) throw new Error("panel not found");
  const channel = await client.channels.fetch(p.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("channel not found or not text");

  let msg = null;
  if (p.messageId) msg = await channel.messages.fetch(p.messageId).catch(() => null);
  if (!msg) msg = await channel.send({ content: "Wplace パネル（準備中）" });

  const { results } = await fetchForLabels(p.labels);
  const embeds = buildEmbedsForAccounts(results, { hideErrors: true });
  const components = buildTokenButtons(results);

  await msg.edit({ content: `Wplace パネル（${p.id})`, embeds, components }).catch(() => {});
  // messageId が変わった場合だけ上書き
  if (p.messageId !== msg.id) {
    p.messageId = msg.id;
    removePanel(p.id);
    const newId = `${p.channelId}:${msg.id}`;
    addPanel({ ...p, id: newId });
    scheduleStateSave(client, "panel-msgid-update");
  }
}

async function refreshPanelsForLabel(label) {
  const panels = loadPanels();
  for (const p of panels) {
    if (!p.labels || p.labels.includes(label)) {
      try { await runOnce(p.id); } catch (e) { console.error("panel refresh failed:", p.id, e); }
    }
  }
}

/* ------------ 起動 ------------ */
client.login(process.env.DISCORD_TOKEN);
