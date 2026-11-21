const os = require("os");
const { exec } = require("child_process");

// Thay bằng chat_id Zalo của bạn (xem trong log terminal khi nhắn tin cho bot)
// const ADMIN_CHAT_ID = "YOUR_CHAT_ID";

function formatBytes(bytes) {
	return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function formatUptime(seconds) {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	return `${days} ngày ${hours} giờ ${mins} phút`;
}

// Lấy dung lượng ổ cứng trên Linux bằng lệnh df -h
function getDiskUsage() {
	return new Promise(resolve => {
		if (process.platform === "win32") {
			return resolve("Không hỗ trợ trên Windows");
		}
		exec(
			'df -h / | awk \'NR==2 {print $3 " / " $2 " (" $5 ")"}\'',
			(err, stdout) => {
				if (err || !stdout) return resolve("Không lấy được dữ liệu");
				resolve(stdout.trim());
			},
		);
	});
}

module.exports = {
	name: "/vps",
	description: "Xem cấu hình và trạng thái hoạt động của VPS",
	regex: /^\/vps$/i,

	async execute(bot, msg) {
		const chatId = String(msg.chat.id);

		// Chặn người lạ xem thông tin server
		// if (ADMIN_CHAT_ID !== "YOUR_CHAT_ID" && chatId !== ADMIN_CHAT_ID) {
		//   return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng lệnh này.");
		// }

		const cpus = os.cpus();
		const cpuModel = cpus[0]?.model || "Không rõ";
		const cpuCores = cpus.length;
		const loadAvg = os
			.loadavg()
			.map(n => n.toFixed(2))
			.join(", ");

		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;
		const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

		const disk = await getDiskUsage();
		const botMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

		const report =
			`🖥️ **TRẠNG THÁI VPS**\n\n` +
			`• **Hệ điều hành:** ${os.type()} ${os.release()} (${os.arch()})\n` +
			`• **Hostname:** ${os.hostname()}\n` +
			`• **Uptime VPS:** ${formatUptime(os.uptime())}\n` +
			`• **CPU:** ${cpuCores} cores _(${cpuModel})_\n` +
			`• **Load Avg (1/5/15p):** ${loadAvg}\n` +
			`• **RAM:** ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (**${memPercent}%**)\n` +
			`• **Ổ cứng (/):** ${disk}\n` +
			`• **RAM Bot đang dùng:** ${botMem} MB`;

		await bot.sendMessage(chatId, report, { parse_mode: "markdown" });
	},
};
