const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "finance.json");
const VN_OFFSET = 7 * 60 * 60 * 1000; // UTC+7

function loadData() {
	try {
		if (!fs.existsSync(DATA_FILE)) return {};
		return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
	} catch {
		return {};
	}
}

function saveData(data) {
	fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getVNDateParts(ts = Date.now()) {
	const d = new Date(ts + VN_OFFSET);
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const yyyy = String(d.getUTCFullYear());
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mi = String(d.getUTCMinutes()).padStart(2, "0");
	return {
		day: `${dd}/${mm}/${yyyy}`,
		month: `${mm}/${yyyy}`,
		time: `${hh}:${mi}`,
		shortDate: `${dd}/${mm}`,
	};
}

function formatMoney(n) {
	return Math.round(n).toLocaleString("vi-VN") + "đ";
}

// Hỗ trợ: 50k, 50.5k, 1tr5, 1.5tr, 2m, 50000, 50.000
function parseAmount(raw) {
	if (!raw) return null;
	const s = raw.toLowerCase().trim();

	const shortTr = s.match(/^(\d+)tr(\d+)$/);
	if (shortTr) {
		const whole = parseInt(shortTr[1], 10);
		const frac = parseFloat(`0.${shortTr[2]}`);
		return Math.round((whole + frac) * 1_000_000);
	}

	const kMatch = s.match(/^(\d+(?:[.,]\d+)?)k$/);
	if (kMatch) {
		return Math.round(parseFloat(kMatch[1].replace(",", ".")) * 1_000);
	}

	const trMatch = s.match(/^(\d+(?:[.,]\d+)?)(?:tr|m)$/);
	if (trMatch) {
		return Math.round(parseFloat(trMatch[1].replace(",", ".")) * 1_000_000);
	}

	if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s) || /^\d+$/.test(s)) {
		const num = parseInt(s.replace(/[.,]/g, ""), 10);
		return num > 0 ? num : null;
	}

	return null;
}

module.exports = {
	name: "/chi, /thu, /baocao",
	description: "Ghi chép thu chi nhanh và xem báo cáo (VD: /chi 50k ăn sáng)",
	regex: /^\/(chi|thu|baocao)(?:\s+([\s\S]*))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const cmd = match[1].toLowerCase();
		const args = (match[2] || "").trim();

		const db = loadData();
		if (!db[chatId]) db[chatId] = [];
		const list = db[chatId];

		// 1. Lệnh /chi và /thu
		if (cmd === "chi" || cmd === "thu") {
			if (!args) {
				return bot.sendMessage(
					chatId,
					`ℹ️ **Cách dùng:**\n` +
						`• \`/chi 50k ăn sáng\`\n` +
						`• \`/thu 1tr5 bán hàng\`\n` +
						`• Xem tổng kết: \`/baocao\` hoặc \`/baocao thang\``,
					{ parse_mode: "markdown" },
				);
			}

			const parts = args.split(/\s+/);
			const amount = parseAmount(parts[0]);
			const note =
				parts.slice(1).join(" ").trim() ||
				(cmd === "chi" ? "Chi tiêu" : "Thu nhập");

			if (!amount) {
				return bot.sendMessage(
					chatId,
					`⚠️ Số tiền không hợp lệ (\`${parts[0]}\`). VD: \`50k\`, \`1.5tr\`, \`250000\``,
					{ parse_mode: "markdown" },
				);
			}

			const now = Date.now();
			const vn = getVNDateParts(now);
			const nextId = list.length > 0 ? list[list.length - 1].id + 1 : 1;

			list.push({
				id: nextId,
				type: cmd,
				amount,
				note,
				day: vn.day,
				month: vn.month,
				time: vn.time,
				shortDate: vn.shortDate,
				ts: now,
			});
			saveData(db);

			// Tính nhanh tổng trong ngày
			const todayItems = list.filter(i => i.day === vn.day);
			const totalThu = todayItems
				.filter(i => i.type === "thu")
				.reduce((s, i) => s + i.amount, 0);
			const totalChi = todayItems
				.filter(i => i.type === "chi")
				.reduce((s, i) => s + i.amount, 0);

			const icon = cmd === "thu" ? "🟢" : "🔴";
			const label = cmd === "thu" ? "THU" : "CHI";

			return bot.sendMessage(
				chatId,
				`${icon} Đã ghi **${label}** #${nextId}: **${formatMoney(amount)}**\n` +
					`📝 ${note} _(${vn.time} ${vn.shortDate})_\n` +
					`──────────────\n` +
					`📅 Hôm nay: Thu **${formatMoney(totalThu)}** | Chi **${formatMoney(totalChi)}**`,
				{ parse_mode: "markdown" },
			);
		}

		// 2. Lệnh /baocao
		if (cmd === "baocao") {
			const sub = args.toLowerCase();

			// Xóa khoản nhập nhầm: /baocao xoa <id> hoặc /baocao undo
			if (sub === "undo") {
				if (list.length === 0) {
					return bot.sendMessage(
						chatId,
						"ℹ️ Chưa có giao dịch nào để hoàn tác.",
					);
				}
				const removed = list.pop();
				saveData(db);
				return bot.sendMessage(
					chatId,
					`🗑️ Đã xóa giao dịch gần nhất (#${removed.id}): **${removed.type.toUpperCase()} ${formatMoney(removed.amount)}** - ${removed.note}`,
					{ parse_mode: "markdown" },
				);
			}

			const delMatch = sub.match(/^xoa\s+#?(\d+)$/);
			if (delMatch) {
				const targetId = parseInt(delMatch[1], 10);
				const idx = list.findIndex(i => i.id === targetId);
				if (idx === -1) {
					return bot.sendMessage(
						chatId,
						`⚠️ Không tìm thấy giao dịch #${targetId}.`,
					);
				}
				const [removed] = list.splice(idx, 1);
				saveData(db);
				return bot.sendMessage(
					chatId,
					`🗑️ Đã xóa #${removed.id}: **${removed.type.toUpperCase()} ${formatMoney(removed.amount)}** - ${removed.note}`,
					{ parse_mode: "markdown" },
				);
			}

			const vnNow = getVNDateParts();
			let filtered = [];
			let title = "";
			let showDetails = true;

			if (!sub || sub === "homnay" || sub === "ngay") {
				filtered = list.filter(i => i.day === vnNow.day);
				title = `HÔM NAY (${vnNow.day})`;
			} else if (sub === "thang") {
				filtered = list.filter(i => i.month === vnNow.month);
				title = `THÁNG ${vnNow.month}`;
				showDetails = false;
			} else if (/^\d{2}\/\d{4}$/.test(sub)) {
				filtered = list.filter(i => i.month === sub);
				title = `THÁNG ${sub}`;
				showDetails = false;
			} else if (/^\d{2}\/\d{2}\/\d{4}$/.test(sub)) {
				filtered = list.filter(i => i.day === sub);
				title = `NGÀY ${sub}`;
			} else {
				return bot.sendMessage(
					chatId,
					"ℹ️ **Cách dùng /baocao:**\n" +
						"• Hôm nay: `/baocao`\n" +
						"• Tháng này: `/baocao thang`\n" +
						"• Tháng bất kỳ: `/baocao 11/2026`\n" +
						"• Ngày bất kỳ: `/baocao 24/11/2026`\n" +
						"• Xóa khoản gần nhất: `/baocao undo`\n" +
						"• Xóa theo mã: `/baocao xoa <số ID>`",
					{ parse_mode: "markdown" },
				);
			}

			if (filtered.length === 0) {
				return bot.sendMessage(
					chatId,
					`📊 Chưa có dữ liệu thu chi cho **${title}**.`,
					{
						parse_mode: "markdown",
					},
				);
			}

			const totalThu = filtered
				.filter(i => i.type === "thu")
				.reduce((s, i) => s + i.amount, 0);
			const totalChi = filtered
				.filter(i => i.type === "chi")
				.reduce((s, i) => s + i.amount, 0);
			const diff = totalThu - totalChi;
			const diffSign = diff >= 0 ? "+" : "-";

			let reply =
				`📊 **BÁO CÁO THU CHI — ${title}**\n` +
				`🟢 Tổng thu: **${formatMoney(totalThu)}**\n` +
				`🔴 Tổng chi: **${formatMoney(totalChi)}**\n` +
				`💰 Chênh lệch: **${diffSign}${formatMoney(Math.abs(diff))}**\n` +
				`🧾 Số giao dịch: ${filtered.length}`;

			if (showDetails) {
				const lines = filtered.slice(-15).map(i => {
					const icon = i.type === "thu" ? "➕" : "➖";
					return `${icon} **${formatMoney(i.amount)}** — ${i.note} _(#${i.id} | ${i.time})_`;
				});
				reply += `\n\n**Chi tiết:**\n` + lines.join("\n");
			} else {
				// Với báo cáo tháng, hiển thị 10 khoản gần nhất để tránh tin nhắn quá dài
				const recent = filtered.slice(-10).map(i => {
					const icon = i.type === "thu" ? "➕" : "➖";
					return `${icon} ${i.shortDate}: **${formatMoney(i.amount)}** — ${i.note} _(#${i.id})_`;
				});
				reply += `\n\n**10 giao dịch gần nhất:**\n` + recent.join("\n");
			}

			return bot.sendMessage(chatId, reply, { parse_mode: "markdown" });
		}
	},
};
