const ZaloBot = require("node-zalo-bot");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKEN = process.env.TOKEN;
const bot = new ZaloBot(TOKEN, {
	polling: { interval: 1000, autoStart: true },
});

// Bỏ qua lỗi timeout 408 của polling
bot.on("polling_error", error => {
	if (error.message && error.message.includes("408")) return;
	console.error("Polling error:", error.code, error.message);
});
// Tự động đọc tất cả file .js trong thư mục commands/
const commandsDir = path.join(__dirname, "commands");
const commandFiles = fs
	.readdirSync(commandsDir)
	.filter(file => file.endsWith(".js"));

const allCommands = [];

for (const file of commandFiles) {
	const command = require(path.join(commandsDir, file));
	allCommands.push(command);

	// Đăng ký regex của từng lệnh với bot
	bot.onText(command.regex, async (msg, match) => {
		try {
			await command.execute(bot, msg, match, allCommands);
		} catch (err) {
			console.error(`Lỗi khi chạy lệnh ${command.name}:`, err);
			await bot.sendMessage(
				msg.chat.id,
				"❌ Có lỗi xảy ra khi xử lý lệnh này.",
			);
		}
	});

	console.log(`✅ Đã nạp lệnh: ${command.name}`);
}

// Xử lý khi người dùng gõ lệnh không tồn tại (bắt đầu bằng "/")
bot.on("message", async msg => {
	const text = msg.text?.trim();
	if (!text || !text.startsWith("/")) return;

	const isKnownCommand = allCommands.some(cmd => cmd.regex.test(text));
	if (!isKnownCommand) {
		await bot.sendMessage(
			msg.chat.id,
			"❓ Không tìm thấy lệnh này. Nhắn `/help` để xem danh sách lệnh.",
			{ parse_mode: "markdown" },
		);
	}
});

console.log(`🚀 Zalo Bot đang chạy với ${allCommands.length} lệnh...`);
