// deploy-commands.js
import "dotenv/config";
import { REST, Routes, SlashCommandBuilder, ChannelType } from "discord.js";

function logEnv() {
  console.log("CLIENT_ID:", process.env.CLIENT_ID);
  console.log("GUILD_ID :", process.env.GUILD_ID);
  console.log("TOKEN    :", (process.env.DISCORD_TOKEN || "").slice(0, 8) + "...");
}

/* ===== /wplace ===== */
const wplace = new SlashCommandBuilder()
  .setName("wplace")
  .setDescription("Wplace アカウント管理")
  .addSubcommand(sc =>
    sc.setName("add")
      .setDescription("アカウントを追加")
      .addStringOption(o => o.setName("label").setDescription("識別名").setRequired(true))
      .addStringOption(o => o.setName("mode").setDescription("cookie|bearer").setRequired(true))
      .addStringOption(o => o.setName("token").setDescription("Cookie j または Bearer").setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName("list")
      .setDescription("登録済みアカウント一覧")
  )
  .addSubcommand(sc =>
    sc.setName("me")
      .setDescription("アカウント情報を取得（省略時は全件）")
      .addStringOption(o => o.setName("label").setDescription("特定ラベルのみ"))
  )
  .addSubcommand(sc =>
    sc.setName("remove")
      .setDescription("アカウントを削除")
      .addStringOption(o => o.setName("label").setDescription("識別名").setRequired(true))
  );

/* ===== /panel ===== */
const panel = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("定期更新パネル")
  .addSubcommand(sc =>
    sc.setName("start")
      .setDescription("定期更新パネルを開始（投稿先はこのチャンネル or 指定チャンネル）")
      .addIntegerOption(o => o
        .setName("interval")
        .setDescription("更新間隔(分) 最小1")
        .setMinValue(1)
        .setRequired(true)
      )
      .addStringOption(o => o
        .setName("labels")
        .setDescription("カンマ区切り。1つだけ指定すれば“そのアカウントだけ”のパネルに")
      )
      .addChannelOption(o => o
        .setName("channel")
        .setDescription("投稿先（省略時はコマンド実行したチャンネル）")
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread
        )
      )
  )
  .addSubcommand(sc => sc.setName("list").setDescription("稼働中パネル一覧"))
  .addSubcommand(sc =>
    sc.setName("stop")
      .setDescription("パネルを停止")
      .addStringOption(o => o.setName("id").setDescription("panel ID").setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName("refresh")
      .setDescription("手動で即時更新")
      .addStringOption(o => o.setName("id").setDescription("panel ID").setRequired(true))
  );

/* ===== /notify =====
   - channel: 通知先チャンネルの設定/変更
   - add_full: 満タン到達で通知
   - add_before_full: 満タンのN分前で通知
   - add_threshold: PaintがT以上に到達したら通知
   - list/remove: ルール確認・削除
*/
const notify = new SlashCommandBuilder()
  .setName("notify")
  .setDescription("Wplace 通知")
  .addSubcommand(sc =>
    sc.setName("channel")
      .setDescription("通知先チャンネルを設定")
      .addChannelOption(o => o
        .setName("channel")
        .setDescription("通知を送るチャンネル")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
      )
  )
  .addSubcommand(sc =>
    sc.setName("add_full")
      .setDescription("満タン到達で通知")
      .addStringOption(o => o.setName("label").setDescription("対象ラベル").setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName("add_before_full")
      .setDescription("満タン N 分前で通知")
      .addStringOption(o => o.setName("label").setDescription("対象ラベル").setRequired(true))
      .addIntegerOption(o => o.setName("minutes").setDescription("分").setMinValue(1).setMaxValue(1440).setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName("add_threshold")
      .setDescription("Paint が T 以上に到達したら通知")
      .addStringOption(o => o.setName("label").setDescription("対象ラベル").setRequired(true))
      .addIntegerOption(o => o.setName("value").setDescription("T").setMinValue(0).setRequired(true))
  )
  .addSubcommand(sc =>
    sc.setName("list")
      .setDescription("通知ルール一覧")
      .addStringOption(o => o.setName("label").setDescription("ラベルで絞り込み"))
  )
  .addSubcommand(sc =>
    sc.setName("remove")
      .setDescription("通知ルールを削除")
      .addStringOption(o => o.setName("id").setDescription("ルールID").setRequired(true))
  );

const commands = [wplace.toJSON(), panel.toJSON(), notify.toJSON()];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    logEnv();

    const route = Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);

    const before = await rest.get(route);
    console.log("Before commands:", before.map(c => c.name));

    const result = await rest.put(route, { body: commands });
    console.log("PUT result names:", result.map(c => c.name));

    const after = await rest.get(route);
    console.log("After commands :", after.map(c => c.name));

    console.log("✅ Slash commands deployed to guild:", process.env.GUILD_ID);
  } catch (err) {
    console.error("❌ Deploy failed:");
    console.error(err?.data ?? err);
    process.exit(1);
  }
})();
