const os = require("os");
const { exec } = require("child_process");

// Thay bằng chat_id Zalo của bạn để chặn người lạ
// const ADMIN_CHAT_ID = "YOUR_CHAT_ID";

function formatGB(bytes) {
	return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function formatMB(bytes) {
	return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function formatUptime(seconds) {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	return `${days}d ${hours}h ${mins}m`;
}

function escapeMarkdown(text) {
	return String(text).replace(/([_*~`])/g, "\\$1");
}

// Lấy địa chỉ IPv4 của VPS
function getServerIP() {
	const nets = os.networkInterfaces();
	for (const name of Object.keys(nets)) {
		for (const net of nets[name]) {
			if (net.family === "IPv4" && !net.internal) {
				return net.address;
			}
		}
	}
	return "127.0.0.1";
}

// Lấy dung lượng ổ cứng (Linux)
function getDiskUsage() {
	return new Promise(resolve => {
		if (process.platform === "win32")
			return resolve("Không hỗ trợ trên Windows");
		exec(
			'df -h / | awk \'NR==2 {print $3 " / " $2 " (" $5 ")"}\'',
			(err, stdout) => {
				if (err || !stdout) return resolve("Không lấy được dữ liệu");
				resolve(stdout.trim());
			},
		);
	});
}

// Lấy danh sách tiến trình đang chạy trong PM2
function getPM2List() {
	return new Promise(resolve => {
		exec("pm2 jlist", (err, stdout) => {
			if (err || !stdout) {
				return resolve(["⚠️ Không lấy được danh sách PM2"]);
			}
			try {
				const list = JSON.parse(stdout);
				if (!list.length) return resolve(["Không có tiến trình nào."]);

				const lines = list.map(proc => {
					const name = escapeMarkdown(proc.name);
					const status = proc.pm2_env?.status || "unknown";
					const icon = status === "online" ? "🟢" : "🔴";
					const cpu = proc.monit?.cpu ?? 0;
					const mem = formatMB(proc.monit?.memory || 0);
					const restarts = proc.pm2_env?.restart_time ?? 0;
					const uptimeSec = proc.pm2_env?.pm_uptime
						? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000)
						: 0;

					return (
						`${icon} **${name}** (${status})\n` +
						`   CPU: ${cpu}% | RAM: ${mem} | ↻ ${restarts} | ⏱ ${formatUptime(uptimeSec)}`
					);
				});

				resolve(lines);
			} catch {
				resolve(["⚠️ Lỗi đọc dữ liệu JSON từ PM2"]);
			}
		});
	});
}

module.exports = {
	name: "/vps",
	description: "Xem cấu hình VPS và trạng thái các tiến trình PM2",
	regex: /^\/vps$/i,

	async execute(bot, msg) {
		const chatId = String(msg.chat.id);

		// if (ADMIN_CHAT_ID !== "YOUR_CHAT_ID" && chatId !== ADMIN_CHAT_ID) {
		//   return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng lệnh này.");
		// }

		const cpus = os.cpus();
		const cpuModel = escapeMarkdown(cpus[0]?.model || "Không rõ");
		const cpuCores = cpus.length;
		const loadAvg = os
			.loadavg()
			.map(n => n.toFixed(2))
			.join(", ");

		const totalMem = os.totalmem();
		const usedMem = totalMem - os.freemem();
		const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

		const [disk, pm2Lines] = await Promise.all([getDiskUsage(), getPM2List()]);

		const report =
			`🖥️ **THÔNG TIN MÁY CHỦ VPS**\n` +
			`• **Host / IP:** ${escapeMarkdown(os.hostname())} (${getServerIP()})\n` +
			`• **OS:** ${os.type()} ${os.release()} (${os.arch()})\n` +
			`• **Node.js:** ${process.version}\n` +
			`• **Uptime VPS:** ${formatUptime(os.uptime())}\n` +
			`• **CPU:** ${cpuCores} cores _(${cpuModel})_\n` +
			`• **Load Avg (1/5/15p):** ${loadAvg}\n` +
			`• **RAM:** ${formatGB(usedMem)} / ${formatGB(totalMem)} (**${memPercent}%**)\n` +
			`• **Ổ cứng (/):** ${disk}\n\n` +
			`⚙️ **TIẾN TRÌNH PM2 (${pm2Lines.length})**\n` +
			`${pm2Lines.join("\n")}`;

		await bot.sendMessage(chatId, report, { parse_mode: "markdown" });
	},
};
