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

function formatBytes(bytes) {
	if (!bytes) return "0 MB";
	return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function formatUptime(startTime) {
	if (!startTime) return "0m";
	const diff = Math.max(0, Date.now() - startTime);
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${mins % 60}m`;
	return `${mins}m`;
}

module.exports = {
	name: "/pm2",
	description: "Xem trạng thái, khởi động lại hoặc xem log tiến trình PM2",
	regex: /^\/pm2(?:\s+(.*))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const args = (match[1] || "").trim().split(/\s+/).filter(Boolean);
		const action = args[0]?.toLowerCase();
		const target = args[1]; // Chấp nhận cả ID số (0, 1) hoặc tên tiến trình

		// Không có tham số -> hiện hướng dẫn
		if (!action) {
			return bot.sendMessage(
				chatId,
				"ℹ️ **Cú pháp lệnh PM2:**\n" +
					"• Xem trạng thái: `/pm2 status`\n" +
					"• Khởi động lại: `/pm2 restart <id hoặc tên>` (hoặc `reload`, `rl`)\n" +
					"• Xem 20 dòng log: `/pm2 logs <id hoặc tên>`",
				{ parse_mode: "markdown" },
			);
		}

		try {
			// 1. Xem trạng thái các tiến trình: /pm2 status | list | ls
			if (action === "status" || action === "list" || action === "ls") {
				const stdout = await runPM2(["jlist"]);
				const list = JSON.parse(stdout);

				if (!list.length) {
					return bot.sendMessage(
						chatId,
						"📭 Không có tiến trình PM2 nào đang chạy.",
					);
				}

				const lines = list.map(p => {
					const status = p.pm2_env?.status || "unknown";
					const icon = status === "online" ? "🟢" : "🔴";
					const mem = formatBytes(p.monit?.memory);
					const cpu = (p.monit?.cpu ?? 0) + "%";
					const uptime =
						status === "online"
							? formatUptime(p.pm2_env?.pm_uptime)
							: "stopped";
					const restarts = p.pm2_env?.restart_time ?? 0;

					return (
						`${icon} **[${p.pm_id}] ${p.name}** (${status})\n` +
						`   • RAM: ${mem} | CPU: ${cpu}\n` +
						`   • Uptime: ${uptime} | ↺ ${restarts}`
					);
				});

				return bot.sendMessage(
					chatId,
					`📊 **TRẠNG THÁI PM2 (${list.length})**\n\n${lines.join("\n\n")}`,
					{ parse_mode: "markdown" },
				);
			}

			// Các lệnh dưới đây bắt buộc có target hợp lệ
			if (!target || !/^[a-zA-Z0-9_-]+$/.test(target)) {
				return bot.sendMessage(
					chatId,
					"⚠️ Thiếu hoặc sai tên/ID tiến trình. Ví dụ: `/pm2 logs 0` hoặc `/pm2 restart zalo-evn-bot`",
					{ parse_mode: "markdown" },
				);
			}

			// 2. Khởi động lại: /pm2 restart | reload | rl <target>
			if (action === "restart" || action === "reload" || action === "rl") {
				const pm2Cmd = action === "restart" ? "restart" : "reload";
				await bot.sendMessage(
					chatId,
					`⏳ Đang ${pm2Cmd} tiến trình **${target}**...`,
					{ parse_mode: "markdown" },
				);
				await runPM2([pm2Cmd, target]);
				return bot.sendMessage(
					chatId,
					`✅ Đã ${pm2Cmd} **${target}** thành công.`,
					{ parse_mode: "markdown" },
				);
			}

			// 3. Xem log: /pm2 logs | log <target>
			if (action === "logs" || action === "log") {
				const output = await runPM2([
					"logs",
					target,
					"--lines",
					"20",
					"--nostream",
				]);
				let cleanLog = stripAnsi(output);

				// Cắt dưới 1800 ký tự để cộng thêm tiêu đề vẫn an toàn dưới mốc 2000 của Zalo
				if (cleanLog.length > 1800) {
					cleanLog = "...\n" + cleanLog.slice(-1800);
				}

				return bot.sendMessage(
					chatId,
					`📄 **Log gần nhất của ${target}:**\n\n${cleanLog || "(Trống)"}`,
				);
			}

			return bot.sendMessage(
				chatId,
				"⚠️ Chỉ hỗ trợ `status`, `restart` (`reload`/`rl`) hoặc `logs`.",
				{ parse_mode: "markdown" },
			);
		} catch (err) {
			return bot.sendMessage(chatId, `❌ Lỗi PM2: ${err.message}`);
		}
	},
};
