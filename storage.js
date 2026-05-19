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

const TRIP_PERSON_COLORS = ["#FFB5A7", "#B8E0D2", "#FCD5CE", "#E4C1F9", "#FFE5A0", "#C9F4B5", "#B5C9F4", "#F4B5D9"];
const TRIP_DEFAULT_RATES = {
  TWD: 1, JPY: 4.78, USD: 0.032, KRW: 41.6, THB: 1.08,
  EUR: 0.029, GBP: 0.025, HKD: 0.247, CNY: 0.227, SGD: 0.043,
  VND: 778, AUD: 0.048,
};

function getDefaultPeople() {
  return [
    { id: "p1", name: "我",   color: "#FFB5A7" },
    { id: "p2", name: "小琪", color: "#B8E0D2" },
    { id: "p3", name: "安安", color: "#FCD5CE" },
  ];
}

function getDefaultRates() {
  return { ...TRIP_DEFAULT_RATES };
}

function splitPeopleNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value).split(/[、,，/|]+|\s{2,}/);
}

function makePeopleFromNames(names) {
  const seen = new Set();
  return names
    .map(name => String(name || "").trim())
    .filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name, i) => ({
      id: "p" + (i + 1),
      name,
      color: TRIP_PERSON_COLORS[i % TRIP_PERSON_COLORS.length],
    }));
}

function normalizePeople(people, metaPeople = "") {
  if (Array.isArray(people) && people.length > 0) {
    const seen = new Set();
    return people.map((p, i) => {
      let id = String(p?.id || `p${i + 1}`).trim();
      if (!id || seen.has(id)) id = `p${i + 1}`;
      seen.add(id);
      return {
        id,
        name: String(p?.name || `成員 ${i + 1}`).trim(),
        color: p?.color || TRIP_PERSON_COLORS[i % TRIP_PERSON_COLORS.length],
      };
    });
  }
  return makePeopleFromNames(splitPeopleNames(metaPeople)).length
    ? makePeopleFromNames(splitPeopleNames(metaPeople))
    : getDefaultPeople();
}

function normalizeSpotCategory(value) {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (["sight", "shopping", "food", "hotel", "other"].includes(lower)) return lower;
  if (/餐|食|吃|飯|咖啡|cafe|coffee|ramen|拉麵|燒肉|壽司|居酒屋|restaurant|food/.test(raw)) return "food";
  if (/飯店|旅館|民宿|住宿|hotel|inn|lodge|hostel/.test(raw)) return "hotel";
  if (/購物|商場|百貨|市場|mall|shop|shopping|買/.test(raw)) return "shopping";
  if (/景點|參觀|公園|博物館|寺|神社|城|地點|place|sight|spot/.test(raw)) return "sight";
  return "other";
}

function minutesToHHMMStorage(mins) {
  const normalized = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function timeToMinutesStorage(value) {
  const time = normalizeTimeValue(value, null);
  if (!time) return 540;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function normalizeTimeValue(value, fallback = "09:00") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = value >= 1 ? value % 1 : value;
    if (fraction > 0 && fraction < 1) return minutesToHHMMStorage(fraction * 1440);
    if (value >= 0 && value < 24) return minutesToHHMMStorage(value * 60);
  }
  const s = String(value).trim();
  const clock = s.match(/(上午|下午|AM|PM)?\s*(\d{1,2})[:：](\d{2})/i);
  if (clock) {
    let h = +clock[2], m = +clock[3];
    const marker = (clock[1] || "").toLowerCase();
    if ((marker === "下午" || marker === "pm") && h < 12) h += 12;
    if ((marker === "上午" || marker === "am") && h === 12) h = 0;
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return minutesToHHMMStorage(h * 60 + m);
  }
  const zh = s.match(/(上午|下午)?\s*(\d{1,2})\s*點\s*(半|(\d{1,2})\s*分?)?/);
  if (zh) {
    let h = +zh[2];
    const m = zh[3] === "半" ? 30 : (+zh[4] || 0);
    if (zh[1] === "下午" && h < 12) h += 12;
    if (zh[1] === "上午" && h === 12) h = 0;
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return minutesToHHMMStorage(h * 60 + m);
  }
  return fallback;
}

function normalizeDuration(value, fallback = 60) {
  if (value === null || value === undefined || value === "") return fallback;
  const m = String(value).match(/-?\d+(?:\.\d+)?/);
  const n = typeof value === "number" ? value : (m ? +m[0] : NaN);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const m = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Math.max(0, +m[0]) : 0;
}

function normalizeCurrency(value, fallback = "TWD") {
  const code = String(value || fallback || "TWD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function normalizeTravelLegs(spot, baseCurrency) {
  let legs = Array.isArray(spot.travelLegs) ? spot.travelLegs : null;
  if (!legs && spot.travelMode && spot.travelMins !== undefined) {
    legs = [{ mode: spot.travelMode, mins: spot.travelMins, cost: spot.travelCost || 0, ccy: spot.travelCcy || baseCurrency }];
  }
  if (!Array.isArray(legs)) return null;
  const cleaned = legs.map(l => ({
    mode: String(l?.mode || "🚶 步行"),
    mins: normalizeDuration(l?.mins ?? l?.minutes, 0),
    cost: normalizeAmount(l?.cost),
    ccy: normalizeCurrency(l?.ccy, baseCurrency),
    from: String(l?.from || ""),
    to: String(l?.to || ""),
  })).filter(l => l.mins > 0 || l.cost > 0 || l.from || l.to);
  return cleaned.length ? cleaned : null;
}

function normalizeDays(days, baseCurrency) {
  const src = Array.isArray(days)
    ? Object.fromEntries(days.map((list, i) => [i + 1, list]))
    : (days && typeof days === "object" ? days : { 1: [] });
  const usedIds = new Set();
  const assignedIds = new Set();
  const idMap = {};
  let nextId = 1;

  Object.values(src).flat().forEach(s => {
    const n = Number(s?.id);
    if (Number.isInteger(n) && n > 0) {
      usedIds.add(n);
      nextId = Math.max(nextId, n + 1);
    }
  });

  function nextSpotIdFor(rawId) {
    const n = Number(rawId);
    if (Number.isInteger(n) && n > 0 && !assignedIds.has(n)) {
      assignedIds.add(n);
      return n;
    }
    while (usedIds.has(nextId)) nextId++;
    const id = nextId++;
    usedIds.add(id);
    assignedIds.add(id);
    if (rawId !== undefined && rawId !== null && rawId !== "") idMap[String(rawId)] = id;
    return id;
  }

  const normalized = {};
  Object.keys(src).map(Number).filter(Number.isFinite).sort((a, b) => a - b).forEach(dayKey => {
    const list = Array.isArray(src[dayKey]) ? src[dayKey] : [];
    let cursor = 540;
    normalized[dayKey] = list.map((rawSpot, i) => {
      const s = rawSpot && typeof rawSpot === "object" ? { ...rawSpot } : {};
      const category = normalizeSpotCategory(s.category ?? s.cat);
      const start = normalizeTimeValue(s.start ?? s.time, minutesToHHMMStorage(cursor));
      const dur = normalizeDuration(s.dur ?? s.duration, category === "hotel" || category === "other" ? 0 : 60);
      cursor = timeToMinutesStorage(start) + dur + 30;
      const photos = Array.isArray(s.photos)
        ? s.photos.filter(Boolean)
        : (s.photo ? [s.photo] : []);
      return {
        ...s,
        id: nextSpotIdFor(s.id ?? `missing-${dayKey}-${i}`),
        name: String(s.name || `未命名景點 ${i + 1}`).trim(),
        category,
        addr: String(s.addr || s.address || ""),
        start,
        dur,
        cost: normalizeAmount(s.cost),
        costCcy: normalizeCurrency(s.costCcy ?? s.ccy, baseCurrency),
        note: String(s.note || ""),
        photos,
        shopItems: Array.isArray(s.shopItems)
          ? s.shopItems.map((it, idx) => ({
              id: it?.id ?? `shop-${dayKey}-${i}-${idx}`,
              text: String(it?.text || "").trim(),
              done: !!it?.done,
              photo: it?.photo || "",
            })).filter(it => it.text)
          : [],
        lat: Number.isFinite(Number(s.lat)) ? Number(s.lat) : null,
        lng: Number.isFinite(Number(s.lng)) ? Number(s.lng) : null,
        travelLegs: normalizeTravelLegs(s, baseCurrency),
      };
    });
  });

  if (Object.keys(normalized).length === 0) normalized[1] = [];
  return { days: normalized, idMap };
}

function normalizeSpotPayments(payments, idMap) {
  if (!payments || typeof payments !== "object") return {};
  const normalized = {};
  Object.entries(payments).forEach(([key, value]) => {
    const m = key.match(/^(ticket|transit)_(.+)$/);
    const nextKey = m && idMap[m[2]] ? `${m[1]}_${idMap[m[2]]}` : key;
    normalized[nextKey] = value;
  });
  return normalized;
}

function normalizeExpenses(expenses, people, baseCurrency) {
  const personIds = new Set(people.map(p => p.id));
  const byName = new Map(people.map(p => [p.name.toLowerCase(), p.id]));
  const fallback = people[0]?.id || "p1";

  function resolvePerson(value) {
    if (Array.isArray(value)) return resolvePerson(value[0]);
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (personIds.has(raw)) return raw;
    return byName.get(raw.toLowerCase()) || null;
  }

  function resolvePeople(value) {
    const values = Array.isArray(value) ? value : splitPeopleNames(value);
    return [...new Set(values.map(resolvePerson).filter(Boolean))];
  }

  return (Array.isArray(expenses) ? expenses : []).map((e, i) => {
    const paidBy = resolvePerson(e?.paidBy ?? e?.who) || fallback;
    const splitWith = resolvePeople(e?.splitWith).length
      ? resolvePeople(e?.splitWith)
      : (resolvePeople(e?.who).length ? resolvePeople(e?.who) : people.map(p => p.id));
    return {
      id: e?.id || "e_" + Date.now().toString(36) + "_" + i,
      paidBy,
      splitWith,
      item: String(e?.item ?? e?.name ?? "未命名花費"),
      amt: normalizeAmount(e?.amt ?? e?.amount ?? e?.cost),
      ccy: normalizeCurrency(e?.ccy, baseCurrency),
    };
  });
}

function normalizePrep(prep) {
  let cats = Array.isArray(prep) && prep.length > 0
    ? prep.map((c, i) => ({ ...c, id: c?.id || `cat-${i + 1}`, name: c?.name || "📋 待辦事項" }))
    : [
        { id: "cat-todo", name: "📋 待辦事項", subcats: [] },
        { id: "cat-packing", name: "🎒 行李清單", subcats: [] },
      ];

  const isLegacyFlat = cats.length > 0 && !("items" in cats[0]) && !("subcats" in cats[0]);
  if (isLegacyFlat) {
    cats = [{ id: "cat-default", name: "📋 待辦事項", subcats: [{ id: "sub-all-cat-default", name: "📋 全部", items: prep }] }];
  }

  let nextItemId = 1;
  cats.forEach(cat => {
    if (!Array.isArray(cat.subcats)) {
      const oldItems = Array.isArray(cat.items) ? cat.items : [];
      cat.subcats = oldItems.length ? [{ id: "sub-all-" + cat.id, name: "📋 全部", items: oldItems }] : [];
    }
    delete cat.items;
    cat.subcats.forEach((sub, subIdx) => {
      sub.id = sub.id || `sub-${cat.id}-${subIdx + 1}`;
      sub.name = sub.name || "📋 全部";
      sub.items = Array.isArray(sub.items) ? sub.items : [];
      sub.items.forEach(it => {
        const n = Number(it.id);
        if (Number.isInteger(n) && n >= nextItemId) nextItemId = n + 1;
      });
    });
  });
  cats.forEach(cat => cat.subcats.forEach(sub => sub.items.forEach(it => {
    const n = Number(it.id);
    it.id = Number.isInteger(n) ? n : nextItemId++;
    it.text = String(it.text || "").trim();
    it.done = !!it.done;
  })));
  return cats;
}

function normalizeTripData(trip) {
  if (!trip || typeof trip !== "object") return trip;
  trip.meta = trip.meta && typeof trip.meta === "object" ? trip.meta : {};
  trip.meta.title = String(trip.meta.title || "我的旅行");
  trip.meta.dates = String(trip.meta.dates || "");
  trip.meta.cover = trip.meta.cover || "🌸";
  trip.meta.createdAt = trip.meta.createdAt || Date.now();

  trip.people = normalizePeople(trip.people, trip.meta.people);
  trip.baseCurrency = normalizeCurrency(trip.baseCurrency, "TWD");
  trip.rates = { ...getDefaultRates(), ...(trip.rates || {}), TWD: 1 };

  const normalizedDays = normalizeDays(trip.days, trip.baseCurrency);
  trip.days = normalizedDays.days;
  trip.spotPayments = normalizeSpotPayments(trip.spotPayments, normalizedDays.idMap);
  trip.geoCache = trip.geoCache && typeof trip.geoCache === "object" ? trip.geoCache : {};

  trip.currentDay = Number(trip.currentDay) || 1;
  if (!trip.days[trip.currentDay]) trip.currentDay = Number(Object.keys(trip.days).sort((a, b) => +a - +b)[0]) || 1;

  trip.travel = trip.travel && typeof trip.travel === "object" ? trip.travel : {};
  if (trip.travel.inbound && !trip.travel.return) trip.travel.return = trip.travel.inbound;
  delete trip.travel.inbound;
  trip.travel.outbound = trip.travel.outbound || null;
  trip.travel.return = trip.travel.return || null;

  trip.expenses = normalizeExpenses(trip.expenses, trip.people, trip.baseCurrency);
  trip.prep = normalizePrep(trip.prep);
  if (trip.weather && typeof trip.weather !== "object") trip.weather = {};
  return trip;
}
