const { execFile } = require("child_process");

function runPM2(args) {
	return new Promise((resolve, reject) => {
		execFile("pm2", args, { timeout: 15000 }, (err, stdout, stderr) => {
			if (err) return reject(new Error(stderr || err.message));
			resolve(stdout || stderr || "Đã thực thi xong.");
		});
	});
}

// Xóa mã màu ANSI của terminal để hiển thị sạch trên Zalo
function stripAnsi(text) {
	return text.replace(/\x1B\[[0-9;]*[mK]/g, "").trim();
}

module.exports = {
	name: "/pm2",
	description: "Khởi động lại hoặc xem log tiến trình PM2",
	regex: /^\/pm2(?:\s+(.*))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);

		const args = (match[1] || "").trim().split(/\s+/).filter(Boolean);
		const action = args[0]?.toLowerCase();
		const target = args[1]; // Chấp nhận cả ID số (0, 1) hoặc tên tiến trình

		if (!action || !target || !/^[a-zA-Z0-9_-]+$/.test(target)) {
			return bot.sendMessage(
				chatId,
				"ℹ️ **Cú pháp lệnh PM2:**\n• Khởi động lại: `/pm2 restart <id hoặc tên>`\n• Xem 20 dòng log: `/pm2 logs <id hoặc tên>`",
				{ parse_mode: "markdown" },
			);
		}

		try {
			if (action === "restart") {
				await bot.sendMessage(
					chatId,
					`⏳ Đang khởi động lại tiến trình **${target}**...`,
					{
						parse_mode: "markdown",
					},
				);
				await runPM2(["restart", target]);
				return bot.sendMessage(
					chatId,
					`✅ Đã khởi động lại **${target}** thành công.`,
					{
						parse_mode: "markdown",
					},
				);
			}

			if (action === "logs" || action === "log") {
				// --nostream để lấy log xong thoát ngay, không bị treo tiến trình
				const output = await runPM2([
					"logs",
					target,
					"--lines",
					"20",
					"--nostream",
				]);
				let cleanLog = stripAnsi(output);

				// Cắt bớt nếu log quá dài (tránh vượt giới hạn ký tự của Zalo)
				if (cleanLog.length > 3000) {
					cleanLog = "..." + cleanLog.slice(-3000);
				}

				return bot.sendMessage(
					chatId,
					`📄 **Log gần nhất của ${target}:**\n\n${cleanLog || "(Trống)"}`,
				);
			}

			return bot.sendMessage(chatId, "⚠️ Chỉ hỗ trợ `restart` hoặc `logs`.", {
				parse_mode: "markdown",
			});
		} catch (err) {
			return bot.sendMessage(chatId, `❌ Lỗi PM2: ${err.message}`);
		}
	},
};
