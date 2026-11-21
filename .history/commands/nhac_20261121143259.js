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

// Định dạng timestamp sang giờ Việt Nam: HH:mm DD/MM
function formatVNTime(timestamp) {
	const d = new Date(timestamp + VN_OFFSET);
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
	return `${hh}:${mm} (${dd}/${mo})`;
}

// Phân tích thời gian: hỗ trợ "30m", "15p", "2h", "1h30m", "45s" hoặc "17:30"
function parseTime(token) {
	const now = Date.now();
	const str = token.toLowerCase().trim();

	// Trường hợp 1: Giờ cụ thể (VD: 17:30, 8:05)
	const clockMatch = str.match(/^(\d{1,2}):(\d{2})$/);
	if (clockMatch) {
		const h = parseInt(clockMatch[1], 10);
		const m = parseInt(clockMatch[2], 10);
		if (h > 23 || m > 59) return null;

		const vnNow = new Date(now + VN_OFFSET);
		const targetVn = Date.UTC(
			vnNow.getUTCFullYear(),
			vnNow.getUTCMonth(),
			vnNow.getUTCDate(),
			h,
			m,
			0,
			0,
		);

		let targetMs = targetVn - VN_OFFSET;
		// Nếu giờ đó hôm nay đã qua thì tự động hẹn sang ngày mai
		if (targetMs <= now) {
			targetMs += 24 * 60 * 60 * 1000;
		}
		return targetMs;
	}

	// Trường hợp 2: Khoảng thời gian (VD: 30m, 15p, 2h, 1h30m, 10s)
	const durationRegex = /(\d+)\s*(h|g|m|p|s)/g;
	let totalMs = 0;
	let matched = false;
	let match;

	// Kiểm tra chuỗi chỉ chứa các cặp số + đơn vị hợp lệ
	if (/^(\d+(?:h|g|m|p|s))+$/i.test(str)) {
		while ((match = durationRegex.exec(str)) !== null) {
			matched = true;
			const val = parseInt(match[1], 10);
			const unit = match[2];
			if (unit === "h" || unit === "g") totalMs += val * 3600 * 1000;
			else if (unit === "m" || unit === "p") totalMs += val * 60 * 1000;
			else if (unit === "s") totalMs += val * 1000;
		}
	}

	if (matched && totalMs > 0) {
		return now + totalMs;
	}

	return null;
}

let loopStarted = false;

module.exports = {
	name: "/nhac",
	description:
		"Hẹn giờ nhắc nhở (VD: /nhac 17:30 đóng tiền nước, /nhac 30m tắt bếp)",
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
		const timeToken = parts[0];
		const content = parts.slice(1).join(" ").trim();

		if (!content) {
			return bot.sendMessage(
				chatId,
				"⚠️ Thiếu nội dung nhắc nhở. Ví dụ: `/nhac 30m tắt bếp`",
				{ parse_mode: "markdown" },
			);
		}

		const remindAt = parseTime(timeToken);
		if (!remindAt) {
			return bot.sendMessage(
				chatId,
				"⚠️ Thời gian không hợp lệ. Dùng dạng `17:30`, `30m`, `15p`, `2h`, hoặc `1h30m`.",
				{ parse_mode: "markdown" },
			);
		}

		const all = loadReminders();
		all.push({
			id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			chatId,
			content,
			remindAt,
		});
		saveReminders(all);

		return bot.sendMessage(
			chatId,
			`✅ Đã hẹn nhắc vào **${formatVNTime(remindAt)}**\n📌 Nội dung: ${content}`,
			{ parse_mode: "markdown" },
		);
	},
};
