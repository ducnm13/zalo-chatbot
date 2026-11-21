const axios = require("axios");
const https = require("https");
const { Impit } = require("impit");

const VN_OFFSET = 7 * 60 * 60 * 1000; // UTC+7
const MAX_ITEMS = 3; // Số mốc hành trình hiển thị tối đa

const insecureAgent = new https.Agent({ rejectUnauthorized: false });
const spxClient = new Impit({ browser: "chrome" });

const HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept-Language": "vi-VN,vi;q=0.9",
};

// Định dạng thời gian gọn: HH:mm DD/MM
function formatVNTime(unixSeconds) {
	if (!unixSeconds) return "";
	const ms = unixSeconds > 1e12 ? unixSeconds : unixSeconds * 1000;
	const d = new Date(ms + VN_OFFSET);
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
	return `${hh}:${mm} ${dd}/${mo}`;
}

// Tách trọn vẹn nội dung bên trong thẻ <div class="...className...">
function extractDivByClass(html, className) {
	const startRegex = new RegExp(
		`<div[^>]*class="[^"]*${className}[^"]*"[^>]*>`,
		"i",
	);
	const startMatch = startRegex.exec(html);
	if (!startMatch) return "";

	const startIndex = startMatch.index;
	const tagRegex = /<\/?div\b[^>]*>/gi;
	tagRegex.lastIndex = startIndex;

	let depth = 0;
	let match;
	while ((match = tagRegex.exec(html)) !== null) {
		if (match[0].startsWith("</")) {
			depth--;
			if (depth === 0) {
				return html.slice(startIndex, tagRegex.lastIndex);
			}
		} else {
			depth++;
		}
	}
	return html.slice(startIndex, startIndex + 15000);
}

// 1. Tra cứu Shopee Express (SPX)
async function checkSPX(code) {
	const url = `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${encodeURIComponent(code)}&language_code=vi`;
	const trackUrl = `https://spx.vn/track?${encodeURIComponent(code)}`;

	const res = await spxClient.fetch(url, {
		headers: {
			Accept: "application/json, text/plain, */*",
			"Accept-Language": "vi-VN,vi;q=0.9",
			Referer: "https://spx.vn/track",
			Origin: "https://spx.vn",
		},
	});

	if (res.status === 403) {
		return (
			`⚠️ SPX đang chặn truy cập tự động (403).\n` +
			`🔗 Xem trực tiếp: ${trackUrl}`
		);
	}

	if (!res.ok) {
		throw new Error(`SPX trả về mã lỗi ${res.status}`);
	}

	const data = await res.json();
	if (!data || data.retcode !== 0 || !data.data?.sls_tracking_info) {
		return `⚠️ Không tìm thấy vận đơn SPX **${code}**.`;
	}

	const records = data.data.sls_tracking_info.records || [];
	if (records.length === 0) {
		return `**SPX: ${code}**\nChưa có thông tin hành trình.\n🔗 ${trackUrl}`;
	}

	const lines = records.slice(0, MAX_ITEMS).map((r, i) => {
		const time = formatVNTime(r.actual_time);
		const desc = (
			r.buyer_description ||
			r.description ||
			"Đang cập nhật"
		).trim();
		const icon = i === 0 ? "-" : "-";
		return `${icon} **${time}**: ${desc}`;
	});

	return (
		`{yellow}**SPX: ${code}**{/yellow} (${lines.length}/${records.length})\n` +
		lines.join("\n") +
		`\n${trackUrl}`
	);
}

// 2. Tra cứu J&T Express
async function checkJT(code, phone) {
	const url = `https://jtexpress.vn/vi/tracking?type=track&billcode=${encodeURIComponent(code)}&cellphone=${encodeURIComponent(phone)}`;
	const res = await axios.get(url, {
		headers: HEADERS,
		timeout: 15000,
		httpsAgent: insecureAgent,
	});

	const html = typeof res.data === "string" ? res.data : "";
	if (!html) {
		return `⚠️ Không tải được dữ liệu J&T cho mã **${code}**.`;
	}

	const block = extractDivByClass(html, "result-tracking");
	if (!block) {
		return `⚠️ Không tìm thấy khối kết quả J&T cho mã **${code}**.\n🔗 ${url}`;
	}

	const text = block
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<\/(div|p|li|tr|h[1-6])[^>]*>|<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"');

	const lines = text
		.split("\n")
		.map(l => l.replace(/\s+/g, " ").trim())
		.filter(l => l.length > 0 && l !== code);

	if (lines.length === 0) {
		return `⚠️ Không có dữ liệu hành trình cho mã **${code}** (kiểm tra lại mã hoặc 4 số cuối SĐT **${phone}**).`;
	}

	// Gom nhóm theo cấu trúc: Giờ (HH:mm:ss) -> Ngày (YYYY-MM-DD) -> Nội dung
	const entries = [];
	for (let i = 0; i < lines.length; i++) {
		const isTime = /^\d{2}:\d{2}:\d{2}$/.test(lines[i]);
		const isDate = /^\d{4}-\d{2}-\d{2}$/.test(lines[i + 1] || "");

		if (isTime && isDate && lines[i + 2]) {
			const [, mm, dd] = lines[i + 1].split("-");
			const timeShort = lines[i].slice(0, 5);
			entries.push({
				time: `${timeShort} ${dd}/${mm}`,
				desc: lines[i + 2],
			});
			i += 2;
		}
	}

	let body;
	if (entries.length > 0) {
		const recent = entries.slice(0, MAX_ITEMS);
		body =
			`(${recent.length}/${entries.length})\n` +
			recent
				.map((e, idx) => `${idx === 0 ? "-" : "-"} **${e.time}**: ${e.desc}`)
				.join("\n");
	} else {
		body = "\n" + lines.slice(0, 5).join("\n");
	}

	return `{yellow}**J&T: ${code}**{/yellow} ${body}\n${url}`;
}

module.exports = {
	name: "/check",
	description: "Tra cứu hành trình vận đơn SPX, J&T",
	regex: /^\/check(?:\s+(.*))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const rawArgs = (match[1] || "").trim();

		if (!rawArgs) {
			return bot.sendMessage(
				chatId,
				"ℹ️ **Cách dùng lệnh /check:**\n" +
					"• SPX: `/check spx <Mã vận đơn>`\n" +
					"• J&T: `/check jt <Mã vận đơn> <4 số cuối SĐT>`",
				{ parse_mode: "markdown" },
			);
		}

		const args = rawArgs
			.split(/\s+/)
			.map(s => s.replace(/^["']|["']$/g, "").trim())
			.filter(Boolean);

		const carrier = (args[0] || "").toLowerCase();
		const code = args[1];
		const phone = args[2];

		try {
			if (carrier === "spx") {
				if (!code) {
					return bot.sendMessage(
						chatId,
						"⚠️ Thiếu mã vận đơn. VD: `/check spx SPXVN123456`",
						{ parse_mode: "markdown" },
					);
				}
				const reply = await checkSPX(code);
				return bot.sendMessage(chatId, reply, { parse_mode: "markdown" });
			}

			if (carrier === "jt" || carrier === "j&t") {
				if (!code || !phone) {
					return bot.sendMessage(
						chatId,
						"⚠️ Thiếu mã vận đơn hoặc 4 số cuối SĐT. VD: `/check jt 8123456789 1234`",
						{ parse_mode: "markdown" },
					);
				}
				const reply = await checkJT(code, phone);
				return bot.sendMessage(chatId, reply, { parse_mode: "markdown" });
			}

			return bot.sendMessage(chatId, "⚠️ Chỉ hỗ trợ hãng `spx` hoặc `jt`.", {
				parse_mode: "markdown",
			});
		} catch (err) {
			console.error(`Lỗi /check ${carrier}:`, err.message);
			return bot.sendMessage(
				chatId,
				`❌ Lỗi khi tra cứu vận đơn: ${err.message}`,
			);
		}
	},
};
