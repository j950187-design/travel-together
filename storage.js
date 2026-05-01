/* ============================================================
   💾 共用儲存工具
   - 所有旅行都存在瀏覽器的 localStorage 裡
   - 資料結構：{ [tripId]: { meta, currentDay, days, expenses } }
   - 之後要換成雲端（Firebase / Supabase）時，只要換這個檔案
   ============================================================ */

const STORAGE_KEY = "travel-trips-v1";

function loadAllTrips() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveAllTrips(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    alert("😢 儲存空間不足了！可能是照片太多太大，試試刪一些舊旅行或舊照片～");
  }
}

function loadTrip(id)  { return loadAllTrips()[id] || null; }
function saveTrip(id, trip) {
  const all = loadAllTrips();
  all[id] = trip;
  saveAllTrips(all);
}
function deleteTripById(id) {
  const all = loadAllTrips();
  delete all[id];
  saveAllTrips(all);
}

function newTripId() {
  return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* 把上傳的照片「縮小」後轉成 base64 字串
   原因：瀏覽器 localStorage 只有約 5MB，不縮小很快就滿
   max 邊長 800px + JPEG 壓縮 80%，視覺上夠清楚、檔案也不大 */
function fileToResizedDataURL(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = height * (maxSize / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = width * (maxSize / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* 第一次打開網頁時，放一個範例旅行當範例 */
function seedIfEmpty() {
  const all = loadAllTrips();
  if (Object.keys(all).length > 0) return;
  const id = newTripId();
  all[id] = {
    meta: {
      title: "京都小旅行 🌸",
      dates: "2026/05/10 – 05/13 · 4 天 3 夜",
      cover: "🌸",
      createdAt: Date.now(),
    },
    currentDay: 1,
    days: {
      // Day 1：景點 → 景點 → 景點 → 飯店（過夜）
      // 09:00 + 120 + 35 = 11:35; 11:35 + 90 + 25 = 13:30; 13:30 + 120 + 20(15+5) = 15:50
      1: [
        { id: 1, name: "伏見稻荷大社", category: "sight",
          addr: "京都市伏見区深草藪之内町68",
          start: "09:00", dur: 120, cost: 0, photo: "",
          note: "千本鳥居超級美！記得早點到避開人潮 ⛩️",
          travelLegs: [{ mode: "🚌 公車", mins: 35, from: "伏見稻荷大社", to: "清水道", cost: 230 }] },
        { id: 2, name: "清水寺", category: "sight",
          addr: "京都市東山区清水1丁目294",
          start: "11:35", dur: 90, cost: 400, photo: "", note: "",
          travelLegs: [{ mode: "🚶 步行", mins: 25, from: "清水寺", to: "祇園", cost: 0 }] },
        { id: 3, name: "祇園 花見小路", category: "sight",
          addr: "京都市東山区祇園町",
          start: "13:30", dur: 120, cost: 800, photo: "",
          note: "傍晚時分氛圍最好，可能會遇到舞妓～",
          // 多段交通示範：電車 15 分(220 円) + 步行 5 分 = 20 分 / 220
          travelLegs: [
            { mode: "🚇 電車", mins: 15, from: "祇園四条站", to: "京都站",  cost: 220 },
            { mode: "🚶 步行", mins: 5,  from: "京都站",     to: "OMO5 飯店", cost: 0 },
          ] },
        { id: 4, name: "OMO5 京都四条 飯店", category: "hotel",
          addr: "京都市下京区四条通烏丸東入長刀鉾町",
          start: "15:50", dur: 0, cost: 0, photo: "",
          note: "🛌 今晚就在這裡過夜，明早 08:00 退房",
          travelLegs: null },
      ],
      // Day 2：自動從飯店出發（示範自動帶入功能）
      // 08:00 + 30 + 30 = 09:00; 09:00 + 90 + 10 = 10:40
      2: [
        { id: 5, name: "OMO5 京都四条 飯店", category: "hotel",
          addr: "京都市下京区四条通烏丸東入長刀鉾町",
          start: "08:00", dur: 30, cost: 0, photo: "",
          note: "🌅 退房，搭電車前往嵐山",
          travelLegs: [{ mode: "🚇 電車", mins: 30, from: "京都站", to: "嵐山站", cost: 240 }] },
        { id: 6, name: "嵐山竹林小徑", category: "sight",
          addr: "京都市右京区嵯峨小倉山田淵山町",
          start: "09:00", dur: 90, cost: 0, photo: "",
          note: "綠竹隧道夢幻到不行 🎋",
          travelLegs: [{ mode: "🚶 步行", mins: 10, from: "竹林", to: "渡月橋", cost: 0 }] },
        { id: 7, name: "渡月橋", category: "sight",
          addr: "京都市右京区嵐山中之島町",
          start: "10:40", dur: 60, cost: 0, photo: "", note: "",
          travelLegs: null },
      ],
      3: [], 4: [],
    },
    // 同行夥伴
    people: [
      { id: "p1", name: "我",   color: "#FFB5A7" },
      { id: "p2", name: "小琪", color: "#B8E0D2" },
      { id: "p3", name: "安安", color: "#FCD5CE" },
    ],
    // 主要幣別（最後總額會換算到這個）
    baseCurrency: "TWD",
    // 匯率：rates[X] 表示「1 TWD = X 個 X 幣」
    rates: {
      TWD: 1, JPY: 4.78, USD: 0.032, KRW: 41.6, THB: 1.08,
      EUR: 0.029, GBP: 0.025, HKD: 0.247, CNY: 0.227, SGD: 0.043,
      VND: 778, AUD: 0.048,
    },
    ratesUpdatedAt: null,
    expenses: [
      { id: "e1", paidBy: "p2", splitWith: ["p1","p2","p3"],
        item: "京都車站便當",  amt: 1500, ccy: "JPY" },
      { id: "e2", paidBy: "p3", splitWith: ["p1","p2","p3"],
        item: "抹茶冰淇淋 ×3", amt: 800,  ccy: "JPY" },
    ],
    travel: {
      outbound: {
        type: "✈️ 飛機",
        number: "CI150",
        departAt: "05/10 08:40",
        departFrom: "桃園機場 T1",
        arriveAt: "05/10 12:30",
        arriveTo: "關西機場",
        note: "提前 2 小時到機場",
      },
      return: {
        type: "✈️ 飛機",
        number: "CI151",
        departAt: "05/13 18:00",
        departFrom: "關西機場",
        arriveAt: "05/13 22:00",
        arriveTo: "桃園機場 T1",
        note: "",
      },
    },
    prep: [
      { id: "cat-todo", name: "📋 待辦事項", items: [
        { id: 1, text: "辦日本簽證 / 確認免簽資格", done: true },
        { id: 2, text: "訂飯店（4 晚）", done: true },
        { id: 3, text: "查匯率，到銀行換日幣", done: false },
        { id: 4, text: "規劃保險", done: false },
        { id: 5, text: "通知信用卡公司海外消費", done: false },
      ]},
      { id: "cat-packing", name: "🎒 行李清單", items: [
        { id: 6, text: "🛂 護照（效期 6 個月以上）", done: true },
        { id: 7, text: "✈️ 機票 / 登機證", done: true },
        { id: 8, text: "💳 信用卡 + 日幣現金", done: false },
        { id: 9, text: "📱 上網 SIM 卡 / eSIM", done: false },
        { id: 10, text: "🔌 轉接頭 / 行動電源", done: false },
        { id: 11, text: "💊 常備藥品", done: false },
        { id: 12, text: "📷 相機 / 充電器", done: false },
        { id: 13, text: "👕 換洗衣物 ×4 套", done: false },
      ]},
    ],
  };
  saveAllTrips(all);
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
