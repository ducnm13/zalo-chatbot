module.exports = {
	name: "/ping",
	description: "Kiểm tra trạng thái hoạt động của bot",
	regex: /^\/ping$/i,

	async execute(bot, msg) {
		const chatId = msg.chat.id;
		await bot.sendMessage(
			chatId,
			"🏓 **Pong!** Bot đang hoạt động bình thường.",
			{
				parse_mode: "markdown",
			},
		);
	},
};
