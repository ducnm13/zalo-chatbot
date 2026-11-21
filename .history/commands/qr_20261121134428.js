// Cấu hình thông tin ngân hàng của bạn (Mã ngân hàng theo VietQR: VCB, MB, TCB, ACB, BIDV, VPB, TPB, ICB...)
const BANK_ID = "MB";
const ACCOUNT_NO = "0123456789";
const ACCOUNT_NAME = "NGUYEN VAN A";

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
		const chatId = msg.chat.id;
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

		const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.png?${params.toString()}`;

		const caption =
			`💳 **MÃ VIETQR CHUYỂN KHOẢN**\n` +
			`• Ngân hàng: **${BANK_ID}** - \`${ACCOUNT_NO}\`\n` +
			(amount > 0
				? `• Số tiền: **${amount.toLocaleString("vi-VN")} đ**\n`
				: "") +
			(info ? `• Nội dung: _${info}_` : "");

		const entrypoint = `https://bot-api.zaloplatforms.com/bot${process.env.TOKEN}/sendPhoto`;
		const response = await axios.post(entrypoint, {
			chat_id: chatId,
			caption: "Mã chuyển khoản",
			photo: qrUrl,
		});

		try {
			// Gửi trực tiếp dưới dạng ảnh nếu thư viện hỗ trợ sendPhoto
			if (typeof bot.sendPhoto === "function") {
				await bot.sendPhoto(chatId, qrUrl, { caption });
			} else {
				await bot.sendMessage(chatId, `${caption}\n\n🔗 ${qrUrl}`, {
					parse_mode: "markdown",
				});
			}
		} catch (err) {
			console.error("Lỗi gửi ảnh QR, chuyển sang gửi link:", err.message);
			await bot.sendMessage(chatId, `${caption}\n\n🔗 ${qrUrl}`, {
				parse_mode: "markdown",
			});
		}
	},
};
