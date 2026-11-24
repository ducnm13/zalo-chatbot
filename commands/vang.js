const axios = require("axios");
const https = require("https");
const { Impit } = require("impit");

const insecureAgent = new https.Agent({ rejectUnauthorized: false });
const impitClient = new Impit({ browser: "chrome" });

const BRANDS = {
	nt: {
		name: "NGỌC THẨM",
		url: "https://webgia.com/gia-vang/ngoc-tham/",
	},
	pnj: {
		name: "PNJ",
		url: "https://webgia.com/gia-vang/pnj/",
	},
};

function cleanText(html) {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

async function fetchHtml(url) {
	try {
		const res = await axios.get(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
				"Accept-Language": "vi-VN,vi;q=0.9",
			},
			timeout: 15000,
			httpsAgent: insecureAgent,
		});
		return typeof res.data === "string" ? res.data : "";
	} catch (err) {
		if (err.response?.status === 403) {
			const res = await impitClient.fetch(url, {
				headers: { "Accept-Language": "vi-VN,vi;q=0.9" },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.text();
		}
		throw err;
	}
}

module.exports = {
	name: "/vang",
	description: "Xem giá vàng Ngọc Thẩm hoặc PNJ (VD: /vang nt, /vang pnj)",
	regex: /^\/vang(?:\s+(\S+))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const arg = (match[1] || "nt").toLowerCase();

		const brand = BRANDS[arg];
		if (!brand) {
			return bot.sendMessage(
				chatId,
				"ℹ️ **Cách dùng lệnh /vang:**\n" +
					"• Ngọc Thẩm: `/vang nt` (hoặc `/vang`)\n" +
					"• PNJ: `/vang pnj`",
				{ parse_mode: "markdown" },
			);
		}

		try {
			const html = await fetchHtml(brand.url);
			if (!html) {
				return bot.sendMessage(
					chatId,
					`⚠️ Không tải được trang giá vàng ${brand.name}.\n🔗 ${brand.url}`,
				);
			}

			const timeMatch = html.match(/Cập nhật lúc\s*([0-9:]+\s+[0-9/]+)/i);
			const updated = timeMatch ? timeMatch[1].trim() : "";

			const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(
				m => m[0],
			);
			const goldTable =
				tables.find(t => /Loại vàng/i.test(t) && /Mua vào/i.test(t)) ||
				tables[0];

			if (!goldTable) {
				return bot.sendMessage(
					chatId,
					`⚠️ Không tìm thấy bảng giá vàng ${brand.name}.\n🔗 ${brand.url}`,
				);
			}

			const rows = [...goldTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
			const items = [];

			for (const row of rows) {
				const cells = [
					...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi),
				].map(c => cleanText(c[1]));

				// Bảng PNJ có thể có 4 cột ở dòng đầu mỗi khu vực: [Khu vực, Loại vàng, Mua, Bán]
				if (cells.length >= 4 && /\d/.test(cells[2])) {
					const [area, type, buy, sell] = cells;
					items.push(
						`📍 _${area}_\n• **${type}**\n  Mua: ${buy} | Bán: ${sell}`,
					);
				} else if (cells.length >= 3 && /\d/.test(cells[1])) {
					const [type, buy, sell] = cells;
					items.push(`• **${type}**\n  Mua: ${buy} | Bán: ${sell}`);
				}
			}

			if (items.length === 0) {
				return bot.sendMessage(
					chatId,
					`⚠️ Chưa đọc được dữ liệu giá vàng ${brand.name}.\n🔗 ${brand.url}`,
				);
			}

			const reply =
				`🪙 **GIÁ VÀNG ${brand.name}**\n` +
				(updated ? `🕒 Cập nhật: _${updated}_\n` : "") +
				`\n` +
				items.slice(0, 12).join("\n") +
				`\n\n🔗 ${brand.url}`;

			return bot.sendMessage(chatId, reply, { parse_mode: "markdown" });
		} catch (err) {
			console.error(`Lỗi /vang ${arg}:`, err.message);
			return bot.sendMessage(chatId, `❌ Lỗi lấy giá vàng: ${err.message}`);
		}
	},
};
