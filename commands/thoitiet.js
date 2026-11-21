const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "weather_users.json");

function loadLocations() {
	if (!fs.existsSync(DATA_FILE)) return {};
	try {
		return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
	} catch {
		return {};
	}
}

function saveLocation(chatId, locationObj) {
	const data = loadLocations();
	data[chatId] = locationObj;
	fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Chuyển mã thời tiết WMO sang tiếng Việt
function getWeatherText(code) {
	if (code === 0) return "☀️ Trời quang đãng";
	if (code <= 3) return "⛅ Có mây";
	if (code <= 48) return "🌫️ Có sương mù";
	if (code <= 57) return "🌦️ Mưa phùn";
	if (code <= 67) return "🌧️ Có mưa";
	if (code <= 82) return "🌧️ Mưa rào";
	if (code >= 95) return "⛈️ Có dông, sấm sét";
	return "🌤️ Bình thường";
}

// Tìm tọa độ từ tên thành phố
async function findCity(cityName) {
	const res = await axios.get(
		"https://geocoding-api.open-meteo.com/v1/search",
		{
			params: { name: cityName, count: 1, language: "vi", format: "json" },
			timeout: 10000,
		},
	);
	const first = res.data?.results?.[0];
	if (!first) return null;

	return {
		name: [first.name, first.admin1, first.country].filter(Boolean).join(", "),
		lat: first.latitude,
		lon: first.longitude,
	};
}

// Lấy dữ liệu thời tiết từ tọa độ
async function getWeather(lat, lon) {
	const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
		params: {
			latitude: lat,
			longitude: lon,
			current:
				"temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
			daily:
				"temperature_2m_max,temperature_2m_min,precipitation_probability_max",
			timezone: "Asia/Ho_Chi_Minh",
			forecast_days: 1,
		},
		timeout: 10000,
	});
	return res.data;
}
function parseCoords(input) {
	const match = input.match(
		/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)(?:\s+(.*))?$/,
	);
	if (!match) return null;

	const lat = parseFloat(match[1]);
	const lon = parseFloat(match[2]);

	// Kiểm tra giới hạn vĩ độ (-90..90) và kinh độ (-180..180)
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

	const customName = (match[3] || "").trim();
	return {
		name: customName || `Tọa độ (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
		lat,
		lon,
	};
}
async function resolveLocation(input) {
	const coords = parseCoords(input);
	if (coords) return coords;
	return await findCity(input);
}
module.exports = {
	name: "/thoitiet",
	description: "Xem thời tiết và lưu vị trí mặc định",
	regex: /^\/thoitiet(?:\s+(.*))?$/i,

	async execute(bot, msg, match) {
		const chatId = String(msg.chat.id);
		const rawArgs = (match[1] || "").trim();

		// 1. Lưu vị trí: /thoitiet save <Tên nơi>
		if (/^save\s+/i.test(rawArgs)) {
			const query = rawArgs.replace(/^save\s+/i, "").trim();
			try {
				const city = await resolveLocation(query);
				if (!city) {
					return bot.sendMessage(
						chatId,
						`⚠️ Không tìm thấy địa điểm "${query}".`,
					);
				}
				saveLocation(chatId, city);
				return bot.sendMessage(
					chatId,
					`✅ Đã lưu vị trí mặc định: **${city.name}**.\nLần sau chỉ cần nhắn \`/thoitiet\`.`,
					{ parse_mode: "markdown" },
				);
			} catch {
				return bot.sendMessage(chatId, "❌ Lỗi khi tìm kiếm địa điểm.");
			}
		}

		// 2. Xác định vị trí cần xem
		let targetCity = null;
		try {
			if (rawArgs) {
				targetCity = await resolveLocation(rawArgs);
				if (!targetCity) {
					return bot.sendMessage(
						chatId,
						`⚠️ Không tìm thấy địa điểm "${rawArgs}".`,
					);
				}
			} else {
				targetCity = loadLocations()[chatId];
				if (!targetCity) {
					return bot.sendMessage(
						chatId,
						"ℹ️ Bạn chưa lưu vị trí.\n• Lưu mặc định: `/thoitiet save Mỹ Tho`\n• Xem nhanh: `/thoitiet Đà Lạt`",
						{ parse_mode: "markdown" },
					);
				}
			}

			const data = await getWeather(targetCity.lat, targetCity.lon);
			const cur = data.current;
			const daily = data.daily;

			const report =
				`🌤️ **THỜI TIẾT: ${targetCity.name}**\n\n` +
				`• **Trạng thái:** ${getWeatherText(cur.weather_code)}\n` +
				`• **Nhiệt độ:** **${cur.temperature_2m}°C** _(cảm giác như ${cur.apparent_temperature}°C)_\n` +
				`• **Trong ngày:** ${daily.temperature_2m_min[0]}°C – ${daily.temperature_2m_max[0]}°C\n` +
				`• **Khả năng mưa:** ${daily.precipitation_probability_max[0]}%\n` +
				`• **Độ ẩm:** ${cur.relative_humidity_2m}%\n` +
				`• **Tốc độ gió:** ${cur.wind_speed_10m} km/h`;

			await bot.sendMessage(chatId, report, { parse_mode: "markdown" });
		} catch (err) {
			console.error("Lỗi thời tiết:", err.message);
			await bot.sendMessage(
				chatId,
				"❌ Không thể lấy dữ liệu thời tiết lúc này.",
			);
		}
	},
};
