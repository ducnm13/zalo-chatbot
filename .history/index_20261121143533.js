const ZaloBot = require("node-zalo-bot");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const evn = require("./commands/evn");
require("dotenv").config({ path: path.join(__dirname, ".env") });\
const nhac = require("./commands/nhac");


const TOKEN = process.env.TOKEN || "";

const bot = new ZaloBot(TOKEN, {
	polling: {
		interval: 1000,
		autoStart: true,
	},
});

// 1. Bỏ qua lỗi timeout 408 (bình thường của Long Polling)
bot.on("polling_error", error => {
	if (error.message && error.message.includes("408")) return;
	console.error("Polling error:", error.code, error.message);
});

// 2. Tự động nạp tất cả file .js trong thư mục commands/
const commandsDir = path.join(__dirname, "commands");
const commandFiles = fs
	.readdirSync(commandsDir)
	.filter(file => file.endsWith(".js"));

const allCommands = [];

for (const file of commandFiles) {
	const command = require(path.join(commandsDir, file));
	allCommands.push(command);

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

// 3. Báo lỗi khi gõ lệnh "/" không tồn tại
bot.on("text", async msg => {
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
// nhắc nhở
nhac.startLoop(bot);

// 4. Cron Job tự động kiểm tra lịch cúp điện EVNSPC lúc 07:00 sáng mỗi ngày
cron.schedule(
	"0 7 * * *",
	async () => {
		console.log("⏰ Đang chạy cron kiểm tra lịch cúp điện EVNSPC...");
		const users = evn.loadUsers();

		for (const chatId of Object.keys(users)) {
			const list = evn.getUserCodes(chatId);
			const alerts = [];

			for (const item of list) {
				try {
					const { hasSchedule, donVi, entries } = await evn.checkLichCupDien(
						item.code,
						3,
					);

					if (hasSchedule) {
						const title = item.name
							? `**${evn.escapeMarkdown(item.name)}** _(${item.code})_`
							: `**${item.code}**`;

						const details = entries
							.map(
								(e, i) =>
									`🔸 **Lịch ${i + 1}:**\n` +
									`• ⏰ ${evn.escapeMarkdown(e.thoiGian)}\n` +
									`• 📍 ${evn.escapeMarkdown(e.khuVuc)}\n` +
									`• 🔧 ${evn.escapeMarkdown(e.lyDo)}`,
							)
							.join("\n\n");

						alerts.push(
							`⚡ ${title}\n` +
								(donVi ? `🏢 Đơn vị: _${evn.escapeMarkdown(donVi)}_\n` : "") +
								`\n${details}`,
						);
					}
				} catch (err) {
					console.error(`Lỗi cron EVN cho mã ${item.code}:`, err.message);
				}
			}

			if (alerts.length > 0) {
				try {
					await bot.sendMessage(
						chatId,
						`🔔 **CẢNH BÁO LỊCH CẮT ĐIỆN TỰ ĐỘNG**\n\n${alerts.join("\n\n──────────────\n\n")}`,
						{ parse_mode: "markdown" },
					);
				} catch (sendErr) {
					console.error(
						`Không gửi được cảnh báo cho ${chatId}:`,
						sendErr.message,
					);
				}
			}
		}
	},
	{ timezone: "Asia/Ho_Chi_Minh" },
);

console.log(`🚀 Zalo Bot đang chạy với ${allCommands.length} lệnh...`);
