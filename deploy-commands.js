// deploy-commands.js
import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const TOKEN     = process.env.DISCORD_TOKEN;

if (!CLIENT_ID || !GUILD_ID || !TOKEN) {
  console.error("CLIENT_ID / GUILD_ID / DISCORD_TOKEN が .env にありません");
  process.exit(1);
}

const cmds = [];

/* /wplace */
cmds.push(new SlashCommandBuilder()
  .setName("wplace")
  .setDescription("Wplace アカウント操作")
  .addSubcommand(sc => sc
    .setName("add")
    .setDescription("アカウントを追加")
    .addStringOption(o => o.setName("label").setDescription("ラベル").setRequired(true))
    .addStringOption(o => o.setName("mode").setDescription("cookie | bearer").setRequired(true)
      .addChoices({ name: "cookie", value: "cookie" }, { name:"bearer", value:"bearer" }))
    .addStringOption(o => o.setName("token").setDescription("トークン").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("list")
    .setDescription("登録済みアカウント一覧"))
  .addSubcommand(sc => sc
    .setName("remove")
    .setDescription("アカウントを削除")
    .addStringOption(o => o.setName("label").setDescription("ラベル").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("me")
    .setDescription("アカウント情報を取得（省略時は全件）")
    .addStringOption(o => o.setName("label").setDescription("対象ラベル"))
  )
);

/* /panel */
cmds.push(new SlashCommandBuilder()
  .setName("panel")
  .setDescription("パネル管理")
  .addSubcommand(sc => sc
    .setName("start")
    .setDescription("このチャンネル（または指定先）にパネルを開始")
    .addIntegerOption(o => o.setName("interval").setDescription("更新分間隔（最小1）").setRequired(true))
    .addStringOption(o => o.setName("labels").setDescription("対象ラベルをカンマ区切りで"))
    .addChannelOption(o => o.setName("channel").setDescription("投稿先チャンネル"))
  )
  .addSubcommand(sc => sc
    .setName("list")
    .setDescription("稼働中パネル一覧"))
  .addSubcommand(sc => sc
    .setName("stop")
    .setDescription("パネルを停止")
    .addStringOption(o => o.setName("id").setDescription("panelId (channelId:messageId)").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("refresh")
    .setDescription("パネルを即時更新")
    .addStringOption(o => o.setName("id").setDescription("panelId").setRequired(true))
  )
);

/* /notify（必要なら） */
cmds.push(new SlashCommandBuilder()
  .setName("notify")
  .setDescription("通知設定")
  .addSubcommand(sc => sc
    .setName("channel")
    .setDescription("通知チャンネルを設定")
    .addChannelOption(o => o.setName("channel").setDescription("チャンネル").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("add_full")
    .setDescription("満タン時通知を追加")
    .addStringOption(o => o.setName("label").setDescription("ラベル").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("add_before_full")
    .setDescription("満タン◯分前通知を追加")
    .addStringOption(o => o.setName("label").setDescription("ラベル").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("分").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("add_threshold")
    .setDescription("しきい値通知を追加")
    .addStringOption(o => o.setName("label").setDescription("ラベル").setRequired(true))
    .addIntegerOption(o => o.setName("value").setDescription("Paint値").setRequired(true))
  )
  .addSubcommand(sc => sc
    .setName("list")
    .setDescription("通知一覧")
    .addStringOption(o => o.setName("label").setDescription("対象ラベル")))
  .addSubcommand(sc => sc
    .setName("remove")
    .setDescription("通知を削除")
    .addStringOption(o => o.setName("id").setDescription("通知ID").setRequired(true))
  )
);

/* /state */
cmds.push(new SlashCommandBuilder()
  .setName("state")
  .setDescription("状態の保存/復元")
  .addSubcommand(sc => sc.setName("save").setDescription("状態を保存"))
  .addSubcommand(sc => sc.setName("restore").setDescription("状態を復元"))
);

const commands = cmds.map(c => c.toJSON());

(async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    const before = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
    console.log("Before commands:", before.map(c => c.name));
    const data = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Deploy OK:", data.map(c => c.name));
  } catch (e) {
    console.error("❌ Deploy failed:", e);
    process.exit(1);
  }
})();
