// clear-commands.js
import "dotenv/config";
import { REST, Routes } from "discord.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
const route = Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);

const before = await rest.get(route);
console.log("Before:", before.map(c => c.name));

for (const cmd of before) {
  await rest.delete(`${route}/${cmd.id}`);
  console.log("Deleted:", cmd.name);
}

const after = await rest.get(route);
console.log("After:", after.map(c => c.name));
