const axios = require("axios");

const VN_OFFSET = 7 * 60 * 60 * 1000; // UTC+7

const HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept-Language": "vi-VN,vi;q=0.9",
};

function formatVNTime(unixSeconds) {
	if (!unixSeconds) return "";
	const ms = unixSeconds > 1e12 ? unixSeconds : unixSeconds * 1000;
	const d = new Date(ms + VN_OFFSET);
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
	const yyyy = d.getUTCFullYear();
	return `${hh}:${mm} ${dd}/${mo}/${yyyy}`;
}

// Xóa thẻ HTML & khoảng trắng thừa
function cleanHtml(str) {
	return (str || "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

// 1. Tra cứu Shopee Express (SPX)
async function checkSPX(code) {
	const url = `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${encodeURIComponent(code)}&language_code=vi`;
	const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
	const data = res.data;

	if (!data || data.retcode !== 0 || !data.data?.sls_tracking_info) {
		return `⚠️ Không tìm thấy vận đơn SPX **${code}**.`;
	}

	const info = data.data.sls_tracking_info;
	const records = info.records || [];

	if (records.length === 0) {
		return `📦 **SPX: ${code}**\nChưa có thông tin hành trình.`;
	}

	// Lấy tối đa 8 mốc gần nhất để tin nhắn gọn
	const lines = records.slice(0, 8).map((r, i) => {
		const time = formatVNTime(r.actual_time);
		const desc = r.buyer_description || r.description || "Đang cập nhật";
		const loc = r.current_location?.location_name
			? ` _(${r.current_location.location_name})_`
			: "";
		const icon = i === 0 ? "🟢" : "▫️";
		return `${icon} **${time}**\n   ${desc}${loc}`;
	});

	return (
		`📦 **HÀNH TRÌNH SPX: ${code}**\n` +
		`(Hiển thị ${lines.length}/${records.length} mốc mới nhất)\n\n` +
		lines.join("\n\n")
	);
}

// 2. Tra cứu J&T Express
async function checkJT(code, phone) {
	const url = `https://jtexpress.vn/vi/tracking?type=track&billcode=${encodeURIComponent(code)}&cellphone=${encodeURIComponent(phone)}`;
	const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
	const html = typeof res.data === "string" ? res.data : "";

	if (!html) {
		return `⚠️ Không tải được dữ liệu J&T cho mã **${code}**.`;
	}

	// Kiểm tra trường hợp không tìm thấy hoặc sai 4 số cuối SĐT
	if (/không tìm thấy|không có dữ liệu|vui lòng kiểm tra lại/i.test(html)) {
		return `⚠️ Không tìm thấy vận đơn J&T **${code}** (kiểm tra lại mã hoặc 4 số cuối SĐT **${phone}**).`;
	}

	// Bóc tách các khối hành trình từ HTML trang tracking của J&T
	const entries = [];
	const itemRegex =
		/<div[^>]*class="[^"]*result-vandon-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
	let match;

	while ((match = itemRegex.exec(html)) !== null) {
		const text = cleanHtml(match[1]);
		if (text) entries.push(text);
	}

	// Dự phòng: nếu J&T đổi class HTML, bóc theo định dạng ngày giờ (YYYY-MM-DD HH:mm:ss hoặc DD/MM/YYYY HH:mm)
	if (entries.length === 0) {
		const plain = html
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/<\/(div|p|li|tr|br)[^>]*>/gi, "\n")
			.replace(/<[^>]+>/g, " ");

		const lines = plain
			.split("\n")
			.map(l => l.replace(/\s+/g, " ").trim())
			.filter(
				l => /\d{2}[:/-]\d{2}/.test(l) && l.length > 15 && l.length < 300,
			);

		entries.push(...lines.slice(0, 8));
	}

	if (entries.length === 0) {
		return (
			`📦 **J&T: ${code}**\n` +
			`Không bóc tách được hành trình tự động (J&T có thể đã đổi giao diện hoặc yêu cầu captcha).\n` +
			`🔗 Xem trực tiếp: ${url}`
		);
	}

	const formatted = entries.slice(0, 8).map((item, i) => {
		const icon = i === 0 ? "🟢" : "▫️";
		return `${icon} ${item}`;
	});

	return (
		`📦 **HÀNH TRÌNH J&T: ${code}**\n\n` +
		formatted.join("\n\n") +
		`\n\n🔗 ${url}`
	);
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

		// Tách tham số và loại bỏ dấu ngoặc kép/đơn nếu người dùng gõ kèm
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
						{
							parse_mode: "markdown",
						},
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
