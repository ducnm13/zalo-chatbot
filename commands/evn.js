const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "users.json");

// --- 1. Quản lý lưu/đọc nhiều mã KH từ file JSON ---
function loadUsers() {
	if (!fs.existsSync(DATA_FILE)) return {};
	try {
		return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
	} catch {
		return {};
	}
}

function saveUsers(users) {
	fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}

function getUserCodes(chatId) {
	const users = loadUsers();
	const data = users[chatId];
	if (!data) return [];
	if (typeof data === "string") return [{ code: data, name: "" }];
	return Array.isArray(data) ? data : [];
}

function addUserCode(chatId, code, name = "") {
	const users = loadUsers();
	const list = getUserCodes(chatId);
	const existing = list.find(item => item.code === code);

	if (existing) {
		if (name) existing.name = name;
	} else {
		list.push({ code, name });
	}

	users[chatId] = list;
	saveUsers(users);
}

function removeUserCode(chatId, keyword) {
	const users = loadUsers();
	const list = getUserCodes(chatId);
	const lowerKey = keyword.toLowerCase();

	// Hỗ trợ xóa theo cả "name" lẫn "code"
	const newList = list.filter(
		item =>
			item.code.toLowerCase() !== lowerKey &&
			(item.name || "").toLowerCase() !== lowerKey,
	);

	if (newList.length === list.length) return false;
	users[chatId] = newList;
	saveUsers(users);
	return true;
}

// --- 2. Các hàm tiện ích ---
function formatDate(date) {
	const day = String(date.getDate()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const year = date.getFullYear();
	return `${day}-${month}-${year}`;
}

function escapeMarkdown(text) {
	return text.replace(/([_*~`])/g, "\\$1");
}

// --- 3. Hàm gọi API EVNSPC ---
// async function checkLichCupDien(maKH, soNgay = 4) {
// 	const today = new Date();
// 	const nextDays = new Date();
// 	nextDays.setDate(today.getDate() + soNgay);

// 	const tuNgay = formatDate(today);
// 	const denNgay = formatDate(nextDays);

// 	const response = await axios.get(
// 		"https://cskh.evnspc.vn/TraCuu/GetThongTinLichNgungGiamCungCapDien",
// 		{
// 			params: {
// 				tuNgay,
// 				denNgay,
// 				maKH,
// 				ChucNang: "MaKhachHang",
// 			},
// 			headers: {
// 				"User-Agent":
// 					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
// 			},
// 			timeout: 15000,
// 		},
// 	);

// 	const $ = cheerio.load(response.data);
// 	$("script, style").remove();

// 	const rawText = $.text()
// 		.split("\n")
// 		.map(line => line.trim())
// 		.filter(line => line.length > 0)
// 		.join("\n");

// 	return { tuNgay, denNgay, rawText };
// }

async function checkLichCupDien(maKH, soNgay = 4) {
	const today = new Date();
	const nextDays = new Date();
	nextDays.setDate(today.getDate() + soNgay);

	const tuNgay = formatDate(today);
	const denNgay = formatDate(nextDays);

	const response = await axios.get(
		"https://cskh.evnspc.vn/TraCuu/GetThongTinLichNgungGiamCungCapDien",
		{
			params: {
				tuNgay,
				denNgay,
				maKH,
				ChucNang: "MaKhachHang",
			},
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			},
			timeout: 15000,
		},
	);

	const $ = cheerio.load(response.data);
	const entryElements = $(".entry");

	// Không có thẻ .entry => Không có lịch cúp điện
	if (entryElements.length === 0) {
		return { tuNgay, denNgay, hasSchedule: false, donVi: "", entries: [] };
	}

	// Lấy tên đơn vị điện lực (bỏ chữ "Đơn vị:")
	const donVi = $(".ttl span")
		.eq(1)
		.text()
		.replace(/^Đơn vị:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();

	// Bóc tách từng lịch cắt điện trong .entry
	const entries = [];
	entryElements.each((_, el) => {
		const khuVuc = $(el)
			.find(".where")
			.text()
			.replace(/^KHU VỰC:\s*/i, "")
			.replace(/\s+/g, " ")
			.trim();

		const thoiGian = $(el)
			.find(".time")
			.text()
			.replace(/^THỜI GIAN:\s*/i, "")
			.replace(/\s+/g, " ")
			.trim();

		const lyDo = $(el).find(".cause span").text().replace(/\s+/g, " ").trim();

		entries.push({ khuVuc, thoiGian, lyDo });
	});

	return { tuNgay, denNgay, hasSchedule: true, donVi, entries };
}
// --- 4. Export cấu trúc lệnh ---
module.exports = {
	name: "/evn",
	description: "Tra cứu và lưu mã lịch cắt điện EVNSPC",
	regex: /^\/evn(?:\s+(.*))?$/i,

	loadUsers,
	getUserCodes,
	checkLichCupDien,
	escapeMarkdown,

	async execute(bot, msg, match) {
		const chatId = msg.chat.id;
		const rawArgs = (match[1] || "").trim();
		const args = rawArgs ? rawArgs.split(/\s+/) : [];
		const subCmd = args[0]?.toLowerCase();

		// 1. Lưu thêm mã: /evn save PBxxxx [Tên gợi nhớ]
		if (subCmd === "save") {
			const maKH = args[1]?.toUpperCase();
			const note = args.slice(2).join(" ");

			if (!maKH || !/^PB[A-Z0-9]+$/.test(maKH)) {
				return bot.sendMessage(
					chatId,
					"⚠️ Cú pháp đúng: `/evn save PB08070023325 Nhà riêng`",
					{ parse_mode: "markdown" },
				);
			}

			addUserCode(chatId, maKH, note);
			const label = note ? ` (${escapeMarkdown(note)})` : "";
			return bot.sendMessage(
				chatId,
				`✅ Đã lưu mã **${maKH}**${label}.\n• Tra theo tên: \`/evn ${note || maKH}\`\n• Tra tất cả: \`/evn\``,
				{ parse_mode: "markdown" },
			);
		}

		// 2. Xem danh sách đã lưu: /evn list
		if (subCmd === "list") {
			const list = getUserCodes(chatId);
			if (list.length === 0) {
				return bot.sendMessage(
					chatId,
					"ℹ️ Bạn chưa lưu mã nào. Dùng `/evn save PB08070023325 Nhà riêng` để thêm.",
					{ parse_mode: "markdown" },
				);
			}

			const lines = list.map((item, idx) => {
				const label = item.name ? ` - _${escapeMarkdown(item.name)}_` : "";
				return `${idx + 1}. **${item.code}**${label}`;
			});

			return bot.sendMessage(
				chatId,
				`📋 **Danh sách mã khách hàng đã lưu (${list.length}):**\n${lines.join("\n")}`,
				{ parse_mode: "markdown" },
			);
		}

		// 3. Xóa mã theo tên hoặc mã PB: /evn del <Tên hoặc PBxxxx>
		if (subCmd === "del" || subCmd === "delete") {
			const targetKey = args.slice(1).join(" ").trim();
			if (!targetKey) {
				return bot.sendMessage(
					chatId,
					"⚠️ Cú pháp đúng: `/evn del Nhà riêng` hoặc `/evn del PB08070023325`",
					{ parse_mode: "markdown" },
				);
			}

			const removed = removeUserCode(chatId, targetKey);
			return bot.sendMessage(
				chatId,
				removed
					? `🗑️ Đã xóa **${escapeMarkdown(targetKey)}** khỏi danh sách.`
					: `⚠️ Không tìm thấy **${escapeMarkdown(targetKey)}** trong danh sách của bạn.`,
				{ parse_mode: "markdown" },
			);
		}

		// 4. Tra cứu: /evn <name> | /evn <PBxxxx> | /evn (tất cả)
		let targets = [];
		const savedList = getUserCodes(chatId);

		if (rawArgs) {
			const lowerQuery = rawArgs.toLowerCase();

			// Ưu tiên tìm theo trường "name" trong users.json (khớp chính xác)
			let matched = savedList.filter(
				item => (item.name || "").toLowerCase() === lowerQuery,
			);

			// Nếu không khớp chính xác, tìm gần đúng (chứa từ khóa)
			if (matched.length === 0) {
				matched = savedList.filter(item =>
					(item.name || "").toLowerCase().includes(lowerQuery),
				);
			}

			if (matched.length > 0) {
				targets = matched;
			} else if (/^PB[A-Z0-9]+$/i.test(rawArgs)) {
				// Dự phòng: cho phép tra trực tiếp mã PB chưa lưu
				targets = [{ code: rawArgs.toUpperCase(), name: "" }];
			} else {
				return bot.sendMessage(
					chatId,
					`⚠️ Không tìm thấy tên **${escapeMarkdown(rawArgs)}** trong danh sách đã lưu.\nDùng \`/evn list\` để xem các tên hiện có.`,
					{ parse_mode: "markdown" },
				);
			}
		} else {
			targets = savedList;
			if (targets.length === 0) {
				return bot.sendMessage(
					chatId,
					"ℹ️ Bạn chưa lưu mã khách hàng nào.\nDùng `/evn save PB08070023325 Nhà riêng` để lưu.",
					{ parse_mode: "markdown" },
				);
			}
		}

		// await bot.sendMessage(
		// 	chatId,
		// 	`⏳ Đang kiểm tra lịch cắt điện cho **${targets.length}** mã khách hàng...`,
		// 	{ parse_mode: "markdown" },
		// );

		const results = [];

		for (const item of targets) {
			const title = item.name
				? `{orange}**${item.code}**{/orange} - ${item.fullname}`
				: `**${item.code}**`;

			try {
				const { tuNgay, denNgay, hasSchedule, donVi, entries } =
					await checkLichCupDien(item.code);

				if (!hasSchedule) {
					results.push(
						`${title}\nKhông có lịch cúp điện ${tuNgay} - ${denNgay}.`,
					);
				} else {
					const header =
						`${title}\n` +
						(donVi ? `Đơn vị: _${escapeMarkdown(donVi)}_\n` : "");

					const details = entries
						.map((e, i) => {
							return (
								`**Lịch ${i + 1}:**\n` +
								`${escapeMarkdown(e.thoiGian)}\n` +
								`${escapeMarkdown(e.khuVuc)}\n` +
								`${escapeMarkdown(e.lyDo)}`
							);
						})
						.join("\n\n");

					results.push(`${header}\n${details}`);
				}
			} catch (error) {
				console.error(`Lỗi EVNSPC (${item.code}):`, error.message);
				results.push(`❌ ${title}: Lỗi kết nối EVNSPC.`);
			}
		}
		bot.sendChatAction(chatId, "typing");
		await bot.sendMessage(chatId, results.join("\n\n"), {
			parse_mode: "markdown",
		});
	},
};
