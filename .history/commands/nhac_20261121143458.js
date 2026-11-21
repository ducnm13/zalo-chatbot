const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "reminders.json");
const VN_OFFSET = 7 * 60 * 60 * 1000; // UTC+7

function loadReminders() {
	try {
		if (!fs.existsSync(DATA_FILE)) return [];
		return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
	} catch {
		return [];
	}
}

function saveReminders(list) {
	fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
}

// Định dạng timestamp sang giờ Việt Nam: HH:mm (DD/MM/YYYY)
function formatVNTime(timestamp) {
	const d = new Date(timestamp + VN_OFFSET);
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
	const yyyy = d.getUTCFullYear();
	return `${hh}:${mm} (${dd}/${mo}/${yyyy})`;
}

// Kiểm tra và phân tích ngày dạng DD/MM hoặc DD/MM/YYYY
function parseDateToken(token, defaultYear) {
	const m = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
	if (!m) return null;
	const day = parseInt(m[1], 10);
	const month = parseInt(m[2], 10);
	const year = m[3] ? parseInt(m[3], 10) : defaultYear;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return { day, month, year, hasYear: Boolean(m[3]) };
}

// Kiểm tra giờ dạng HH:mm
function parseClockToken(token) {
	const m = token.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	const h = parseInt(m[1], 10);
	const min = parseInt(m[2], 10);
	if (h > 23 || min > 59) return null;
	return { h, min };
}

// Trả về { remindAt, consumed } (consumed = số từ đã dùng cho thời gian: 1 hoặc 2)
function parseDateTime(parts) {
	const now = Date.now();
	const vnNow = new Date(now + VN_OFFSET);
	const currentYear = vnNow.getUTCFullYear();

	const first = (parts[0] || "").toLowerCase().trim();
	const second = (parts[1] || "").toLowerCase().trim();

	// 1. Có cả GIỜ + NGÀY: "7:00 22/11" hoặc "22/11 7:00"
	const clock1 = parseClockToken(first);
	const date2 = parseDateToken(second, currentYear);
	const date1 = parseDateToken(first, currentYear);
	const clock2 = parseClockToken(second);

	if ((clock1 && date2) || (date1 && clock2)) {
		const clock = clock1 || clock2;
		const date = date2 || date1;

		let targetVn = Date.UTC(
			date.year,
			date.month - 1,
			date.day,
			clock.h,
			clock.min,
			0,
			0,
		);
		let targetMs = targetVn - VN_OFFSET;

		// Nếu không ghi năm mà ngày đó năm nay đã qua thì tự động tính sang năm sau
		if (!date.hasYear && targetMs <= now) {
			targetVn = Date.UTC(
				date.year + 1,
				date.month - 1,
				date.day,
				clock.h,
				clock.min,
				0,
				0,
			);
			targetMs = targetVn - VN_OFFSET;
		}

		if (targetMs <= now) return null; // Ngày có ghi năm nhưng đã ở quá khứ
		return { remindAt: targetMs, consumed: 2 };
	}

	// 2. Chỉ có GIỜ: "17:30"
	if (clock1) {
		const targetVn = Date.UTC(
			currentYear,
			vnNow.getUTCMonth(),
			vnNow.getUTCDate(),
			clock1.h,
			clock1.min,
			0,
			0,
		);
		let targetMs = targetVn - VN_OFFSET;
		if (targetMs <= now) targetMs += 24 * 60 * 60 * 1000;
		return { remindAt: targetMs, consumed: 1 };
	}

	// 3. Khoảng thời gian: "30m", "15p", "2h", "1h30m", "10s"
	if (/^(\d+(?:h|g|m|p|s))+$/i.test(first)) {
		const durationRegex = /(\d+)\s*(h|g|m|p|s)/g;
		let totalMs = 0;
		let match;
		while ((match = durationRegex.exec(first)) !== null) {
			const val = parseInt(match[1], 10);
			const unit = match[2];
			if (unit === "h" || unit === "g") totalMs += val * 3600 * 1000;
			else if (unit === "m" || unit === "p") totalMs += val * 60 * 1000;
			else if (unit === "s") totalMs += val * 1000;
		}
		if (totalMs > 0) return { remindAt: now + totalMs, consumed: 1 };
	}

	return null;
}

let loopStarted = false;

module.exports = {
	name: "/nhac",
	description:
		"Hẹn giờ nhắc nhở (VD: /nhac 17:30 đóng tiền, /nhac 7:00 22/11 nấu cơm, /nhac 30m tắt bếp)",
	regex: /^\/nhac(?:\s+(.*))?$/i,

	// Khởi chạy vòng lặp kiểm tra nhắc nhở (gọi 1 lần trong index.js)
	startLoop(bot) {
		if (loopStarted) return;
		loopStarted = true;

		setInterval(async () => {
			const list = loadReminders();
			if (list.length === 0) return;

			const now = Date.now();
			const due = list.filter(r => r.remindAt <= now);
			if (due.length === 0) return;

			// Lưu lại các lịch chưa đến hạn trước khi gửi để tránh gửi trùng
			const remaining = list.filter(r => r.remindAt > now);
			saveReminders(remaining);

			for (const item of due) {
				try {
					await bot.sendMessage(
						item.chatId,
						`⏰ **NHẮC NHỞ ĐẾN GIỜ**\n\n📌 ${item.content}\n🕒 Lúc: ${formatVNTime(item.remindAt)}`,
						{ parse_mode: "markdown" },
					);
				} catch (err) {
					console.error("Lỗi gửi nhắc nhở:", err.message);
				}
			}
		}, 10000); // Kiểm tra mỗi 10 giây
	},

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const rawArgs = (match[1] || "").trim();

		// Hướng dẫn sử dụng
		if (!rawArgs) {
			return bot.sendMessage(
				chatId,
				"ℹ️ **Cách dùng lệnh /nhac:**\n" +
					"• `/nhac 17:30 đóng tiền nước`\n" +
					"• `/nhac 7:00 22/11 nấu cơm`\n" +
					"• `/nhac 30m tắt bếp` (hỗ trợ `s`, `m`/`p`, `h`/`g`, `1h30m`)\n" +
					"• `/nhac list` — Xem danh sách đang hẹn\n" +
					"• `/nhac xoa 1` — Xóa nhắc nhở số 1",
				{ parse_mode: "markdown" },
			);
		}

		// Xem danh sách nhắc nhở của user: /nhac list
		if (/^list$/i.test(rawArgs)) {
			const myList = loadReminders()
				.filter(r => r.chatId === chatId)
				.sort((a, b) => a.remindAt - b.remindAt);

			if (myList.length === 0) {
				return bot.sendMessage(chatId, "📭 Bạn chưa có lịch nhắc nhở nào.");
			}

			const lines = myList.map(
				(r, i) => `${i + 1}. ⏰ **${formatVNTime(r.remindAt)}** — ${r.content}`,
			);
			return bot.sendMessage(
				chatId,
				`📋 **DANH SÁCH NHẮC NHỞ**\n\n${lines.join("\n")}\n\n_Dùng \`/nhac xoa <số>\` để hủy._`,
				{ parse_mode: "markdown" },
			);
		}

		// Xóa nhắc nhở: /nhac xoa <số thứ tự>
		const delMatch = rawArgs.match(/^(?:xoa|del|delete)\s+(\d+)$/i);
		if (delMatch) {
			const idx = parseInt(delMatch[1], 10) - 1;
			const all = loadReminders();
			const myList = all
				.filter(r => r.chatId === chatId)
				.sort((a, b) => a.remindAt - b.remindAt);

			if (idx < 0 || idx >= myList.length) {
				return bot.sendMessage(chatId, "⚠️ Số thứ tự không hợp lệ.");
			}

			const target = myList[idx];
			const updated = all.filter(r => r.id !== target.id);
			saveReminders(updated);

			return bot.sendMessage(
				chatId,
				`🗑️ Đã hủy nhắc nhở: **${target.content}** (${formatVNTime(target.remindAt)})`,
				{ parse_mode: "markdown" },
			);
		}

		// Tạo nhắc nhở mới: /nhac <thời gian> <nội dung>
		const parts = rawArgs.split(/\s+/);
		const parsed = parseDateTime(parts);

		if (!parsed) {
			return bot.sendMessage(
				chatId,
				"⚠️ Thời gian không hợp lệ. Dùng dạng `17:30`, `7:00 22/11`, `30m`, `1h30m`...",
				{ parse_mode: "markdown" },
			);
		}

		const content = parts.slice(parsed.consumed).join(" ").trim();
		if (!content) {
			return bot.sendMessage(
				chatId,
				"⚠️ Thiếu nội dung nhắc nhở. Ví dụ: `/nhac 7:00 22/11 nấu cơm`",
				{ parse_mode: "markdown" },
			);
		}

		const all = loadReminders();
		all.push({
			id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			chatId,
			content,
			remindAt: parsed.remindAt,
		});
		saveReminders(all);

		return bot.sendMessage(
			chatId,
			`✅ Đã hẹn nhắc vào **${formatVNTime(parsed.remindAt)}**\n📌 Nội dung: ${content}`,
			{ parse_mode: "markdown" },
		);
	},
};
