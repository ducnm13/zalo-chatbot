module.exports = {
	name: "/help",
	description: "Xem danh sách các lệnh hỗ trợ",
	regex: /^\/(help|start)$/i,

	async execute(bot, msg, match, allCommands) {
		const chatId = msg.chat.id;
		const menu = allCommands
			.map(cmd => `• \`${cmd.name}\` — ${cmd.description}`)
			.join("\n");

		await bot.sendMessage(chatId, `🤖 **DANH SÁCH LỆNH HỖ TRỢ**\n\n${menu}`, {
			parse_mode: "markdown",
		});
	},
};
