const { createBot, Webhook } = require("@warriorteam/zalo-bot-sdk");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const TOKEN = "YOUR_BOT_TOKEN";

// 1. Khởi tạo SDK và tạo lớp bọc tương thích với toàn bộ file trong commands/
const sdkBot = createBot(TOKEN);

const bot = {
	token: TOKEN,
	sdk: sdkBot,
	sendMessage: (chatId, text) => sdkBot.text(String(chatId), text),
	sendPhoto: (chatId, photoUrl, options = {}) =>
		sdkBot.photo(String(chatId), photoUrl, options.caption || ""),
	typing: chatId => sdkBot.typing(String(chatId)),
	sticker: (chatId, stickerId) => sdkBot.sticker(String(chatId), stickerId),
	broadcast: (chatIds, text) => sdkBot.broadcast(chatIds, text),
};

// 2. Tự động nạp tất cả file lệnh trong thư mục commands/
const commandsDir = path.join(__dirname, "commands");
const commandFiles = fs
	.readdirSync(commandsDir)
	.filter(file => file.endsWith(".js"));

const allCommands = [];
for (const file of commandFiles) {
	const command = require(path.join(commandsDir, file));
	allCommands.push(command);
	console.log(`✅ Đã nạp lệnh: ${command.name}`);
}

// 3. Định nghĩa các bộ lắng nghe sự kiện của SDK mới
const handlers = {
	"message.text.received": async event => {
		const msg = event.message;
		const chatId = msg.chat.id;
		const text = (msg.text || "").trim();

		if (!text) return;

		// Tìm lệnh khớp với regex
		const matchedCmd = allCommands.find(cmd => cmd.regex.test(text));

		if (matchedCmd) {
			const match = text.match(matchedCmd.regex);
			try {
				await bot.typing(chatId); // Hiện trạng thái đang nhập cho đẹp
				await matchedCmd.execute(bot, msg, match, allCommands);
			} catch (err) {
				console.error(`Lỗi khi chạy lệnh ${matchedCmd.name}:`, err.message);
				await bot.sendMessage(chatId, "❌ Có lỗi xảy ra khi xử lý lệnh này.");
			}
			return;
		}

		// Nếu gõ bắt đầu bằng "/" nhưng không khớp lệnh nào
		if (text.startsWith("/")) {
			await bot.sendMessage(
				chatId,
				"❓ Không tìm thấy lệnh này. Nhắn /help để xem danh sách lệnh.",
			);
		}
	},

	"message.image.received": async event => {
		const chatId = event.message.chat.id;
		console.log("📷 Nhận ảnh từ", chatId, event.message);
	},

	"message.sticker.received": async event => {
		const chatId = event.message.chat.id;
		// Gửi lại đúng sticker người dùng vừa gửi (hoặc bỏ đi nếu không cần)
		if (event.message.sticker) {
			await bot.sticker(chatId, event.message.sticker);
		}
	},
};

// 4. Khởi chạy Long Polling
async function start() {
	try {
		await Webhook.deleteWebhook(TOKEN);
		console.log(`🚀 Zalo Bot đang chạy với ${allCommands.length} lệnh...`);
		await Webhook.startPolling(TOKEN, handlers, {
			timeout: 30,
			interval: 1000,
		});
	} catch (err) {
		console.error("Lỗi khởi chạy bot:", err.message);
	}
}

start();

// 5. Giữ nguyên phần Cron Job EVN của bạn ở dưới đây (nếu có)
// const evn = require("./commands/evn");
// cron.schedule("0 7 * * *", async () => { ... }, { timezone: "Asia/Ho_Chi_Minh" });
