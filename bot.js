// bot.js
import "./web.js"; // Koyeb用の軽量HTTPサーバ
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Colors,
  ChannelType,
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
import {
  loadNotify,
  getChannelId as getNotifyChannelId,
  setChannelId as setNotifyChannelId,
  addRule as addNotifyRule,
  removeRule as removeNotifyRule,
  listRules as listNotifyRules,
  updateRuleState,
} from "./notifyStore.js";

/* =========================
 * Paint回復計算ヘルパー
 * ========================= */
const RECOVER_PER_UNIT_SEC = 30;

function calcFullRecovery(paintCurrent, paintMax) {
  const cur = Number(paintCurrent ?? 0);
  const max = Number(paintMax ?? 0);
  const missing = Math.max(0, max - cur);
  const seconds = missing * RECOVER_PER_UNIT_SEC;
  const eta = new Date(Date.now() + seconds * 1000);
  return { missing, seconds, eta };
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
  return (
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt) + " JST"
  );
}

/* =========================
 * Discord クライアント
 * ========================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  resumeAllPanels();
  startNotifyScheduler();
});

/* =========================
 * Embed & ボタン生成
 * ========================= */
function buildEmbedsForAccounts(results, { hideErrors = false } = {}) {
  const embeds = results
    .map((r) => {
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
            {
              name: "Paint",
              value: `${Number(me.paintCurrent).toLocaleString()} / ${Number(me.paintMax).toLocaleString()}`,
              inline: true,
            },
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
        const body =
          typeof err?.response?.data === "object"
            ? JSON.stringify(err.response.data)
            : String(err?.response?.data ?? err?.message ?? err);
        return new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle("取得失敗")
          .addFields(
            { name: "Status", value: String(status), inline: true },
            { name: "Detail", value: body.slice(0, 1000) || "（詳細なし）" }
          );
      }
    })
    .filter(Boolean);

  if (embeds.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(Colors.Grey)
        .setTitle("表示できるアカウントがありません")
        .setDescription("取得に成功したアカウントがないか、未登録です。")
        .setTimestamp(new Date())
    );
  }

  return embeds;
}

/** 各アカウント用「トークン更新」ボタン（1アカウント1ボタン） */
function buildTokenButtons(results) {
  const buttons = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { a } = r.value;
    const labelText = a.mode === "cookie" ? `Cookie更新（${a.label}）` : `Bearer更新（${a.label}）`;
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`token:update:${a.mode}:${a.label}`)
        .setLabel(labelText)
        .setStyle(ButtonStyle.Primary)
    );
  }
  // 5個ずつ1行に並べる
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

/**
 * 指定ラベル群のアカウントを取得（nullなら全件）
 * 同一 userId は 1 件に統合（bearer 登録があればそちらを優先）
 */
async function fetchForLabels(labels) {
  const accounts = loadAccounts();
  const targets = labels?.length ? accounts.filter((a) => labels.includes(a.label)) : accounts;
  const use = targets.slice(0, 20);

  const settled = await Promise.allSettled(
    use.map(async (a) => {
      const me = await fetchMe(a.token, a.mode);
      const needed = calcNextLevelPixels(me.level, me.pixelsPainted);
      return { a, me, needed };
    })
  );

  const dedup = [];
  const indexByKey = new Map(); // key = userId or name -> index

  for (const r of settled) {
    if (r.status !== "fulfilled") {
      dedup.push(r);
      continue;
    }
    const { a, me } = r.value;
    const key = me.userId ?? me.name;

    if (!indexByKey.has(key)) {
      indexByKey.set(key, dedup.length);
      dedup.push(r);
      continue;
    }

    const idx = indexByKey.get(key);
    const prev = dedup[idx];
    const prevMode = prev.status === "fulfilled" ? prev.value.a.mode : null;
    const curMode = a.mode;

    if (prevMode !== "bearer" && curMode === "bearer") {
      dedup[idx] = r;
    }
  }

  return { results: dedup, count: dedup.length };
}

/* =========================
 * /wplace コマンド
 * ========================= */
client.on("interactionCreate", async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === "wplace") {
        const sub = i.options.getSubcommand();

        if (sub === "add") {
          const label = i.options.getString("label", true);
          const mode = i.options.getString("mode", true).toLowerCase();
          const token = i.options.getString("token", true);
          if (!["cookie", "bearer"].includes(mode)) {
            return i.reply({ content: "mode は cookie | bearer のどちらかです。", ephemeral: true });
          }
          try {
            addAccount({ label, token, mode });
          } catch (e) {
            return i.reply({ content: `❌ ${e.message}`, ephemeral: true });
          }
          return i.reply({ content: `✅ 追加しました：**${label}** (${mode})`, ephemeral: true });
        }

        if (sub === "list") {
          const accounts = loadAccounts();
          if (!accounts.length) return i.reply("（登録なし）");
          const lines = accounts.map((a) => `• **${a.label}** (${a.mode})`);
          return i.reply(lines.join("\n"));
        }

        if (sub === "remove") {
          const label = i.options.getString("label", true);
          try {
            removeAccount(label);
            return i.reply(`🗑️ 削除しました：**${label}**`);
          } catch (e) {
            return i.reply({ content: `❌ ${e.message}`, ephemeral: true });
          }
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

      if (i.commandName === "panel") {
        const sub = i.options.getSubcommand();

        if (sub === "start") {
          await i.deferReply({ ephemeral: true });
          const intervalMin = i.options.getInteger("interval", true);
          const labelsStr = i.options.getString("labels") || "";
          const labels = labelsStr ? labelsStr.split(",").map((s) => s.trim()).filter(Boolean) : null;
          const targetChannel = i.options.getChannel("channel") || i.channel;

          if (!targetChannel?.isTextBased?.()) {
            return i.editReply("❌ このチャンネルには投稿できません（テキストチャンネルを指定してください）。");
          }

          const { results } = await fetchForLabels(labels);
          const embeds = buildEmbedsForAccounts(results, { hideErrors: true });
          const components = buildTokenButtons(results);
          const message = await targetChannel.send({
            content: "Wplace パネル（準備中）",
            embeds,
            components,
          });

          const panelId = `${message.channelId}:${message.id}`;
          const panel = {
            id: panelId,
            channelId: message.channelId,
            messageId: message.id,
            labels, // null = 全件
            intervalSec: Math.max(60, intervalMin * 60),
          };
          addPanel(panel);

          await message.edit({
            content: `Wplace パネル（${panelId}）`,
            embeds,
            components,
          });

          schedulePanel(panel);

          return i.editReply(`✅ パネル開始: \`${panel.id}\`（${intervalMin}分間隔 / 投稿先: <#${panel.channelId}>）`);
        }

        if (sub === "list") {
          const panels = loadPanels();
          if (!panels.length) return i.reply("（稼働中パネルなし）");
          const lines = panels.map(
            (p) =>
              `• \`${p.id}\` interval=${Math.round(p.intervalSec / 60)}分 labels=${p.labels?.join(",") || "(all)"} / channel=<#${p.channelId}>`
          );
          return i.reply(lines.join("\n"));
        }

        if (sub === "stop") {
          await i.deferReply({ ephemeral: true });
          const id = i.options.getString("id", true);
          stopOne(id);
          removePanel(id);
          return i.editReply(`🛑 停止: \`${id}\``);
        }

        if (sub === "refresh") {
          await i.deferReply({ ephemeral: true });
          const id = i.options.getString("id", true);
          await runOnce(id);
          return i.editReply(`🔄 リフレッシュ済み: \`${id}\``);
        }
      }

      if (i.commandName === "notify") {
        const sub = i.options.getSubcommand();

        if (sub === "channel") {
          const ch = i.options.getChannel("channel", true);
          if (!ch?.isTextBased?.()) {
            return i.reply({ content: "❌ テキストチャンネルを指定してください。", ephemeral: true });
          }
          setNotifyChannelId(ch.id);
          return i.reply({ content: `✅ 通知チャンネルを <#${ch.id}> に設定しました。`, ephemeral: true });
        }

        if (sub === "add_full") {
          const label = i.options.getString("label", true);
          if (!loadAccounts().some((a) => a.label === label)) {
            return i.reply({ content: "❌ その label は未登録です。/wplace add で追加してください。", ephemeral: true });
          }
          const rec = addNotifyRule({ label, type: "full" });
          return i.reply({ content: `✅ 追加: 満タン通知 id=\`${rec.id}\` label=\`${label}\``, ephemeral: true });
        }

        if (sub === "add_before_full") {
          const label = i.options.getString("label", true);
          const minutes = i.options.getInteger("minutes", true);
          if (!loadAccounts().some((a) => a.label === label)) {
            return i.reply({ content: "❌ その label は未登録です。/wplace add で追加してください。", ephemeral: true });
          }
          const rec = addNotifyRule({ label, type: "before_full", minutes });
          return i.reply({ content: `✅ 追加: 満タン${minutes}分前通知 id=\`${rec.id}\` label=\`${label}\``, ephemeral: true });
        }

        if (sub === "add_threshold") {
          const label = i.options.getString("label", true);
          const value = i.options.getInteger("value", true);
          if (!loadAccounts().some((a) => a.label === label)) {
            return i.reply({ content: "❌ その label は未登録です。/wplace add で追加してください。", ephemeral: true });
          }
          const rec = addNotifyRule({ label, type: "threshold", threshold: value });
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
          try {
            removeNotifyRule(id);
            return i.reply({ content: `🗑️ 削除: \`${id}\``, ephemeral: true });
          } catch (e) {
            return i.reply({ content: `❌ ${e.message}`, ephemeral: true });
          }
        }
      }
    }

    // ===== ボタン → モーダル表示 =====
    if (i.isButton()) {
      const parts = i.customId.split(":");
      if (parts[0] === "token" && parts[1] === "update") {
        const mode = parts[2]; // cookie | bearer
        const label = parts.slice(3).join(":"); // labelに:が入る保険
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

    // ===== モーダル送信 → 検証して保存 =====
    if (i.isModalSubmit()) {
      if (i.customId.startsWith("tokenmodal:")) {
        const [, mode, label] = i.customId.split(":");
        const token = i.fields.getTextInputValue("token").trim();
        await i.deferReply({ ephemeral: true });
        try {
          // まず検証（成功したら保存）
          const me = await fetchMe(token, mode);
          updateTokenByLabel(label, token);
          await i.editReply(
            `✅ **${label}** の ${mode === "cookie" ? "Cookie" : "Bearer"} を更新しました。\n` +
              `検証OK：アカウント名 **${me.name}**`
          );
          // 対象ラベルを含むパネルを即時更新
          await refreshPanelsForLabel(label);
        } catch (e) {
          const status = e?.response?.status ? `HTTP ${e.response.status}` : "";
          const detail =
            typeof e?.response?.data === "object"
              ? JSON.stringify(e.response.data)
              : e?.message || "検証に失敗しました。";
          await i.editReply(`❌ 更新できませんでした。${status}\n${detail.slice(0, 500)}`);
        }
      }
    }
  } catch (err) {
    console.error(err);
    if (i.deferred || i.replied) return i.editReply("エラーが発生しました。ログを確認してください。");
    return i.reply({ content: "エラーが発生しました。", ephemeral: true });
  }
});

/* =========================
 * パネル用スケジューラ
 * ========================= */
const timers = new Map(); // id -> Interval

function resumeAllPanels() {
  const panels = loadPanels();
  for (const p of panels) schedulePanel(p);
}

function schedulePanel(panel) {
  stopOne(panel.id);
  const fn = async () => {
    try {
      await runOnce(panel.id);
    } catch (e) {
      console.error("panel run error:", e);
    }
  };
  fn(); // すぐ1回
  const t = setInterval(fn, panel.intervalSec * 1000);
  timers.set(panel.id, t);
}

function stopOne(id) {
  const t = timers.get(id);
  if (t) {
    clearInterval(t);
    timers.delete(id);
  }
}

async function runOnce(id) {
  const panels = loadPanels();
  const p = panels.find((x) => x.id === id);
  if (!p) throw new Error("panel not found");

  const channel = await client.channels.fetch(p.channelId);
  if (!channel?.isTextBased()) throw new Error("channel not found or not text");
  const msg = await channel.messages.fetch(p.messageId);

  const { results } = await fetchForLabels(p.labels);
  const embeds = buildEmbedsForAccounts(results, { hideErrors: true });
  const components = buildTokenButtons(results);
  await msg.edit({ content: `Wplace パネル（${p.id}）`, embeds, components });
}

/** 指定ラベルを含むパネルを片っ端から更新 */
async function refreshPanelsForLabel(label) {
  const panels = loadPanels();
  for (const p of panels) {
    if (!p.labels || p.labels.includes(label)) {
      try {
        await runOnce(p.id);
      } catch (e) {
        console.error("panel refresh failed:", p.id, e);
      }
    }
  }
}

/* =========================
 * 通知スケジューラ（既存）
 * ========================= */
let notifyTimer = null;

function startNotifyScheduler() {
  if (notifyTimer) clearInterval(notifyTimer);
  const tick = async () => {
    try {
      await runNotifyTick();
    } catch (e) {
      console.error("notify tick error:", e);
    }
  };
  notifyTimer = setInterval(tick, 60 * 1000); // 60秒おき
  tick();
}

async function runNotifyTick() {
  const notify = loadNotify();
  const rules = notify.rules.filter((r) => r.enabled !== false);
  if (!rules.length) return;

  const accounts = loadAccounts();
  const byLabel = new Map(accounts.map((a) => [a.label, a]));
  const labels = [...new Set(rules.map((r) => r.label))].filter((l) => byLabel.has(l));
  if (!labels.length) return;

  const results = await Promise.allSettled(
    labels.map(async (label) => {
      const a = byLabel.get(label);
      const me = await fetchMe(a.token, a.mode);
      const { seconds } = calcFullRecovery(me.paintCurrent, me.paintMax);
      return { label, me, etaSec: Math.floor(seconds) };
    })
  );

  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) return;

  const channelId = getNotifyChannelId();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.error("notify: invalid channel", channelId);
    return;
  }

  for (const { label, me, etaSec } of ok) {
    const labelRules = rules.filter((r) => r.label === label);
    for (const rule of labelRules) {
      try {
        const fired = await maybeFireRule(channel, rule, { me, etaSec, label });
        if (fired) updateRuleState(rule.id, { lastFiredAt: Date.now() });
      } catch (e) {
        console.error("notify rule error:", rule.id, e);
      }
    }
  }
}

function fmtEta(etaSec) {
  let s = Math.max(0, etaSec | 0);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (h) parts.push(`${h}時間`);
  if (m) parts.push(`${m}分`);
  if (!parts.length) parts.push(`${s}秒`);
  return parts.join(" ");
}

async function maybeFireRule(channel, rule, ctx) {
  const { me, etaSec, label } = ctx;
  const cur = Number(me.paintCurrent ?? 0);
  const max = Number(me.paintMax ?? 0);
  const name = String(me.name ?? "Unknown");
  const last = rule.state?.lastPaint;
  const lastEta = rule.state?.lastEtaSec;

  let shouldFire = false;
  let message = "";

  if (rule.type === "full") {
    if (last != null && last < max && cur >= max) {
      shouldFire = true;
      message = `🔔 **Paint満タン**：**${name}**（label: \`${label}\`）\n現在 **${cur.toLocaleString()} / ${max.toLocaleString()}** になりました。`;
    }
  }

  if (rule.type === "before_full") {
    const target = Number(rule.minutes ?? 0) * 60;
    if (lastEta != null && lastEta > target && etaSec <= target && cur < max) {
      const etaText = fmtJST(new Date(Date.now() + etaSec * 1000));
      shouldFire = true;
      message = `⏰ **満タン${rule.minutes}分前**：**${name}**（label: \`${label}\`）\n満タンまで **${fmtEta(etaSec)}**（予定: ${etaText}） 現在 **${cur.toLocaleString()} / ${max.toLocaleString()}**`;
    }
  }

  if (rule.type === "threshold") {
    const t = Number(rule.threshold ?? 0);
    if (last != null && last < t && cur >= t) {
      shouldFire = true;
      message = `🟦 **しきい値到達**：**${name}**（label: \`${label}\`）\nPaint が **${t.toLocaleString()}** に到達（現在 **${cur.toLocaleString()} / ${max.toLocaleString()}**）。`;
    }
  }

  updateRuleState(rule.id, { lastPaint: cur, lastEtaSec: etaSec });
  if (!shouldFire) return false;
  await channel.send(message);
  return true;
}

client.login(process.env.DISCORD_TOKEN);
