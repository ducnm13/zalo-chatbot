const axios = require("axios");
const https = require("https");

const insecureAgent = new https.Agent({ rejectUnauthorized: false });
const URL = "https://webgia.com/gia-xang-dau/petrolimex/";

function cleanText(html) {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

module.exports = {
	name: "/xang",
	description: "Xem giá xăng dầu Petrolimex hôm nay (Vùng 1 & Vùng 2)",
	regex: /^\/xang$/i,

	async execute(bot, msg) {
		const chatId = String(msg.chat.id);

		try {
			const res = await axios.get(URL, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
				},
				timeout: 15000,
				httpsAgent: insecureAgent,
			});

			const html = typeof res.data === "string" ? res.data : "";
			const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
			if (!tableMatch) {
				return bot.sendMessage(
					chatId,
					`⚠️ Không đọc được bảng giá xăng.\n🔗 ${URL}`,
				);
			}

			const rows = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
			const items = [];

			for (const row of rows) {
				const cells = [
					...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi),
				].map(c => cleanText(c[1]));
				// Bỏ qua dòng tiêu đề, chỉ lấy dòng có tên xăng/dầu và giá số
				if (cells.length >= 3 && /\d/.test(cells[1])) {
					const name = cells[0];
					const vung1 = cells[1];
					const vung2 = cells[2];
					items.push(`• **${name}**: ${vung1} | V2: ${vung2}`);
				}
			}

			if (items.length === 0) {
				return bot.sendMessage(
					chatId,
					`⚠️ Chưa lấy được dữ liệu giá xăng.\n🔗 ${URL}`,
				);
			}

			const reply =
				`⛽ **GIÁ XĂNG DẦU PETROLIMEX**\n` +
				`_(Đơn vị: đồng/lít — Vùng 1 | Vùng 2)_\n\n` +
				items.slice(0, 8).join("\n") +
				`\n\n🔗 ${URL}`;

			return bot.sendMessage(chatId, reply, { parse_mode: "markdown" });
		} catch (err) {
			console.error("Lỗi /xang:", err.message);
			return bot.sendMessage(chatId, `❌ Lỗi lấy giá xăng: ${err.message}`);
		}
	},
};
