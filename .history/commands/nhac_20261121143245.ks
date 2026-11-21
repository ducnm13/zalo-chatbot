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
      0
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
  description: "Hẹn giờ nhắc nhở (VD: /nhac 17:30 đóng tiền nước, /nhac 30m tắt bếp)",
  regex: /^\/nhac(?:\s+(.*))?$/i,

  // Khởi chạy vòng lặp kiểm tra nhắc nhở (gọi 1 lần trong index.js)
  startLoop(bot) {
    if (loopStarted) return;
    loopStarted = true;

    setInterval(async () => {
      const