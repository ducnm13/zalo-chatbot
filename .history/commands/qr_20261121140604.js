const axios = require("axios");

// 1. Cấu hình thông tin ngân hàng của bạn
const BANK_ID = "MB";
const ACCOUNT_NO = "0123456789";
const ACCOUNT_NAME = "NGUYEN VAN A";

// 2. Nếu bot.token không có sẵn, điền dự phòng BOT_TOKEN vào đây
const FALLBACK_TOKEN = "YOUR_BOT_TOKEN";

// Chuyển đổi 50k -> 50000, 1.5tr -> 1500000
function parseAmount(token) {
	if (!token) return null;
	const clean = token.toLowerCase().replace(/,/g, "");
	const match = clean.match(/^(\d+(?:\.\d+)?)(k|tr|m)?$/);
	if (!match) return null;

	let value = parseFloat(match[1]);
	const unit = match[2];
	if (unit === "k") value *= 1000;
	if (unit === "tr" || unit === "m") value *= 1000000;

	return Math.round(value);
}

module.exports = {
	name: "/qr",
	description: "Tạo nhanh mã VietQR chuyển khoản",
	regex: /^\/qr(?:\s+(.*))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const rawArgs = (match[1] || "").trim();

		if (!rawArgs) {
			return bot.sendMessage(
				chatId,
				"ℹ️ **Cách dùng lệnh /qr:**\n• `/qr 50k tiền cà phê`\n• `/qr 1.5tr thanh toán`\n• `/qr nội dung chuyển khoản`",
				{ parse_mode: "markdown" },
			);
		}

		const parts = rawArgs.split(/\s+/);
		const parsedAmount = parseAmount(parts[0]);

		let amount = 0;
		let info = rawArgs;

		if (parsedAmount !== null) {
			amount = parsedAmount;
			info = parts.slice(1).join(" ");
		}

		const params = new URLSearchParams();
		if (amount > 0) params.append("amount", String(amount));
		if (info) params.append("addInfo", info);
		if (ACCOUNT_NAME) params.append("accountName", ACCOUNT_NAME);

		// Link HTTPS trực tiếp tới ảnh PNG của VietQR
		const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.png?${params.toString()}`;

		const caption = (
			`💳 MÃ VIETQR CHUYỂN KHOẢN\n` +
			`• Ngân hàng: ${BANK_ID} - ${ACCOUNT_NO}\n` +
			(amount > 0 ? `• Số tiền: ${amount.toLocaleString("vi-VN")} đ\n` : "") +
			(info ? `• Nội dung: ${info}` : "")
		).slice(0, 2000); // Đảm bảo đúng giới hạn 1-2000 ký tự của Zalo

		const token = bot.token || process.env.BOT_TOKEN || FALLBACK_TOKEN;
		const entrypoint = `https://bot-api.zaloplatforms.com/bot${token}/sendPhoto`;

		try {
			await axios.post(
				entrypoint,
				{
					chat_id: chatId,
					photo: qrUrl,
					caption: caption,
				},
				{ timeout: 15000 },
			);
		} catch (err) {
			console.error("Lỗi sendPhoto:", err.response?.data || err.message);
			await bot.sendMessage(chatId, `${caption}\n\n🔗 ${qrUrl}`);
		}
	},
};
