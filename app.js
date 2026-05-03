/* ============================================================
   🌸 Travel Together — 單一行程頁邏輯
   功能：
   - 從網址 ?id= 讀取是哪一趟旅行，用 localStorage 自動存
   - 拖拉景點排序，自動重算時間（含交通時間）
   - 改時間 / 停留時間 / 交通分鐘 → 後面行程自動順延
   - 新增景點自動查地址（OpenStreetMap Nominatim，免 API 金鑰）
   - 每段交通方式可手動編輯（點中間的綠色方塊）
   - 去程 / 回程 資訊
   - 行前準備清單（打勾 / 新增 / 刪除）
   - 匯出 PDF（瀏覽器列印 → 另存為 PDF）
   ============================================================ */

// ========== 取得這趟旅行 ==========
const TRIP_ID = new URLSearchParams(location.search).get("id");

if (!TRIP_ID || !loadTrip(TRIP_ID)) {
  document.body.innerHTML = `
    <div style="text-align:center; padding:80px; font-family:'Noto Sans TC',sans-serif;">
      <div style="font-size:72px;">🧐</div>
      <h2>找不到這趟旅行</h2>
      <p style="color:#7A778A;">可能連結有誤，或已被刪除。</p>
      <a href="index.html" style="color:#F4967F; font-weight:700;">← 回到首頁</a>
    </div>`;
  throw new Error("Trip not found");
}

let state = loadTrip(TRIP_ID);
// ---- 確保結構完整（舊資料相容） ----
state.currentDay = state.currentDay || 1;
state.days = state.days || { 1: [] };
state.expenses = state.expenses || [];
state.travel = state.travel || { outbound: null, return: null };
state.spotPayments = state.spotPayments || {}; // 自動條目的付款指定 { key: { paidBy, splitWith } }

// 同行夥伴 / 幣別 / 匯率（舊資料補上預設）
state.people = state.people || [
  { id: "p1", name: "我",   color: "#FFB5A7" },
  { id: "p2", name: "小琪", color: "#B8E0D2" },
  { id: "p3", name: "安安", color: "#FCD5CE" },
];
state.baseCurrency = state.baseCurrency || "TWD";
state.rates = state.rates || {
  TWD: 1, JPY: 4.78, USD: 0.032, KRW: 41.6, THB: 1.08,
  EUR: 0.029, GBP: 0.025, HKD: 0.247, CNY: 0.227, SGD: 0.043,
  VND: 778, AUD: 0.048,
};

// 舊版 expense 格式 { who, item, amt } → 新版 { id, paidBy, splitWith, ccy, amt, item }
state.expenses = (state.expenses || []).map(e => {
  if (!e.id) {
    // 找對應的 paidBy id（用名字配對 state.people）
    const person = state.people.find(p => p.name === e.who) || state.people[0];
    return {
      id: "e_" + Math.random().toString(36).slice(2, 8),
      paidBy: e.paidBy || person.id,
      splitWith: e.splitWith || state.people.map(p => p.id),
      item: e.item,
      amt: e.amt,
      ccy: e.ccy || state.baseCurrency,
    };
  }
  // 已有 id 的補充欄位
  if (!e.ccy) e.ccy = state.baseCurrency;
  if (!e.splitWith) e.splitWith = state.people.map(p => p.id);
  if (!e.paidBy) e.paidBy = state.people[0].id;
  return e;
});

// 行前準備：把舊的「平面陣列」格式遷移成「分類」格式
if (Array.isArray(state.prep)) {
  const isLegacyFlat = state.prep.length > 0 && !("items" in state.prep[0]) && !("subcats" in state.prep[0]);
  if (isLegacyFlat) {
    state.prep = [{ id: "cat-default", name: "📋 待辦事項", subcats: [{ id: "sub-all-cat-default", name: "📋 全部", items: state.prep }] }];
  }
}
if (!Array.isArray(state.prep) || state.prep.length === 0) {
  state.prep = [
    { id: "cat-todo",    name: "📋 待辦事項", subcats: [] },
    { id: "cat-packing", name: "🎒 行李清單",  subcats: [] },
  ];
}
// 遷移 items → subcats（v2 格式）
state.prep.forEach(c => {
  if (!Array.isArray(c.subcats)) {
    const oldItems = Array.isArray(c.items) ? c.items : [];
    c.subcats = oldItems.length > 0
      ? [{ id: "sub-all-" + c.id, name: "📋 全部", items: oldItems }]
      : [];
  }
  c.subcats.forEach(sub => { if (!Array.isArray(sub.items)) sub.items = []; });
  delete c.items; // 清掉舊欄位避免混淆
});

// 幫舊景點補上：分類、多段交通、照片陣列、購物清單
Object.values(state.days).forEach(d => d.forEach(s => {
  if (!s.category) s.category = "sight";
  // 把舊版單段 travelMode/Mins 搬到新版 travelLegs
  if (!("travelLegs" in s)) {
    if (s.travelMode && typeof s.travelMins === "number") {
      s.travelLegs = [{ mode: s.travelMode, mins: s.travelMins }];
    } else {
      s.travelLegs = null;
    }
    delete s.travelMode;
    delete s.travelMins;
  }
  // 舊版 photo（單張字串）→ 新版 photos（陣列）
  if (!Array.isArray(s.photos)) {
    s.photos = s.photo ? [s.photo] : [];
    delete s.photo;
  }
  // 購物 / 行動清單
  if (!s.shopItems) s.shopItems = [];
  // 景點費用幣別（舊資料補預設）
  if (!s.costCcy) s.costCcy = state.baseCurrency;
}));

function persist() { saveTrip(TRIP_ID, state); }

let nextSpotId = 1, nextPrepId = 1, nextShopItemId = 1;
Object.values(state.days).forEach(d =>
  d.forEach(s => {
    if (s.id >= nextSpotId) nextSpotId = s.id + 1;
    (s.shopItems || []).forEach(it => { if (it.id >= nextShopItemId) nextShopItemId = it.id + 1; });
  })
);
state.prep.forEach(cat =>
  (cat.subcats || []).forEach(sub =>
    sub.items.forEach(p => { if (p.id >= nextPrepId) nextPrepId = p.id + 1; })
  )
);

// ========== DOM 快取 ==========
const $ = id => document.getElementById(id);
const timelineEl   = $("timeline");
const dayTabsEl    = $("dayTabs");
const spotModal    = $("spotModal");
const travelModal  = $("travelModal");
const inviteModal  = $("inviteModal");
const aiTipsEl     = $("aiTips");
const expenseListEl= $("expenseList");
const titleEl      = $("tripTitleH1");
const datesEl      = $("tripDatesP");

// ========== 標題、日期（inline 編輯） ==========
titleEl.textContent = state.meta.title || "我的旅行";
datesEl.textContent = state.meta.dates || "點我設定日期…";
titleEl.addEventListener("input", () => {
  state.meta.title = titleEl.textContent.trim();
  persist();
});
datesEl.addEventListener("input", () => {
  state.meta.dates = datesEl.textContent.trim();
  persist();
  renderDayTabs(); // 重算每天的日期標籤
});

// ========== 日期工具 ==========
const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

function parseTripStartDate() {
  const dates = state.meta.dates || "";
  const m = dates.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function getDayLabel(dayNum) {
  const start = parseTripStartDate();
  if (!start) return null;
  const d = new Date(start.getTime());
  d.setDate(d.getDate() + dayNum - 1);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_ZH[d.getDay()]})`;
}

function parseTimeFromStr(str) {
  const m = (str || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// ========== 時間工具 ==========
function toMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return 540; // 預設 09:00
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// ========== 景點分類 ==========
const SPOT_CATEGORIES = [
  { id: "sight",    emoji: "📍", label: "景點" },
  { id: "shopping", emoji: "🛍️", label: "購物" },
  { id: "food",     emoji: "🍜", label: "餐廳" },
  { id: "hotel",    emoji: "🏨", label: "住宿" },
  { id: "other",    emoji: "✨", label: "其他" },
];
function spotCat(id) {
  return SPOT_CATEGORIES.find(c => c.id === id) || SPOT_CATEGORIES[0];
}

// ========== 💱 幣別與匯率 ==========
const CURRENCIES = [
  { code: "TWD", symbol: "NT$", name: "新台幣" },
  { code: "JPY", symbol: "¥",   name: "日圓" },
  { code: "USD", symbol: "US$", name: "美金" },
  { code: "KRW", symbol: "₩",   name: "韓元" },
  { code: "THB", symbol: "฿",   name: "泰銖" },
  { code: "EUR", symbol: "€",   name: "歐元" },
  { code: "GBP", symbol: "£",   name: "英鎊" },
  { code: "HKD", symbol: "HK$", name: "港幣" },
  { code: "CNY", symbol: "¥",   name: "人民幣" },
  { code: "SGD", symbol: "S$",  name: "新加坡元" },
  { code: "VND", symbol: "₫",   name: "越南盾" },
  { code: "AUD", symbol: "A$",  name: "澳元" },
];
function ccyInfo(code) {
  return CURRENCIES.find(c => c.code === code) || { code, symbol: code, name: code };
}
// rates[X] 的語意：1 TWD = rates[X] 個 X 幣
// 公式：amount * rates[to] / rates[from]
function convertAmount(amt, fromCcy, toCcy, rates = state.rates) {
  if (!fromCcy || !toCcy || fromCcy === toCcy) return amt;
  const f = rates[fromCcy], t = rates[toCcy];
  if (!f || !t) return amt;
  return (amt * t) / f;
}
function formatMoney(amt, ccy) {
  const info = ccyInfo(ccy);
  return `${info.symbol} ${Math.round(amt).toLocaleString()}`;
}
function getPerson(id) {
  return state.people.find(p => p.id === id) || { id, name: "?", color: "#ccc" };
}

// ========== 交通時間估算（多段轉乘） ==========
const TRANSIT_MODES = ["🚶 步行", "🚇 電車", "🚌 公車", "🚕 計程車", "🚴 自行車", "🚗 自駕"];

function defaultTransit(from, to) {
  // 沒填過交通時，用簡單估算（之後可以接 Google Directions API）
  const seed = (from.name.length + (to?.name.length || 0)) * 7;
  const minutes = 10 + (seed % 35);
  return { mode: TRANSIT_MODES[seed % 4], minutes };
}
// 統一回傳格式：{ legs: [...], totalMins, isCustom }
function getTransit(from, to) {
  const legs = from.travelLegs;
  if (Array.isArray(legs) && legs.length > 0) {
    const totalMins = legs.reduce((n, l) => n + (Math.max(0, +l.mins) || 0), 0);
    return { legs, totalMins, isCustom: true };
  }
  const def = defaultTransit(from, to);
  return {
    legs: [{ mode: def.mode, mins: def.minutes }],
    totalMins: def.minutes,
    isCustom: false,
  };
}
function suggestTransport(mins) {
  if (mins <= 15) return "走路就到，順便散步";
  if (mins <= 30) return "搭公車 or 電車最順";
  return "建議叫車，省力氣";
}

// ========== 「下一站關係」快照 ==========
// 用來偵測景點移動 / 刪除後，哪些景點的「下一站」變了 → 那段交通就應該重置
// 因為原本填的「公車 35 分 從伏見到清水」，下一站換成飯店時就不適用了
function snapshotNextMap(list) {
  const map = {};
  list.forEach((s, i) => { map[s.id] = list[i + 1]?.id ?? null; });
  return map;
}
function invalidateChangedEdges(list, oldNextMap) {
  let changed = 0;
  list.forEach((s, i) => {
    const newNext = list[i + 1]?.id ?? null;
    if (oldNextMap[s.id] !== newNext) {
      if (s.travelLegs) changed++;
      s.travelLegs = null;   // 回到 AI 估算
    }
  });
  return changed;
}

// ========== 時間自動連動（核心邏輯） ==========
// 從 fromIdx 開始（含）往後重算每個景點的 start
// 第 0 個景點保持使用者設定的時間，其他 = 前一個的 start + 停留 + 交通
function cascadeTimesForDay(dayKey, fromIdx = 1) {
  const spots = state.days[dayKey];
  if (!spots || spots.length === 0) return;
  for (let i = Math.max(fromIdx, 1); i < spots.length; i++) {
    const prev = spots[i - 1];
    const { totalMins } = getTransit(prev, spots[i]);
    spots[i].start = toHHMM(toMinutes(prev.start) + (prev.dur || 0) + totalMins);
  }
}
function cascadeTimes(fromIdx = 1) {
  cascadeTimesForDay(state.currentDay, fromIdx);
}

// ============================================================
// 日期分頁
// ============================================================
function renderDayTabs() {
  const days = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  dayTabsEl.innerHTML = "";
  days.forEach(d => {
    const label = getDayLabel(d);
    const canDelete = days.length > 1;
    const btn = document.createElement("button");
    btn.className = "day-tab" + (d === state.currentDay ? " active" : "");
    btn.dataset.day = d;
    btn.innerHTML = `
      <span class="day-tab-top">
        <span>Day ${d}</span>
        ${canDelete ? `<span class="tab-del" data-del-day="${d}" title="刪除第 ${d} 天">×</span>` : ""}
      </span>
      ${label ? `<small>${label}</small>` : ""}
    `;
    dayTabsEl.appendChild(btn);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "day-tab add";
  addBtn.id = "addDayBtn";
  addBtn.title = "新增一天";
  addBtn.textContent = "＋";
  dayTabsEl.appendChild(addBtn);
}

function deleteDay(dayKey) {
  const days = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  if (days.length <= 1) { alert("至少要留一天喔！"); return; }
  const spotCount = (state.days[dayKey] || []).length;
  const msg = spotCount > 0
    ? `真的要刪除 Day ${dayKey} 嗎？\n這天還有 ${spotCount} 個景點，一起消失了 🥲`
    : `真的要刪除 Day ${dayKey} 嗎？`;
  if (!confirm(msg)) return;

  delete state.days[dayKey];

  // 重新連續編號（避免 Day 1,3,4 這種間斷）
  const remaining = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  const newDays = {};
  remaining.forEach((oldKey, i) => { newDays[i + 1] = state.days[oldKey]; });
  state.days = newDays;

  // currentDay 超出範圍就夾到最大天
  const maxDay = Math.max(...Object.keys(state.days).map(Number));
  if (state.currentDay > maxDay) state.currentDay = maxDay;
  // 若刪的是當前天，顯示前一天或第一天
  if (!state.days[state.currentDay]) state.currentDay = 1;

  persist();
  renderAll();
}

dayTabsEl.addEventListener("click", e => {
  // 點到刪除按鈕
  const delBtn = e.target.closest("[data-del-day]");
  if (delBtn) {
    e.stopPropagation();
    deleteDay(+delBtn.dataset.delDay);
    return;
  }
  const tab = e.target.closest(".day-tab");
  if (!tab) return;
  if (tab.id === "addDayBtn") {
    addNewDay();
    persist();
    renderAll();
    return;
  }
  state.currentDay = +tab.dataset.day;
  persist();
  renderAll();
});

function addNewDay() {
  const nums = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  const lastDayKey = nums.length ? nums[nums.length - 1] : 0;
  const lastDaySpots = state.days[lastDayKey] || [];
  const lastSpot = lastDaySpots[lastDaySpots.length - 1];
  const newDayKey = lastDayKey + 1;
  state.days[newDayKey] = [];

  // 🏨 上一天最後一個是住宿 → 自動帶入新一天當第一個景點
  if (lastSpot && lastSpot.category === "hotel") {
    state.days[newDayKey].push({
      id: nextSpotId++,
      name: lastSpot.name,
      category: "hotel",
      addr: lastSpot.addr || "",
      start: "08:00",
      dur: 30,        // 預設 30 分鐘整理 / 退房
      cost: 0,
      photo: "",
      note: "🌅 從這裡出發",
      travelLegs: null,
    });
  }
  state.currentDay = newDayKey;
}

// ============================================================
// 時間軸：景點卡片 + 交通方塊
// ============================================================
function renderTimeline() {
  const spots = state.days[state.currentDay] || [];
  timelineEl.innerHTML = "";

  if (spots.length === 0) {
    timelineEl.innerHTML = `
      <div class="empty-day">
        <div style="font-size:48px;">🌤️</div>
        <p>這一天還沒有安排，<br/>按下方的「新增景點」開始規劃吧！</p>
      </div>`;
    return;
  }

  spots.forEach((spot, i) => {
    timelineEl.appendChild(buildSpotCard(spot, i, spots.length));
    if (i < spots.length - 1) {
      timelineEl.appendChild(buildTransit(spot, spots[i + 1], i));
    }
  });
}

function buildSpotCard(spot, idx, total) {
  const card = document.createElement("div");
  card.className = "spot-card cat-" + (spot.category || "sight");
  card.draggable = true;
  card.dataset.spotId = spot.id;

  const cat = spotCat(spot.category);
  const isLast = idx === total - 1;
  // 最後一個是住宿 → 顯示「過夜」，不算停留時間
  const isLastHotel = isLast && spot.category === "hotel";

  const mapQuery = encodeURIComponent(spot.addr || spot.name);
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;
  const photos = Array.isArray(spot.photos) ? spot.photos : [];
  const shopItems = Array.isArray(spot.shopItems) ? spot.shopItems : [];
  const hasMemory = !!(photos.length || spot.note);

  card.innerHTML = `
    <div class="spot-main">
      <div class="spot-time" title="點我改時間">
        <div class="start">${spot.start}</div>
        <div class="dur">${isLastHotel ? "🛌 過夜" : "停留 " + (spot.dur || 0) + " 分"}</div>
      </div>
      <div class="spot-body" data-edit="${spot.id}" title="點擊編輯">
        <h3>
          <span class="cat-icon">${cat.emoji}</span>
          ${escapeHtml(spot.name)}
          <span class="cat-pill">${cat.label}</span>
        </h3>
        <p class="addr">${escapeHtml(spot.addr || "（尚未填入地址）")}</p>
        <div class="chips">
          <a class="chip map" href="${mapUrl}" target="_blank" rel="noopener"
             onclick="event.stopPropagation()">🗺️ 開地圖</a>
          ${spot.cost > 0 ? `<span class="chip cost">💴 ${spot.cost} TWD</span>` : ""}
          ${photos.length > 0 ? `<span class="chip photo-chip">📷 ${photos.length}</span>` : ""}
          ${shopItems.length > 0 ? `<button class="chip shop-chip" data-shop-toggle title="展開購物 / 行動清單">🛍️ <span class="shop-count">${shopItems.filter(i=>i.done).length}/${shopItems.length}</span></button>` : ""}
        </div>
      </div>
      <div class="spot-actions">
        <span class="drag-handle" title="拖拉排序">⋮⋮</span>
        <button class="icon-btn" data-act="edit" data-id="${spot.id}" title="編輯">✎</button>
        <button class="icon-btn" data-act="move" data-id="${spot.id}" title="移到別天 / 複製">📅</button>
        <button class="icon-btn del" data-act="del" data-id="${spot.id}" title="刪除">✕</button>
      </div>
    </div>
    ${hasMemory ? `
      <div class="spot-memory">
        ${photos.length > 0 ? `<div class="memory-photos">${photos.map(p => `<img class="memory-photo" src="${p}" alt="旅行照片" />`).join("")}</div>` : ""}
        ${spot.note ? `<p class="memory-note">${escapeHtml(spot.note)}</p>` : ""}
      </div>
    ` : ""}
  `;

  // 點 body → 開編輯 modal
  card.querySelector("[data-edit]").addEventListener("click", () => {
    openSpotModalForEdit(spot.id);
  });
  // 按鈕動作
  card.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      handleSpotAction(btn.dataset.act, +btn.dataset.id);
    });
  });
  // 點時間 → inline 改時間
  card.querySelector(".spot-time").addEventListener("click", e => {
    e.stopPropagation();
    inlineEditTime(card, spot);
  });
  // 拖拉
  attachDragHandlers(card, spot.id);

  // 購物 / 行動清單（展開 panel）
  if (shopItems.length > 0) {
    const toggleBtn = card.querySelector("[data-shop-toggle]");
    const panel = document.createElement("div");
    panel.className = "spot-shop-panel";
    panel.hidden = true;
    card.appendChild(panel);

    function refreshShopPanel() {
      const items = spot.shopItems || [];
      panel.innerHTML = `<div class="spot-shop-panel-head">🛍️ 購物 / 行動清單</div>`;
      const ul = document.createElement("ul");
      ul.className = "spot-shop-panel-list";
      items.forEach(it => {
        const li = document.createElement("li");
        li.className = "spot-shop-panel-item" + (it.done ? " done" : "");
        li.innerHTML = `<label><input type="checkbox" ${it.done ? "checked" : ""} /><span>${escapeHtml(it.text)}</span></label>`;
        li.querySelector("input").addEventListener("change", e => {
          e.stopPropagation();
          it.done = e.target.checked;
          li.classList.toggle("done", it.done);
          persist();
          const done = items.filter(i => i.done).length;
          const countEl = toggleBtn?.querySelector(".shop-count");
          if (countEl) countEl.textContent = `${done}/${items.length}`;
        });
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    }
    refreshShopPanel();

    toggleBtn.addEventListener("click", e => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });
  }

  return card;
}

function buildTransit(from, to, fromIdx) {
  const { legs, totalMins, isCustom } = getTransit(from, to);
  const totalCost = legs.reduce((n, l) => n + (+l.cost || 0), 0);
  const div = document.createElement("div");
  div.className = "transit" + (legs.length > 1 ? " multi" : "");
  div.dataset.fromIdx = fromIdx;

  const legsHTML = legs.map((leg, i) => {
    const route = (leg.from || leg.to)
      ? `<small class="leg-route">${escapeHtml(leg.from || "?")} → ${escapeHtml(leg.to || "?")}</small>`
      : "";
    const costChip = (+leg.cost > 0)
      ? `<span class="leg-cost-chip">💴 ${leg.cost}</span>` : "";
    return `
      <div class="leg-row-display">
        ${legs.length > 1 ? `<span class="leg-num-dot">${i + 1}</span>` : ""}
        <span class="mode">${leg.mode}</span>
        <span class="leg-mins">${leg.mins} 分</span>
        ${costChip}
        ${route}
      </div>`;
  }).join("");

  div.innerHTML = `
    <div class="legs">${legsHTML}</div>
    <div class="transit-foot">
      <small class="suggest">${isCustom ? "" : "AI 估算 · "}共 ${totalMins} 分${
        totalCost > 0 ? ` · 💴 ${totalCost} TWD` : ""
      }${totalMins ? ` · ${suggestTransport(totalMins)}` : ""}</small>
      <button class="icon-btn tiny transit-edit" title="編輯交通方式">✎</button>
    </div>
  `;
  div.querySelector(".transit-edit").addEventListener("click", e => {
    e.stopPropagation();
    openTransitEditor(from);
  });
  return div;
}

// ============================================================
// 景點動作：編輯 / 刪除
// ============================================================
function handleSpotAction(act, id) {
  const list = state.days[state.currentDay];
  const i = list.findIndex(s => s.id === id);
  if (i < 0) return;

  if (act === "del") {
    if (!confirm("真的要刪掉這個景點嗎？🥲")) return;
    const oldNextMap = snapshotNextMap(list);
    list.splice(i, 1);
    // 上一個景點原本指向被刪的這個，現在指向別人 → 重置它的交通設定
    invalidateChangedEdges(list, oldNextMap);
    cascadeTimes(Math.max(i, 1));
  } else if (act === "edit") {
    openSpotModalForEdit(id);
    return;
  } else if (act === "move") {
    openMoveModal(id);
    return;
  }
  persist();
  renderAll();
}

// ============================================================
// 📦 把景點移動 / 複製到別天
// ============================================================
function moveOrCopySpot(spotId, targetDayKey, mode /* "copy" | "move" */) {
  const srcDay = state.currentDay;
  const srcList = state.days[srcDay];
  const i = srcList.findIndex(s => s.id === spotId);
  if (i < 0) return;
  if (+targetDayKey === +srcDay) return;

  if (!state.days[targetDayKey]) state.days[targetDayKey] = [];
  const tgtList = state.days[targetDayKey];

  // 取得要加進目標天的「景點物件」
  let spot;
  if (mode === "copy") {
    // 深複製，新 id，照片/小記都帶過去；交通設定重置（連的下一站不一樣）
    spot = JSON.parse(JSON.stringify(srcList[i]));
    spot.id = nextSpotId++;
  } else {
    // 移動：從來源天移除，重置來源天受影響景點的交通
    const oldNextMapSrc = snapshotNextMap(srcList);
    spot = srcList.splice(i, 1)[0];
    invalidateChangedEdges(srcList, oldNextMapSrc);
  }
  spot.travelLegs = null;  // 跨天後的「下一站」不一樣，交通設定重置

  // 加到目標天的尾端
  if (tgtList.length > 0) {
    // 原本最後一位現在多了下一站 → 它的 travelLegs 重置
    const oldNextMapTgt = snapshotNextMap(tgtList);
    tgtList[tgtList.length - 1].travelLegs = null;
    tgtList.push(spot);
    invalidateChangedEdges(tgtList, oldNextMapTgt);
    // 重新算新景點的開始時間（接續在原最後一位後面）
    const prev = tgtList[tgtList.length - 2];
    const { totalMins } = getTransit(prev, spot);
    spot.start = toHHMM(toMinutes(prev.start) + (prev.dur || 0) + totalMins);
  } else {
    // 目標天是空的 → 當作第一個景點，預設早上 09:00
    spot.start = "09:00";
    tgtList.push(spot);
  }

  // 兩天的時間都重新連動
  if (mode === "move") cascadeTimesForDay(srcDay, Math.max(i, 1));
  cascadeTimesForDay(targetDayKey, 1);

  // 自動跳到目標天，方便看
  state.currentDay = +targetDayKey;
  persist();
  renderAll();
}

const spotMoveModal = $("spotMoveModal");
function openMoveModal(spotId) {
  const spot = state.days[state.currentDay].find(s => s.id === spotId);
  if (!spot) return;

  $("moveModalSpot").innerHTML =
    `「<b>${escapeHtml(spot.name)}</b>」 目前在 <b>Day ${state.currentDay}</b>`;

  const days = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  const otherDays = days.filter(d => d !== state.currentDay);

  function buildBtns(mode) {
    if (otherDays.length === 0) {
      return `<p class="muted small">目前只有這一天，先在頂部按 ＋ 新增一天 🌱</p>`;
    }
    return otherDays.map(d => {
      const count = (state.days[d] || []).length;
      return `<button class="day-pick-btn" data-day="${d}" data-mode="${mode}">
        Day ${d} <small>(${count} 個景點)</small>
      </button>`;
    }).join("");
  }

  $("copyDayList").innerHTML = buildBtns("copy");
  $("moveDayList").innerHTML = buildBtns("move");

  spotMoveModal.querySelectorAll(".day-pick-btn").forEach(b => {
    b.addEventListener("click", () => {
      moveOrCopySpot(spotId, +b.dataset.day, b.dataset.mode);
      closeModal(spotMoveModal);
    });
  });

  openModal(spotMoveModal);
}

// ============================================================
// Inline 改時間
// ============================================================
function inlineEditTime(card, spot) {
  const wrapper = card.querySelector(".spot-time");
  wrapper.classList.add("editing");
  const oldHTML = wrapper.innerHTML;
  wrapper.innerHTML = `
    <input type="time" class="inline-time" value="${spot.start}" />
    <input type="number" class="inline-dur" value="${spot.dur}" min="15" step="15" title="停留分鐘" />
  `;
  const timeInput = wrapper.querySelector(".inline-time");
  const durInput = wrapper.querySelector(".inline-dur");
  timeInput.focus();

  let saved = false;
  function save() {
    if (saved) return; saved = true;
    const idx = state.days[state.currentDay].findIndex(s => s.id === spot.id);
    spot.start = timeInput.value || spot.start;
    spot.dur = +durInput.value || spot.dur;
    cascadeTimes(idx + 1);
    persist();
    renderAll();
  }
  function cancel() { if (saved) return; saved = true; wrapper.innerHTML = oldHTML; wrapper.classList.remove("editing"); }
  [timeInput, durInput].forEach(inp => {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") cancel();
    });
  });
  // 點外面 → 存
  setTimeout(() => {
    document.addEventListener("click", function once(e) {
      if (!wrapper.contains(e.target)) {
        document.removeEventListener("click", once);
        save();
      }
    });
  }, 0);
}

// ============================================================
// 拖拉排序
// ============================================================
let dragId = null;
function attachDragHandlers(card, id) {
  card.addEventListener("dragstart", e => {
    dragId = id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(id)); } catch {}
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document.querySelectorAll(".spot-card").forEach(c =>
      c.classList.remove("drop-above", "drop-below")
    );
  });
  card.addEventListener("dragover", e => {
    e.preventDefault();
    if (dragId == null || dragId === id) return;
    const rect = card.getBoundingClientRect();
    const isAbove = e.clientY < rect.top + rect.height / 2;
    card.classList.toggle("drop-above", isAbove);
    card.classList.toggle("drop-below", !isAbove);
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("drop-above", "drop-below");
  });
  card.addEventListener("drop", e => {
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    card.classList.remove("drop-above", "drop-below");
    if (dragId != null && dragId !== id) {
      moveSpot(dragId, id, before);
    }
    dragId = null;
  });
}

function moveSpot(sourceId, targetId, before) {
  const list = state.days[state.currentDay];
  if (!list || list.length === 0) return;
  // 🔑 拖動前先記下：（1）當天起始時間 （2）每個景點的「下一站」是誰
  const dayStart = list[0].start;
  const oldNextMap = snapshotNextMap(list);

  const srcIdx = list.findIndex(s => s.id === sourceId);
  if (srcIdx < 0) return;
  const [moved] = list.splice(srcIdx, 1);

  let tgtIdx = list.findIndex(s => s.id === targetId);
  if (tgtIdx < 0) tgtIdx = list.length;
  if (!before) tgtIdx += 1;
  list.splice(tgtIdx, 0, moved);

  // 「下一站」變了的景點 → 把它的交通方式清掉（不然原本是飛去 A，現在卻接到 B，路線完全錯）
  invalidateChangedEdges(list, oldNextMap);

  // 重設當天起始時間，再讓後面所有景點按交通時間連動
  if (list[0]) list[0].start = dayStart;
  cascadeTimes(1);
  persist();
  renderAll();
}

// ============================================================
// 交通方式 Modal（多段轉乘）
// ============================================================
const transitModal = $("transitModal");
let editingTransit = null;     // { fromSpot, idx }
let workingLegs = [];          // 編輯中的暫存資料

function openTransitEditor(fromSpot) {
  const spots = state.days[state.currentDay];
  const idx = spots.findIndex(s => s.id === fromSpot.id);
  if (idx < 0 || idx === spots.length - 1) return;
  const toSpot = spots[idx + 1];

  editingTransit = { fromSpot, idx };
  $("transitFromTo").innerHTML =
    `從「<b>${escapeHtml(fromSpot.name)}</b>」到「<b>${escapeHtml(toSpot.name)}</b>」`;

  // Google Maps 路線連結
  const fromQ = encodeURIComponent((fromSpot.addr || fromSpot.name).trim());
  const toQ   = encodeURIComponent((toSpot.addr  || toSpot.name).trim());
  const mapsLink = $("transitMapsLink");
  if (mapsLink) {
    mapsLink.href = `https://www.google.com/maps/dir/${fromQ}/${toQ}`;
    mapsLink.hidden = false;
  }

  // 載入目前的 legs（深複製，按取消才不會改到原本的）
  const current = getTransit(fromSpot, toSpot);
  workingLegs = current.legs.map(l => ({ ...l }));
  if (workingLegs.length === 0) {
    workingLegs.push({ mode: "🚶 步行", mins: 10, from: "", to: "" });
  }

  renderLegsInModal();
  transitModal.hidden = false;
}

function renderLegsInModal() {
  const list = $("legsList");
  list.innerHTML = "";
  workingLegs.forEach((leg, i) => {
    const row = document.createElement("div");
    row.className = "leg-row";
    row.innerHTML = `
      <span class="leg-num">${i + 1}</span>
      <select class="leg-mode">
        ${TRANSIT_MODES.map(m =>
          `<option ${m === leg.mode ? "selected" : ""}>${m}</option>`).join("")}
      </select>
      <input type="number" class="leg-mins" min="0" max="240" value="${leg.mins || 0}" />
      <span class="leg-mins-label">分</span>
      <input type="number" class="leg-cost" min="0" placeholder="費用" value="${leg.cost || 0}" />
      <span class="leg-cost-label">TWD</span>
      <button class="icon-btn tiny del leg-del-btn" title="刪除這段">✕</button>
      <input type="text" class="leg-from" placeholder="從哪裡" value="${escapeHtml(leg.from || "")}" />
      <span class="leg-arrow">→</span>
      <input type="text" class="leg-to" placeholder="到哪裡" value="${escapeHtml(leg.to || "")}" />
    `;
    list.appendChild(row);

    row.querySelector(".leg-mode").addEventListener("change", e => {
      workingLegs[i].mode = e.target.value;
    });
    row.querySelector(".leg-mins").addEventListener("input", e => {
      workingLegs[i].mins = Math.max(0, +e.target.value || 0);
      updateLegsTotal();
    });
    row.querySelector(".leg-cost").addEventListener("input", e => {
      workingLegs[i].cost = Math.max(0, +e.target.value || 0);
      updateLegsTotal();
    });
    row.querySelector(".leg-from").addEventListener("input", e => {
      workingLegs[i].from = e.target.value;
    });
    row.querySelector(".leg-to").addEventListener("input", e => {
      workingLegs[i].to = e.target.value;
    });
    row.querySelector(".leg-del-btn").addEventListener("click", () => {
      workingLegs.splice(i, 1);
      if (workingLegs.length === 0) {
        workingLegs.push({ mode: "🚶 步行", mins: 5, from: "", to: "", cost: 0 });
      }
      renderLegsInModal();
    });
  });
  updateLegsTotal();
}

function updateLegsTotal() {
  const totMins = workingLegs.reduce((n, l) => n + (+l.mins || 0), 0);
  const totCost = workingLegs.reduce((n, l) => n + (+l.cost || 0), 0);
  $("legsTotal").textContent = totMins;
  const costEl = $("legsTotalCost");
  if (costEl) costEl.textContent = totCost.toLocaleString();
}

$("addLegBtn").addEventListener("click", () => {
  // 上一段的「到」自動接成新一段的「從」
  const last = workingLegs[workingLegs.length - 1];
  workingLegs.push({
    mode: "🚶 步行",
    mins: 5,
    from: last?.to || "",
    to: "",
    cost: 0,
  });
  renderLegsInModal();
});

$("saveLegsBtn").addEventListener("click", () => {
  if (!editingTransit) return;
  const { fromSpot, idx } = editingTransit;
  // 只存有時間或有費用或有路線的段
  const cleaned = workingLegs
    .filter(l => (+l.mins > 0) || (+l.cost > 0) || l.from || l.to)
    .map(l => ({
      mode: l.mode,
      mins: Math.max(0, +l.mins || 0),
      cost: Math.max(0, +l.cost || 0),
      from: (l.from || "").trim(),
      to:   (l.to   || "").trim(),
    }));
  fromSpot.travelLegs = cleaned.length > 0 ? cleaned : null;
  cascadeTimes(idx + 1);
  persist();
  closeModal(transitModal);
  renderAll();
});

// ============================================================
// 新增 / 編輯 景點 Modal
// ============================================================
let editingSpotId = null;
let tempPhotos = [];    // 編輯中的照片陣列（最多 3 張）
let tempShopItems = []; // 編輯中的購物清單
let chosenCategory = "sight";

// 景點幣別下拉（初始化一次）
$("spotCostCcy").innerHTML = CURRENCIES.map(c =>
  `<option value="${c.code}">${c.symbol} ${c.code}</option>`
).join("");

// 建構分類選擇器
const catPicker = $("catPicker");
catPicker.innerHTML = SPOT_CATEGORIES.map(c =>
  `<button type="button" data-cat-id="${c.id}">${c.emoji} ${c.label}</button>`
).join("");
catPicker.addEventListener("click", e => {
  const b = e.target.closest("[data-cat-id]");
  if (!b) return;
  setCategory(b.dataset.catId);
});

function setCategory(id) {
  chosenCategory = id;
  catPicker.querySelectorAll("button").forEach(b =>
    b.classList.toggle("active", b.dataset.catId === id)
  );
  // 切到住宿 → 提示不用停留時間
  $("durHint").textContent = id === "hotel" ? "（住宿可填 0，當作過夜）" : "";
}

$("addSpotBtn").addEventListener("click", openSpotModalForNew);

function openSpotModalForNew() {
  editingSpotId = null;
  $("spotModalTitle").textContent = "📍 新增一個景點";
  $("saveSpot").textContent = "加進行程";
  resetSpotForm();
  // 預設時間：接續前一個景點
  const spots = state.days[state.currentDay];
  if (spots.length > 0) {
    const last = spots[spots.length - 1];
    const { totalMins } = getTransit(last, null);
    const nextStart = toMinutes(last.start) + (last.dur || 0) + totalMins;
    $("spotStart").value = toHHMM(nextStart);
  }
  spotModal.hidden = false;
  setTimeout(() => $("spotName").focus(), 50);
}

function openSpotModalForEdit(id) {
  const spot = state.days[state.currentDay].find(s => s.id === id);
  if (!spot) return;
  editingSpotId = id;
  $("spotModalTitle").textContent = "✏️ 編輯景點";
  $("saveSpot").textContent = "儲存變更";
  $("spotName").value = spot.name;
  $("spotAddr").value = spot.addr || "";
  $("spotStart").value = spot.start;
  $("spotDur").value = spot.dur || 0;
  $("spotCost").value = spot.cost || 0;
  $("spotCostCcy").value = spot.costCcy || state.baseCurrency;
  $("spotNote").value = spot.note || "";
  setCategory(spot.category || "sight");
  tempPhotos = Array.isArray(spot.photos) ? [...spot.photos] : [];
  tempShopItems = (spot.shopItems || []).map(it => ({ photo: "", ...it }));
  renderPhotoGallery();
  renderSpotShopList();
  $("addrHint").textContent = "";
  spotModal.hidden = false;
}

function resetSpotForm() {
  $("spotName").value = "";
  $("spotAddr").value = "";
  $("spotStart").value = "09:00";
  $("spotDur").value = 90;
  $("spotCost").value = 0;
  $("spotCostCcy").value = state.baseCurrency;
  $("spotNote").value = "";
  $("addrHint").textContent = "";
  setCategory("sight");
  tempPhotos = [];
  tempShopItems = [];
  renderPhotoGallery();
  renderSpotShopList();
  $("spotPhotoInput").value = "";
}

const MAX_PHOTOS = 3;

function renderPhotoGallery() {
  const gallery = $("photoGallery");
  const hint = $("photoGalleryHint");
  if (!gallery) return;
  // 保留 input 元素，清掉其他
  const fileInput = $("spotPhotoInput");
  gallery.innerHTML = "";
  if (fileInput) gallery.appendChild(fileInput);

  tempPhotos.forEach((src, i) => {
    const wrap = document.createElement("div");
    wrap.className = "photo-thumb-wrap";
    wrap.innerHTML = `
      <img class="photo-thumb" src="${src}" alt="照片 ${i+1}" />
      <button type="button" class="photo-thumb-del" data-idx="${i}" title="移除這張">✕</button>
    `;
    wrap.querySelector(".photo-thumb-del").addEventListener("click", () => {
      tempPhotos.splice(i, 1);
      renderPhotoGallery();
    });
    gallery.appendChild(wrap);
  });

  // 相機圖示 = 新增照片觸發器（如果還沒滿）
  if (tempPhotos.length < MAX_PHOTOS) {
    const addTrigger = document.createElement("label");
    addTrigger.className = "photo-add-placeholder";
    addTrigger.title = "點擊新增照片";
    addTrigger.htmlFor = "spotPhotoInput";
    addTrigger.textContent = "📷";
    gallery.appendChild(addTrigger);
  }

  if (hint) {
    hint.textContent = tempPhotos.length > 0
      ? `已選 ${tempPhotos.length} / ${MAX_PHOTOS} 張${tempPhotos.length >= MAX_PHOTOS ? "（已達上限）" : ""}`
      : `點相機圖示新增，最多 ${MAX_PHOTOS} 張`;
  }
}

function renderSpotShopList() {
  const ul = $("spotShopList");
  if (!ul) return;
  ul.innerHTML = "";
  if (tempShopItems.length === 0) {
    ul.innerHTML = `<li class="spot-shop-empty">（尚未新增，在下方輸入後按 ＋）</li>`;
    return;
  }
  tempShopItems.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "spot-shop-item" + (it.done ? " done" : "");
    // photo area（預設隱藏）
    const hasPhoto = !!it.photo;
    li.innerHTML = `
      <label>
        <input type="checkbox" ${it.done ? "checked" : ""} />
        <span class="spot-shop-text">${escapeHtml(it.text)}</span>
      </label>
      <button type="button" class="shop-item-photo-toggle icon-btn tiny" title="附加照片">📷</button>
      <button type="button" class="icon-btn tiny del" title="刪除">✕</button>
      <div class="shop-item-photo-wrap" hidden>
        ${hasPhoto ? `<img class="shop-item-photo-thumb" src="${it.photo}" alt="附圖" />` : ""}
        <label class="shop-item-photo-label">
          ${hasPhoto ? "🔄 換一張" : "📷 上傳照片"}
          <input type="file" accept="image/*" class="shop-item-photo-input" hidden />
        </label>
        ${hasPhoto ? `<button type="button" class="shop-item-photo-del btn btn-ghost" style="font-size:11px;padding:4px 8px;">🗑 移除</button>` : ""}
      </div>
    `;
    // 打勾
    li.querySelector("input[type=checkbox]").addEventListener("change", e => {
      tempShopItems[i].done = e.target.checked;
      li.classList.toggle("done", e.target.checked);
    });
    // 刪除項目
    li.querySelector(".del").addEventListener("click", () => {
      tempShopItems.splice(i, 1);
      renderSpotShopList();
    });
    // 展開 / 收合照片區
    const photoWrap = li.querySelector(".shop-item-photo-wrap");
    li.querySelector(".shop-item-photo-toggle").addEventListener("click", () => {
      photoWrap.hidden = !photoWrap.hidden;
    });
    // 上傳照片
    li.querySelector(".shop-item-photo-input").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        tempShopItems[i].photo = await fileToResizedDataURL(file, 600);
        renderSpotShopList();
      } catch { alert("😢 讀取照片失敗"); }
      e.target.value = "";
    });
    // 移除照片
    const delPhotoBtn = li.querySelector(".shop-item-photo-del");
    if (delPhotoBtn) {
      delPhotoBtn.addEventListener("click", () => {
        tempShopItems[i].photo = "";
        renderSpotShopList();
      });
    }
    ul.appendChild(li);
  });
}

$("spotPhotoInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (tempPhotos.length >= MAX_PHOTOS) {
    alert(`最多只能上傳 ${MAX_PHOTOS} 張照片喔！`);
    return;
  }
  try {
    const dataUrl = await fileToResizedDataURL(file, 800);
    tempPhotos.push(dataUrl);
    renderPhotoGallery();
  } catch {
    alert("😢 讀取照片失敗，換一張試試？");
  }
  e.target.value = "";
});

// 購物清單新增
function addShopItem() {
  const input = $("spotShopInput");
  const text = input.value.trim();
  if (!text) return;
  tempShopItems.push({ id: nextShopItemId++, text, done: false, photo: "" });
  input.value = "";
  renderSpotShopList();
}
$("spotShopAddBtn").addEventListener("click", addShopItem);
$("spotShopInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addShopItem(); } });

// ---- 地址自動查詢 ----
// 策略：先試 Photon（komoot，CORS 友好、日文效果佳），再試 Nominatim
async function lookupAddress(query) {
  const hintEl = $("addrHint");
  hintEl.textContent = "🔍 查詢中…";
  hintEl.style.color = "";

  // 1️⃣ Photon (komoot) — 免費、CORS 支援好
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=zh`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.features && data.features[0]) {
      const p = data.features[0].properties;
      const parts = [p.name, p.street && p.housenumber ? `${p.street} ${p.housenumber}` : (p.street || ""),
                     p.district, p.city, p.state, p.country].filter(Boolean);
      // 若第一個 name 跟查詢相同，就不重複顯示
      const addr = [...new Set(parts)].join(", ");
      if (addr) {
        $("spotAddr").value = addr;
        hintEl.textContent = "✅ 已帶入地址（來源：OpenStreetMap），可再手動調整";
        hintEl.style.color = "#3C8D6A";
        return;
      }
    }
  } catch {}

  // 2️⃣ Nominatim fallback
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=zh-TW,zh`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data && data[0]) {
      $("spotAddr").value = data[0].display_name;
      hintEl.textContent = "✅ 已帶入地址（來源：Nominatim），可再手動調整";
      hintEl.style.color = "#3C8D6A";
      return;
    }
  } catch {}

  // 兩個都失敗 → 提示用 Google Maps 複製
  const gUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  hintEl.innerHTML = `😅 自動查不到，請 <a href="${gUrl}" target="_blank" rel="noopener" style="color:#3A5BC7">開 Google Maps</a> 手動複製地址`;
  hintEl.style.color = "#C26B4A";
}

// 離開景點名稱欄位 → 若地址空，自動查
$("spotName").addEventListener("blur", () => {
  const name = $("spotName").value.trim();
  const addr = $("spotAddr").value.trim();
  if (name && !addr) lookupAddress(name);
});
// 「查地址」按鈕 → 永遠用景點名稱查（不用地址欄位的值）
$("lookupAddrBtn").addEventListener("click", () => {
  const q = $("spotName").value.trim();
  if (q) lookupAddress(q);
  else {
    $("addrHint").textContent = "請先填入景點名稱再查詢";
    $("addrHint").style.color = "#C26B4A";
  }
});

// ---- 存景點 ----
$("saveSpot").addEventListener("click", () => {
  const name = $("spotName").value.trim();
  if (!name) { alert("景點名稱不能空白喔 🐱"); return; }

  const data = {
    name,
    addr: $("spotAddr").value.trim(),
    start: $("spotStart").value,
    costCcy: $("spotCostCcy").value,
    dur: Math.max(0, +$("spotDur").value || 0),
    cost: +$("spotCost").value,
    note: $("spotNote").value.trim(),
    photos: [...tempPhotos],
    shopItems: tempShopItems.map(it => ({ ...it })),
    category: chosenCategory,
  };

  const list = state.days[state.currentDay];
  let changedIdx;
  if (editingSpotId) {
    const i = list.findIndex(s => s.id === editingSpotId);
    const old = list[i];
    Object.assign(old, data);
    changedIdx = i;
  } else {
    list.push({
      id: nextSpotId++,
      ...data,
      travelLegs: null,
    });
    changedIdx = list.length - 1;
    // 景點費用已透過「自動：景點門票」顯示，不需另存進 expenses 避免重複計算
  }
  // 新增／改了景點後，時間從這個點往後連動
  cascadeTimes(changedIdx + 1);
  persist();
  closeModal(spotModal);
  renderAll();
});

// ============================================================
// 去程 / 回程
// ============================================================
function renderTravel() {
  ["outbound", "return"].forEach(leg => {
    const body = $(leg + "Body");
    const data = state.travel[leg];
    if (!data) {
      body.innerHTML = `<span class="muted">點右側「✎」新增${leg === "outbound" ? "出發" : "回程"}方式</span>`;
      return;
    }
    // 出發：到達地點 → 設為 Day 1 第一站；回程：出發地 → 設為最後一天最後一站
    const autoPoint = leg === "outbound" ? data.arriveTo : data.departFrom;
    const autoLabel = leg === "outbound" ? "📍 設為 Day 1 第一站" : "📍 設為最後一站";

    body.innerHTML = `
      <div class="travel-line"><b>${escapeHtml(data.type || "")}</b> ${escapeHtml(data.number || "")}</div>
      <div class="travel-line">🛫 ${escapeHtml(data.departAt || "")} <small>${escapeHtml(data.departFrom || "")}</small></div>
      <div class="travel-line">🛬 ${escapeHtml(data.arriveAt || "")} <small>${escapeHtml(data.arriveTo || "")}</small></div>
      ${data.note ? `<div class="travel-note">📝 ${escapeHtml(data.note)}</div>` : ""}
      ${autoPoint ? `<button class="btn btn-ghost travel-auto-btn" data-auto-leg="${leg}">${autoLabel}</button>` : ""}
    `;

    if (autoPoint) {
      body.querySelector("[data-auto-leg]").addEventListener("click", () =>
        autoSetTravelSpot(leg, autoPoint, data)
      );
    }
  });
}

function autoSetTravelSpot(leg, point, travelData) {
  if (leg === "outbound") {
    if (!state.days[1]) state.days[1] = [];
    const day1 = state.days[1];
    if (day1[0]?.name === point) {
      alert(`Day 1 的第一站已經是「${point}」了 ✅`); return;
    }
    const arriveTime = parseTimeFromStr(travelData?.arriveAt) || "12:00";
    const newSpot = {
      id: nextSpotId++,
      name: point,
      category: "other",
      addr: point,
      start: arriveTime,
      dur: 0,
      cost: 0,
      photos: [],
      shopItems: [],
      note: `✈️ 抵達 ${point}`,
      travelLegs: null,
    };
    day1.unshift(newSpot);
    cascadeTimesForDay(1, 1);
    state.currentDay = 1;
    persist();
    renderAll();
    alert(`✅ 已將「${point}」加為 Day 1 第一站！`);
  } else {
    const days = Object.keys(state.days).map(Number).sort((a, b) => a - b);
    const lastKey = days[days.length - 1];
    const lastDay = state.days[lastKey] || [];
    if (lastDay[lastDay.length - 1]?.name === point) {
      alert(`最後一天的最後一站已經是「${point}」了 ✅`); return;
    }
    const prev = lastDay[lastDay.length - 1];
    const startTime = prev
      ? toHHMM(toMinutes(prev.start) + (prev.dur || 0) + 30)
      : parseTimeFromStr(travelData?.departAt) || "18:00";
    state.days[lastKey].push({
      id: nextSpotId++,
      name: point,
      category: "other",
      addr: point,
      start: startTime,
      dur: 0,
      cost: 0,
      photos: [],
      shopItems: [],
      note: `✈️ 從 ${point} 回程出發`,
      travelLegs: null,
    });
    state.currentDay = lastKey;
    persist();
    renderAll();
    alert(`✅ 已將「${point}」加為最後一天的最後一站！`);
  }
}

let editingLeg = null;
document.querySelectorAll("[data-leg-edit]").forEach(btn => {
  btn.addEventListener("click", () => openTravelModal(btn.dataset.legEdit));
});

function openTravelModal(leg) {
  editingLeg = leg;
  $("travelModalTitle").textContent =
    leg === "outbound" ? "✈️ 設定出發方式" : "🛬 設定回程方式";
  const d = state.travel[leg] || {};
  $("travelType").value = d.type || "✈️ 飛機";
  $("travelNumber").value  = d.number || "";
  $("travelDepart").value  = d.departAt || "";
  $("travelDepFrom").value = d.departFrom || "";
  $("travelArrive").value  = d.arriveAt || "";
  $("travelArrTo").value   = d.arriveTo || "";
  $("travelNote").value    = d.note || "";
  travelModal.hidden = false;
}

$("saveTravelBtn").addEventListener("click", () => {
  state.travel[editingLeg] = {
    type:       $("travelType").value,
    number:     $("travelNumber").value.trim(),
    departAt:   $("travelDepart").value.trim(),
    departFrom: $("travelDepFrom").value.trim(),
    arriveAt:   $("travelArrive").value.trim(),
    arriveTo:   $("travelArrTo").value.trim(),
    note:       $("travelNote").value.trim(),
  };
  persist();
  closeModal(travelModal);
  renderTravel();
});

$("clearTravelBtn").addEventListener("click", () => {
  if (!confirm("要清空這段資料嗎？")) return;
  state.travel[editingLeg] = null;
  persist();
  closeModal(travelModal);
  renderTravel();
});

// ============================================================
// 行前準備清單（分類版）
// ============================================================
const prepCatsEl = $("prepCategories");
// 記錄哪些分類是折疊狀態（key = cat.id）
const collapsedCats = new Set();  // Modal 子分類是否被使用者收合（"catId/subId"）— 預設展開
const openCats = new Set();       // 側邊欄分類是否展開（cat.id）— 預設收合
const openSubcats = new Set();    // 側邊欄子分類是否展開（"catId/subId"）— 預設收合

function renderPrep() {
  const containers = [prepCatsEl, $("prepCategoriesExpanded")].filter(Boolean);
  let total = 0, done = 0;
  state.prep.forEach(cat =>
    (cat.subcats || []).forEach(sub =>
      (sub.items || []).forEach(it => { total++; if (it.done) done++; })
    )
  );
  $("prepCount").textContent = `${done}/${total}`;

  containers.forEach(container => {
    container.innerHTML = "";
    const isCompact = container === prepCatsEl; // 側邊欄才折疊
    if (!isCompact) {
      // 展開 Modal：待辦事項固定左欄、行李清單固定右欄，其他在下方
      const todoCat   = state.prep.find(c => c.id === "cat-todo"    || c.name.includes("待辦"));
      const packCat   = state.prep.find(c => c.id === "cat-packing" || c.name.includes("行李"));
      const others    = state.prep.filter(c => c !== todoCat && c !== packCat);
      const ordered   = [todoCat, packCat, ...others].filter(Boolean);
      ordered.forEach(cat => container.appendChild(buildCategorySection(cat, false)));
    } else {
      state.prep.forEach(cat => container.appendChild(buildCategorySection(cat, true)));
    }
  });
}

function buildCategorySection(cat, collapsible = true) {
  const section = document.createElement("div");
  // sidebar: default closed (use openCats); modal: always open (collapsible=false)
  const isCollapsed = collapsible && !openCats.has(cat.id);
  section.className = "prep-cat" + (isCollapsed ? " collapsed" : "");

  // 統計所有子分類的完成數
  const allItems = (cat.subcats || []).flatMap(s => s.items || []);
  const doneN = allItems.filter(i => i.done).length;

  section.innerHTML = `
    <div class="prep-cat-head">
      ${collapsible ? `<button class="prep-toggle-btn" title="展開 / 收合">▾</button>` : ""}
      <span class="prep-cat-name" contenteditable="true" spellcheck="false"
            data-cat-rename="${cat.id}">${escapeHtml(cat.name)}</span>
      <span class="prep-cat-count">${doneN}/${allItems.length}</span>
      <button class="icon-btn tiny del" data-cat-del="${cat.id}" title="刪除整個分類">✕</button>
    </div>
    <div class="prep-subcats-wrap"></div>
    <button class="btn btn-ghost prep-add-subcat" data-add-sub="${cat.id}" title="新增子分類">＋ 新增子分類</button>
  `;

  // 折疊 toggle（點標題列）
  if (collapsible) {
    const head = section.querySelector(".prep-cat-head");
    head.addEventListener("click", e => {
      if (e.target.closest("[data-cat-del]") || e.target.closest("[data-cat-rename]")) return;
      openCats.has(cat.id) ? openCats.delete(cat.id) : openCats.add(cat.id);
      section.classList.toggle("collapsed", !openCats.has(cat.id));
    });
  }

  // 渲染子分類（sidebar 和 modal 都預設收合，共用 openSubcats）
  const subcatsWrap = section.querySelector(".prep-subcats-wrap");
  (cat.subcats || []).forEach(sub => {
    subcatsWrap.appendChild(buildSubcatSection(sub, cat, true));
  });

  // 改分類名稱
  section.querySelector("[data-cat-rename]").addEventListener("blur", e => {
    const txt = e.target.textContent.trim();
    if (txt) { cat.name = txt; persist(); }
  });
  // 刪整個分類
  section.querySelector("[data-cat-del]").addEventListener("click", () => {
    if (!confirm(`刪除「${cat.name}」整個分類嗎？所有子分類和項目會一起消失 🥲`)) return;
    state.prep = state.prep.filter(x => x.id !== cat.id);
    persist();
    renderPrep();
  });
  // 新增子分類
  section.querySelector("[data-add-sub]").addEventListener("click", () => {
    const name = prompt("子分類名稱（建議加 emoji）", "✨ 其他");
    if (!name || !name.trim()) return;
    cat.subcats = cat.subcats || [];
    cat.subcats.push({ id: "sub-" + Date.now(), name: name.trim(), items: [] });
    persist();
    renderPrep();
  });

  return section;
}

function buildSubcatSection(sub, parentCat, isCompact = false) {
  const section = document.createElement("div");
  const colKey = parentCat.id + "/" + sub.id;
  // 側邊欄：預設收合，只有在 openSubcats 裡才展開
  // Modal：預設展開，只有在 collapsedCats 裡才收合
  const isCollapsed = isCompact ? !openSubcats.has(colKey) : collapsedCats.has(colKey);
  section.className = "prep-subcat" + (isCollapsed ? " collapsed" : "");

  const doneN = (sub.items || []).filter(i => i.done).length;
  section.innerHTML = `
    <div class="prep-subcat-head">
      <button class="prep-toggle-btn" title="展開 / 收合">▾</button>
      <span class="prep-subcat-name" contenteditable="true" spellcheck="false">${escapeHtml(sub.name)}</span>
      <span class="prep-cat-count">${doneN}/${sub.items.length}</span>
      <button class="icon-btn tiny del prep-sub-del" title="刪除子分類">✕</button>
    </div>
    <ul class="prep-list">
      ${(sub.items || []).map(it => `
        <li class="prep-item ${it.done ? "done" : ""}">
          <label>
            <input type="checkbox" data-sub-toggle="${it.id}" ${it.done ? "checked" : ""} />
            <span class="prep-text" contenteditable="true" spellcheck="false"
                  data-sub-edit="${it.id}">${escapeHtml(it.text)}</span>
          </label>
          <button class="icon-btn tiny del" data-sub-del="${it.id}" title="刪除">✕</button>
        </li>
      `).join("")}
    </ul>
    <div class="prep-add">
      <input type="text" class="sub-add-input" placeholder="新增一項…" />
      <button class="btn btn-primary tiny sub-add-btn">＋</button>
    </div>
  `;

  // 折疊 / 展開
  section.querySelector(".prep-subcat-head").addEventListener("click", e => {
    if (e.target.closest(".prep-sub-del") || e.target.closest("[contenteditable]")) return;
    if (isCompact) {
      openSubcats.has(colKey) ? openSubcats.delete(colKey) : openSubcats.add(colKey);
      section.classList.toggle("collapsed", !openSubcats.has(colKey));
    } else {
      collapsedCats.has(colKey) ? collapsedCats.delete(colKey) : collapsedCats.add(colKey);
      section.classList.toggle("collapsed", collapsedCats.has(colKey));
    }
  });

  // 打勾
  section.querySelectorAll("[data-sub-toggle]").forEach(chk => {
    chk.addEventListener("change", () => {
      const it = sub.items.find(i => i.id === +chk.dataset.subToggle);
      if (it) { it.done = chk.checked; persist(); renderPrep(); }
    });
  });
  // 文字編輯
  section.querySelectorAll("[data-sub-edit]").forEach(span => {
    span.addEventListener("blur", () => {
      const it = sub.items.find(i => i.id === +span.dataset.subEdit);
      if (it) { it.text = span.textContent.trim() || it.text; persist(); }
    });
  });
  // 刪單一項
  section.querySelectorAll("[data-sub-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      sub.items = sub.items.filter(i => i.id !== +btn.dataset.subDel);
      persist(); renderPrep();
    });
  });
  // 改子分類名稱
  section.querySelector(".prep-subcat-name").addEventListener("blur", e => {
    const txt = e.target.textContent.trim();
    if (txt) { sub.name = txt; persist(); }
  });
  // 刪子分類
  section.querySelector(".prep-sub-del").addEventListener("click", () => {
    if (!confirm(`刪除「${sub.name}」子分類嗎？所有項目會消失 🥲`)) return;
    parentCat.subcats = parentCat.subcats.filter(s => s.id !== sub.id);
    persist(); renderPrep();
  });
  // 新增項目
  const addInput = section.querySelector(".sub-add-input");
  const addBtn   = section.querySelector(".sub-add-btn");
  function addItem() {
    const text = addInput.value.trim();
    if (!text) return;
    sub.items.push({ id: nextPrepId++, text, done: false });
    addInput.value = "";
    persist(); renderPrep();
  }
  addBtn.addEventListener("click", addItem);
  addInput.addEventListener("keydown", e => { if (e.key === "Enter") addItem(); });

  return section;
}

// 展開旅費錢包 Modal
const walletModal = $("walletModal");
$("walletExpandBtn").addEventListener("click", () => {
  renderExpenses();
  walletModal.hidden = false;
});

// 展開行前準備 Modal
const prepModal = $("prepModal");
$("prepExpandBtn").addEventListener("click", () => {
  renderPrep(); // 重繪展開版
  prepModal.hidden = false;
});
$("addCategoryBtn2").addEventListener("click", () => {
  const name = prompt("新分類名稱（建議加 emoji）", "🎁 其他");
  if (!name || !name.trim()) return;
  state.prep.push({ id: "cat-" + Date.now(), name: name.trim(), subcats: [] });
  persist();
  renderPrep();
});
// aiPrepBtn2 is wired below with runAiPrep

$("addCategoryBtn").addEventListener("click", () => {
  const name = prompt("新分類名稱（建議加 emoji）", "🎁 其他");
  if (!name || !name.trim()) return;
  state.prep.push({
    id: "cat-" + Date.now(),
    name: name.trim(),
    subcats: [],
  });
  persist();
  renderPrep();
});

// ---- ✨ AI 建議行前準備（參考整趟行程） ----
// 會根據 → 天數、目的地、月份、是否出國、各類景點數量，組出貼心清單
function generateAIPrep() {
  const allSpots = Object.values(state.days).flat();
  const dayCount = Object.keys(state.days).length;
  const spotCount = allSpots.length;
  const hotelCount    = allSpots.filter(s => s.category === "hotel").length;
  const shoppingCount = allSpots.filter(s => s.category === "shopping").length;
  const foodCount     = allSpots.filter(s => s.category === "food").length;

  // 把整趟所有「文字資訊」串起來分析
  const text = [
    state.meta.title || "",
    state.meta.dates || "",
    state.travel?.outbound?.departFrom || "",
    state.travel?.outbound?.arriveTo || "",
    ...allSpots.map(s => `${s.name} ${s.addr || ""} ${s.note || ""}`),
  ].join(" ");

  // 偵測目的地（簡單關鍵字版，正式版可接 AI）
  const destinations = {
    japan:  { pattern: /日本|京都|東京|大阪|沖繩|北海道|名古屋|札幌|福岡|横浜|奈良|嵐山|箱根|淺草|新宿|渋谷|關西|關東/i,
              hint: "日本", currency: "日幣", extraTodo: ["📲 下載 Google 翻譯 + 日文離線包", "🚇 查 IC 卡（Suica / ICOCA）儲值"] },
    korea:  { pattern: /韓國|首爾|釜山|濟州|明洞|江南|弘大/i,
              hint: "韓國", currency: "韓幣", extraTodo: ["📲 下載 Naver Map / KakaoMap", "🚇 查 T-money 卡"] },
    thailand:{ pattern: /泰國|曼谷|清邁|普吉|芭達雅/i,
              hint: "泰國", currency: "泰銖", extraTodo: ["💉 確認黃皮書 / 疫苗", "🦟 帶防蚊液"] },
    europe: { pattern: /巴黎|倫敦|羅馬|柏林|阿姆|維也納|布拉格|義大利|法國|德國|英國|西班牙|希臘/i,
              hint: "歐洲", currency: "歐元", extraTodo: ["🔌 注意歐規插頭（兩圓孔）", "🎒 防扒小心隨身包"] },
    us:     { pattern: /美國|紐約|洛杉磯|舊金山|拉斯維加斯|西雅圖|波士頓|芝加哥/i,
              hint: "美國", currency: "美金", extraTodo: ["🛂 確認 ESTA 通過 / 簽證", "💵 準備小費（餐廳 15-20%）"] },
    sea:    { pattern: /新加坡|馬來|吉隆坡|越南|河內|胡志明|印尼|峇里|菲律|宿霧/i,
              hint: "東南亞", currency: "當地貨幣", extraTodo: ["💉 注意防蚊", "🌧️ 查雨季"] },
  };
  let dest = null;
  for (const [k, v] of Object.entries(destinations)) {
    if (v.pattern.test(text)) { dest = v; break; }
  }

  const isOverseas = !!dest || (state.travel?.outbound?.type || "").includes("飛機");

  // 偵測月份（從日期欄位抓第一個月份數字）
  const monthMatch = (state.meta.dates || "").match(/(\d{1,2})\/\d/);
  const month = monthMatch ? Math.min(12, +monthMatch[1]) : null;

  // ----- 待辦事項（依子分類） -----
  const todoSubcats = [
    {
      id: "sub-todo-travel", name: "✈️ 交通 & 住宿",
      items: [
        "📅 確認航班 / 車票時間與座位",
        "🏨 確認住宿訂單 + 入住 / 退房時間",
        ...(hotelCount >= 2 ? [`🏨 跨多家住宿（${hotelCount} 間），逐一確認 check-in/out`] : []),
      ],
    },
    {
      id: "sub-todo-finance", name: "💳 財務 & 保險",
      items: [
        `💴 換${dest ? dest.currency : "外幣"} / 提領現金`,
        "📞 通知信用卡公司海外消費",
        "🩺 購買旅行保險",
      ],
    },
    {
      id: "sub-todo-docs", name: "📄 文件 & 簽證",
      items: [
        ...(isOverseas ? ["🛂 確認護照效期超過 6 個月"] : []),
        ...(isOverseas ? ["🖨️ 印出訂房 / 訂票確認信備份"] : []),
        ...(dest ? [`🌐 查 ${dest.hint} 入境規定 / 免簽資格`] : []),
      ],
    },
    {
      id: "sub-todo-tech", name: "📱 科技 & 通訊",
      items: [
        "📱 申請當地網路（SIM 卡 / eSIM）",
        "📸 備份手機重要資料 / 雲端",
        "🌤️ 查當地一週天氣預報",
        ...(dest ? dest.extraTodo : []),
      ],
    },
    {
      id: "sub-todo-spots", name: "🗺️ 景點 & 餐廳",
      items: [
        ...(foodCount >= 2 ? [`🍜 預訂熱門餐廳（行程裡有 ${foodCount} 家）`] : []),
        ...(shoppingCount >= 1 ? [`🛍️ 列出想買清單 / 比價（${shoppingCount} 個購物點）`] : []),
        ...(spotCount >= 10 ? [`📍 行程豐富（${spotCount} 個景點），建議印一份備用紙本`] : []),
      ],
    },
  ].filter(s => s.items.length > 0);

  // ----- 行李清單（依子分類） -----
  const clothingItems = [`👕 換洗衣物 ×${dayCount + 1} 套`, "🧦 襪子 + 內衣褲", "👟 一雙好走的鞋"];
  if (month != null) {
    if ([6, 7, 8].includes(month)) {
      clothingItems.push("☀️ 防曬衣 / 帽子", "🕶️ 太陽眼鏡", "👙 涼感短袖 + 涼鞋");
    } else if ([12, 1, 2].includes(month)) {
      clothingItems.push("🧥 厚外套 / 羽絨服", "🧤 手套、毛帽、圍巾", "♨️ 暖暖包");
    } else if ([3, 4, 5].includes(month)) {
      clothingItems.push("🧥 薄外套（早晚溫差大）", "🌸 春季款輕薄衣物");
    } else {
      clothingItems.push("🧣 洋蔥式穿搭（薄外套 + 內搭）");
    }
  }
  if (hotelCount >= 1) clothingItems.push("👘 飯店睡衣 / 過夜衣物");

  const packingSubcats = [
    {
      id: "sub-pack-docs", name: "🛂 證件 & 文件",
      items: [
        "🛂 護照 / 身分證（效期確認）",
        "✈️ 機票 / 車票 / 訂房確認信",
        "💳 信用卡 + 提款卡",
      ],
    },
    {
      id: "sub-pack-clothing", name: "👕 衣物 & 鞋子",
      items: clothingItems,
    },
    {
      id: "sub-pack-toiletries", name: "🧴 洗漱 & 保養",
      items: [
        "🪥 牙刷 + 牙膏",
        "🧴 洗髮精 + 沐浴乳（或確認飯店提供）",
        "💆 保濕乳液 / 護手霜",
        "☀️ 防曬乳 SPF 50+",
        "💊 腸胃藥 + 止痛藥",
        "💊 個人常備藥品 / 暈車藥",
        ...(foodCount >= 2 ? ["💊 助消化藥（吃多了備用）"] : []),
      ],
    },
    {
      id: "sub-pack-electronics", name: "📱 電子設備",
      items: [
        "📱 手機 + 充電線",
        "🔋 行動電源（≥ 10000mAh）",
        "🔌 旅行萬用轉接頭",
        "📷 相機 + 記憶卡 + 電池",
        "🎧 耳機",
        ...(isOverseas ? ["🔌 確認當地插座規格"] : []),
      ],
    },
    {
      id: "sub-pack-bags", name: "🎒 包包 & 隨身",
      items: [
        "🎒 後背包 / 隨身小包",
        "☂️ 摺疊雨傘",
        "💰 零錢包（裝外幣零錢）",
        ...(shoppingCount >= 1 ? ["🛍️ 環保購物袋（戰利品備用）"] : []),
      ],
    },
  ];

  return { todoSubcats, packingSubcats, dest, month };
}

function runAiPrep(btn, btnText) {
  btn.textContent = "🧚 小天使思考中...";
  btn.disabled = true;
  setTimeout(() => {
    const sug = generateAIPrep();

    // 找到「待辦」與「行李」分類，沒有就建
    let todoCat = state.prep.find(c => c.id === "cat-todo" || c.name.includes("待辦"));
    let packCat = state.prep.find(c => c.id === "cat-packing" || c.name.includes("行李"));
    if (!todoCat) {
      todoCat = { id: "cat-todo", name: "📋 待辦事項", subcats: [] };
      state.prep.unshift(todoCat);
    }
    if (!packCat) {
      packCat = { id: "cat-packing", name: "🎒 行李清單", subcats: [] };
      state.prep.push(packCat);
    }
    if (!todoCat.subcats) todoCat.subcats = [];
    if (!packCat.subcats) packCat.subcats = [];

    let added = 0;
    // 合併 subcats：若同 id 的子分類已存在，補充缺少的項目；否則新增整個子分類
    function mergeSubcats(cat, newSubcats) {
      newSubcats.forEach(newSub => {
        if (!newSub.items || newSub.items.length === 0) return;
        let existing = cat.subcats.find(s => s.id === newSub.id);
        if (!existing) {
          existing = { id: newSub.id, name: newSub.name, items: [] };
          cat.subcats.push(existing);
        }
        const allExistingTexts = cat.subcats.flatMap(s => s.items.map(i => i.text));
        newSub.items.forEach(text => {
          if (!allExistingTexts.includes(text)) {
            existing.items.push({ id: nextPrepId++, text, done: false });
            added++;
          }
        });
      });
    }
    mergeSubcats(todoCat, sug.todoSubcats);
    mergeSubcats(packCat, sug.packingSubcats);

    persist();
    renderPrep();
    btn.textContent = btnText;
    btn.disabled = false;
    const ctx = sug.dest ? `偵測到「${sug.dest.hint}」行程` : "依目前行程內容";
    if (added === 0) {
      alert(`🧚 旅遊小天使 ${ctx}：清單已經很完整了！若要重新生成，可刪掉舊分類再點一次。`);
    } else {
      alert(`✨ 旅遊小天使${ctx}幫你整理好了，加了 ${added} 個提醒，記得勾掉已完成的～`);
    }
  }, 700);
}
$("aiPrepBtn").addEventListener("click", () => runAiPrep($("aiPrepBtn"), "✨ 旅遊小天使建議行前準備"));
$("aiPrepBtn2").addEventListener("click", () => runAiPrep($("aiPrepBtn2"), "✨ 旅遊小天使建議行前準備"));

// ============================================================
// 邀請 / Modal 通用
// ============================================================
$("inviteBtn").addEventListener("click", () => {
  $("shareLink").value = window.location.href;
  openModal(inviteModal);
});
$("copyLink").addEventListener("click", () => {
  const el = $("shareLink");
  el.select();
  document.execCommand("copy");
  $("copyLink").textContent = "✓ 已複製";
  setTimeout(() => $("copyLink").textContent = "複製", 1500);
});
document.querySelectorAll("[data-close]").forEach(el => {
  el.addEventListener("click", e => closeModal(e.target.closest(".modal")));
});
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m) closeModal(m); });
});
function openModal(m)  { m.hidden = false; }
function closeModal(m) { m.hidden = true; }

// ============================================================
// AI 小幫手（模擬版）
// ============================================================
const AI_TEMPLATES = [
  s => s.length > 0 ? `🌞 <b>早上建議</b>去「${s[0].name}」比較涼快，人也少。` : null,
  s => {
    if (s.length < 2) return null;
    const t = getTransit(s[0], s[1]);
    const modes = t.legs.map(l => l.mode).join(" + ");
    return `🚇 <b>${s[0].name} → ${s[1].name}</b> 這段 ${modes}，共 ${t.totalMins} 分。`;
  },
  s => s.length >= 3 ? `🍜 <b>中午 12:00 左右</b>可以穿插一頓在地午餐，不然下午會餓昏～` : null,
  s => s.length > 0 ? `📅 今天一共安排 <b>${s.length} 個景點</b>，節奏 ${s.length > 4 ? "有點趕 😵" : "剛剛好 😊"}。` : null,
  s => s.some(x => x.photos?.length) ? `📷 已經有 <b>${s.reduce((n,x)=>n+(x.photos?.length||0),0)} 張旅行照片</b>，繼續記錄下去吧！` : null,
];

function refreshAiTips() {
  const spots = state.days[state.currentDay] || [];
  aiTipsEl.innerHTML = "";
  if (spots.length === 0) {
    aiTipsEl.innerHTML = `<div class="tip">還沒有景點，先新增幾個，我才能幫你出點子 🤖</div>`;
    return;
  }
  AI_TEMPLATES.forEach(fn => {
    const msg = fn(spots);
    if (!msg) return;
    const div = document.createElement("div");
    div.className = "tip";
    div.innerHTML = msg;
    aiTipsEl.appendChild(div);
  });
}

// ---- AI 重排：單天 / 整趟 + 還原 ----
let aiUndoSnapshot = null;   // { days: 深複製, currentDay }

function takeAiSnapshot() {
  aiUndoSnapshot = {
    days: JSON.parse(JSON.stringify(state.days)),
    currentDay: state.currentDay,
  };
  $("undoAiBtn").hidden = false;
}

function rearrangeOneDay(dayKey) {
  const list = state.days[dayKey];
  if (!list || list.length === 0) return;
  const dayStart = list[0].start;
  const oldNextMap = snapshotNextMap(list);
  // 示範排序：景點名稱字數短的先（之後可接真正 AI）
  list.sort((a, b) => a.name.length - b.name.length);
  invalidateChangedEdges(list, oldNextMap);
  list[0].start = dayStart;
  cascadeTimesForDay(dayKey, 1);
}

$("askAiBtn").addEventListener("click", () => {
  const btn = $("askAiBtn");
  btn.textContent = "🧚 小天使思考中...";
  btn.disabled = true;
  setTimeout(() => {
    takeAiSnapshot();
    rearrangeOneDay(state.currentDay);
    persist();
    renderAll();
    btn.textContent = "✨ 小天使排今天";
    btn.disabled = false;
  }, 700);
});

$("askAiAllBtn").addEventListener("click", () => {
  if (!confirm("要讓 AI 幫整趟旅行重新排嗎？\n如果不滿意可以按「↩️ 還原」復原。")) return;
  const btn = $("askAiAllBtn");
  btn.textContent = "🧚 小天使思考中...";
  btn.disabled = true;
  setTimeout(() => {
    takeAiSnapshot();
    Object.keys(state.days).forEach(d => rearrangeOneDay(d));
    persist();
    renderAll();
    btn.textContent = "🌐 小天使排整趟";
    btn.disabled = false;
  }, 1000);
});

$("undoAiBtn").addEventListener("click", () => {
  if (!aiUndoSnapshot) return;
  state.days = aiUndoSnapshot.days;
  state.currentDay = aiUndoSnapshot.currentDay;
  aiUndoSnapshot = null;
  $("undoAiBtn").hidden = true;
  persist();
  renderAll();
});

// ============================================================
// 錢包
// ============================================================
// 把所有自動產生的開銷整理出來：景點門票 + 交通費
// 預設都是 paidBy="p1"（"我"），splitWith=所有人
function collectAutoEntries() {
  const entries = [];
  const allIds = state.people.map(p => p.id);

  Object.keys(state.days).map(Number).sort((a, b) => a - b).forEach(d => {
    const spots = state.days[d] || [];
    spots.forEach((s, i) => {
      // 景點門票
      if (+s.cost > 0) {
        const key = `ticket_${s.id}`;
        const payment = state.spotPayments[key] || null;
        entries.push({
          kind: "ticket",
          key,
          icon: "🎟️",
          label: `${spotCat(s.category).emoji} ${s.name}`,
          amt: +s.cost,
          ccy: s.costCcy || state.baseCurrency,
          paidBy: payment ? payment.paidBy : null,
          splitWith: payment ? payment.splitWith : allIds,
          payment,
          day: d,
          spotId: s.id,
        });
      }
      // 交通費（每組「景點 → 下一個景點」的所有 leg 加總成一筆）
      if (i === spots.length - 1) return;
      if (!Array.isArray(s.travelLegs)) return;
      const totalCost = s.travelLegs.reduce((n, l) => n + (+l.cost || 0), 0);
      if (totalCost <= 0) return;
      const key = `transit_${s.id}`;
      const payment = state.spotPayments[key] || null;
      const usedModes = [...new Set(
        s.travelLegs.filter(l => +l.cost > 0 || +l.mins > 0).map(l => l.mode.split(" ")[0])
      )].join("");
      entries.push({
        kind: "transit",
        key,
        icon: "🚇",
        label: `${usedModes} ${s.name} → ${spots[i + 1].name}`,
        amt: totalCost,
        ccy: state.baseCurrency,
        paidBy: payment ? payment.paidBy : null,
        splitWith: payment ? payment.splitWith : allIds,
        payment,
        day: d,
        spotId: s.id,
      });
    });
  });
  return entries;
}

// 算分帳：誰要轉錢給誰多少
function computeSettlement(allEntries) {
  const net = {};
  state.people.forEach(p => net[p.id] = 0);
  allEntries.forEach(e => {
    // 自動條目尚未指定付款人 → 不納入分帳
    if ("key" in e && e.payment === null) return;
    const baseAmt = convertAmount(e.amt, e.ccy, state.baseCurrency);
    const ids = (e.splitWith && e.splitWith.length) ? e.splitWith : state.people.map(p => p.id);
    const share = baseAmt / ids.length;
    if (net[e.paidBy] !== undefined) net[e.paidBy] += baseAmt;
    ids.forEach(id => { if (net[id] !== undefined) net[id] -= share; });
  });
  // 貪心配對：負的（欠別人）配上正的（被別人欠）
  const debtors  = [];
  const creditors = [];
  Object.entries(net).forEach(([id, amt]) => {
    if (amt > 0.5)  creditors.push({ id, amt });
    if (amt < -0.5) debtors.push({ id, amt: -amt });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i], c = creditors[j];
    const pay = Math.min(d.amt, c.amt);
    transfers.push({ from: d.id, to: c.id, amt: pay });
    d.amt -= pay; c.amt -= pay;
    if (d.amt < 0.5) i++;
    if (c.amt < 0.5) j++;
  }
  return transfers;
}

function renderExpenses() {
  expenseListEl.innerHTML = "";
  const baseCcy = state.baseCurrency;
  const baseInfo = ccyInfo(baseCcy);
  $("baseCcyLabel").textContent = `(${baseInfo.symbol})`;

  // 把手動 + 自動的開銷組成一個大陣列，用同一邏輯算分帳
  const auto = collectAutoEntries();
  const allForSettle = [...state.expenses, ...auto];

  // 總花費（換算到主要幣別）
  const total = allForSettle.reduce((n, e) =>
    n + convertAmount(e.amt, e.ccy, baseCcy), 0);
  $("totalAmount").textContent = formatMoney(total, baseCcy);

  // ----- 分帳結算 -----
  const transfers = computeSettlement(allForSettle);
  const settleEl = $("settlement");
  if (transfers.length === 0) {
    settleEl.innerHTML = `<div class="settle-empty">🎉 都打平了，不用補錢～</div>`;
  } else {
    settleEl.innerHTML = `
      <div class="settle-head">🧮 分帳結算（誰給誰）</div>
      ${transfers.map(t => {
        const from = getPerson(t.from), to = getPerson(t.to);
        return `<div class="settle-row">
          <span class="avatar mini" style="background:${from.color}">${escapeHtml(from.name[0])}</span>
          <b>${escapeHtml(from.name)}</b>
          <span class="settle-arrow">→</span>
          <span class="avatar mini" style="background:${to.color}">${escapeHtml(to.name[0])}</span>
          <b>${escapeHtml(to.name)}</b>
          <span class="settle-amt">${formatMoney(t.amt, baseCcy)}</span>
        </div>`;
      }).join("")}
    `;
  }

  // ----- 手動花費 -----
  if (state.expenses.length > 0) {
    const head = document.createElement("li");
    head.className = "wallet-group-head";
    head.textContent = "📝 手動記帳";
    expenseListEl.appendChild(head);
    state.expenses.forEach(e => {
      const baseAmt = convertAmount(e.amt, e.ccy, baseCcy);
      const payer = getPerson(e.paidBy);
      const splitN = (e.splitWith || state.people.map(p => p.id)).length;
      const li = document.createElement("li");
      li.className = "manual-entry";
      li.dataset.expId = e.id;
      li.innerHTML = `
        <span>
          <div>${escapeHtml(e.item)}</div>
          <div class="who">
            <span class="avatar mini" style="background:${payer.color}">${escapeHtml(payer.name[0])}</span>
            ${escapeHtml(payer.name)} 付 · 分 ${splitN} 人
          </div>
        </span>
        <div class="expense-right">
          <b>${formatMoney(e.amt, e.ccy)}</b>
          ${e.ccy !== baseCcy ? `<small class="conv">≈ ${formatMoney(baseAmt, baseCcy)}</small>` : ""}
        </div>
      `;
      li.addEventListener("click", () => openExpenseModalForEdit(e.id));
      expenseListEl.appendChild(li);
    });
  }

  // ----- 自動：景點門票 + 交通費 -----
  if (auto.length > 0) {
    const head = document.createElement("li");
    head.className = "wallet-group-head";
    head.textContent = "🤖 自動：景點門票 + 交通費";
    expenseListEl.appendChild(head);
    auto.forEach(t => {
      const baseAmt = convertAmount(t.amt, t.ccy, baseCcy);
      const li = document.createElement("li");
      li.className = "auto-entry" + (t.payment ? " auto-assigned" : " auto-unassigned");

      let payerHtml;
      if (t.payment) {
        const payer = getPerson(t.payment.paidBy);
        const splitN = t.payment.splitWith.length;
        payerHtml = `<span class="avatar mini" style="background:${payer.color}">${escapeHtml(payer.name[0])}</span>
                     ${escapeHtml(payer.name)} 付 · 分 ${splitN} 人`;
      } else {
        payerHtml = `<span class="auto-pay-badge">點我設定誰付</span>`;
      }

      li.innerHTML = `
        <span>
          <div>${t.icon} ${escapeHtml(t.label)}</div>
          <div class="who"><span class="auto-tag">Day ${t.day} · 自動</span> ${payerHtml}</div>
        </span>
        <div class="expense-right">
          <b>${formatMoney(t.amt, t.ccy)}</b>
          ${t.ccy !== baseCcy ? `<small class="conv">≈ ${formatMoney(baseAmt, baseCcy)}</small>` : ""}
        </div>
      `;
      li.addEventListener("click", () => openAutoPayModal(t));
      expenseListEl.appendChild(li);
    });
  }
}
// ============================================================
// 💰 自動條目付款指定 Modal
// ============================================================
let currentAutoEntry = null;
let autoSelectedPaidBy = null;
let autoSelectedSplitWith = [];

function openAutoPayModal(entry) {
  currentAutoEntry = entry;
  $("autoPayTitle").textContent = `${entry.icon} ${entry.label}`;
  $("autoPayDesc").textContent = `${formatMoney(entry.amt, entry.ccy)} · Day ${entry.day}`;
  const payment = entry.payment;
  autoSelectedPaidBy = payment ? payment.paidBy : (state.people[0]?.id || "p1");
  autoSelectedSplitWith = payment ? [...payment.splitWith] : state.people.map(p => p.id);
  $("autoPayClearBtn").hidden = !payment;
  renderAutoPayPeople();
  $("autoPayModal").hidden = false;
}

function renderAutoPayPeople() {
  $("autoPayPaidBy").innerHTML = state.people.map(p => `
    <button type="button" class="person-pick ${p.id === autoSelectedPaidBy ? "active" : ""}"
            data-auto-paid="${p.id}" style="--c:${p.color}">
      <span class="avatar mini" style="background:${p.color}">${escapeHtml(p.name[0])}</span>
      ${escapeHtml(p.name)}
    </button>
  `).join("");
  $("autoPaySplitWith").innerHTML = state.people.map(p => `
    <button type="button" class="person-pick ${autoSelectedSplitWith.includes(p.id) ? "active" : ""}"
            data-auto-split="${p.id}" style="--c:${p.color}">
      <span class="avatar mini" style="background:${p.color}">${escapeHtml(p.name[0])}</span>
      ${escapeHtml(p.name)}
    </button>
  `).join("");
  $("autoPayPaidBy").querySelectorAll("[data-auto-paid]").forEach(btn => {
    btn.addEventListener("click", () => {
      autoSelectedPaidBy = btn.dataset.autoPaid;
      renderAutoPayPeople();
    });
  });
  $("autoPaySplitWith").querySelectorAll("[data-auto-split]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.autoSplit;
      if (autoSelectedSplitWith.includes(id)) {
        if (autoSelectedSplitWith.length <= 1) return;
        autoSelectedSplitWith = autoSelectedSplitWith.filter(x => x !== id);
      } else {
        autoSelectedSplitWith.push(id);
      }
      renderAutoPayPeople();
    });
  });
}

$("autoPaySaveBtn").addEventListener("click", () => {
  if (!currentAutoEntry) return;
  state.spotPayments[currentAutoEntry.key] = {
    paidBy: autoSelectedPaidBy,
    splitWith: [...autoSelectedSplitWith],
  };
  persist();
  closeModal($("autoPayModal"));
  renderExpenses();
});

$("autoPayClearBtn").addEventListener("click", () => {
  if (!currentAutoEntry) return;
  delete state.spotPayments[currentAutoEntry.key];
  persist();
  closeModal($("autoPayModal"));
  renderExpenses();
});

$("receiptInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const fakeAmt = 100 + Math.floor(Math.random() * 1500);
  const me = state.people[0]?.id || "p1";
  state.expenses.push({
    id: "e_" + Math.random().toString(36).slice(2, 8),
    paidBy: me,
    splitWith: state.people.map(p => p.id),
    item: `收據：${file.name.slice(0, 15)}`,
    amt: fakeAmt,
    ccy: state.baseCurrency,
  });
  persist();
  renderExpenses();
  alert(`📷 已辨識金額：${fakeAmt} ${state.baseCurrency}（示範用，正式版會用 OCR 讀發票）`);
  e.target.value = "";
});

// ============================================================
// 💰 記一筆 / 編輯花費 Modal
// ============================================================
let editingExpenseId = null;

function openExpenseModalForNew() {
  editingExpenseId = null;
  $("expenseModalTitle").textContent = "💰 記一筆花費";
  $("delExpenseBtn").hidden = true;
  $("expItem").value = "";
  $("expAmt").value = "";
  $("expCcy").value = state.baseCurrency;
  // 預設付款人 = 第一位（"我"），分攤 = 全部
  selectedPaidBy = state.people[0]?.id;
  selectedSplitWith = state.people.map(p => p.id);
  renderExpensePeople();
  $("expenseModal").hidden = false;
  setTimeout(() => $("expItem").focus(), 50);
}

function openExpenseModalForEdit(id) {
  const e = state.expenses.find(x => x.id === id);
  if (!e) return;
  editingExpenseId = id;
  $("expenseModalTitle").textContent = "✏️ 編輯花費";
  $("delExpenseBtn").hidden = false;
  $("expItem").value = e.item;
  $("expAmt").value = e.amt;
  $("expCcy").value = e.ccy;
  selectedPaidBy = e.paidBy;
  selectedSplitWith = [...(e.splitWith || state.people.map(p => p.id))];
  renderExpensePeople();
  $("expenseModal").hidden = false;
}

let selectedPaidBy = null;
let selectedSplitWith = [];

function renderExpensePeople() {
  // 幣別下拉
  $("expCcy").innerHTML = CURRENCIES.map(c =>
    `<option value="${c.code}">${c.symbol} ${c.code} (${c.name})</option>`
  ).join("");

  // 誰付的：單選
  $("expPaidBy").innerHTML = state.people.map(p => `
    <button type="button" class="person-pick ${p.id === selectedPaidBy ? "active" : ""}"
            data-paid="${p.id}" style="--c:${p.color}">
      <span class="avatar mini" style="background:${p.color}">${escapeHtml(p.name[0])}</span>
      ${escapeHtml(p.name)}
    </button>
  `).join("");
  $("expPaidBy").querySelectorAll("[data-paid]").forEach(b => {
    b.addEventListener("click", () => {
      selectedPaidBy = b.dataset.paid;
      renderExpensePeople();
    });
  });

  // 跟誰分：多選
  $("expSplitWith").innerHTML = state.people.map(p => {
    const active = selectedSplitWith.includes(p.id);
    return `
      <button type="button" class="person-pick ${active ? "active" : ""}"
              data-split="${p.id}" style="--c:${p.color}">
        <span class="avatar mini" style="background:${p.color}">${escapeHtml(p.name[0])}</span>
        ${escapeHtml(p.name)}
        ${active ? "✓" : ""}
      </button>
    `;
  }).join("");
  $("expSplitWith").querySelectorAll("[data-split]").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.split;
      if (selectedSplitWith.includes(id)) {
        selectedSplitWith = selectedSplitWith.filter(x => x !== id);
      } else {
        selectedSplitWith.push(id);
      }
      if (selectedSplitWith.length === 0) selectedSplitWith = state.people.map(p => p.id);
      renderExpensePeople();
    });
  });
}

$("addExpenseBtn").addEventListener("click", openExpenseModalForNew);

$("saveExpenseBtn").addEventListener("click", () => {
  const item = $("expItem").value.trim();
  const amt = +$("expAmt").value;
  if (!item) { alert("項目不能空白喔 🐱"); return; }
  if (!amt || amt <= 0) { alert("金額要大於 0 才行～"); return; }
  if (!selectedPaidBy) { alert("選一個誰先付吧～"); return; }
  if (selectedSplitWith.length === 0) selectedSplitWith = state.people.map(p => p.id);

  const data = {
    item,
    amt,
    ccy: $("expCcy").value,
    paidBy: selectedPaidBy,
    splitWith: [...selectedSplitWith],
  };

  if (editingExpenseId) {
    const e = state.expenses.find(x => x.id === editingExpenseId);
    if (e) Object.assign(e, data);
  } else {
    state.expenses.push({
      id: "e_" + Math.random().toString(36).slice(2, 8),
      ...data,
    });
  }
  persist();
  closeModal($("expenseModal"));
  renderExpenses();
});

$("delExpenseBtn").addEventListener("click", () => {
  if (!editingExpenseId) return;
  if (!confirm("刪掉這筆花費嗎？🥲")) return;
  state.expenses = state.expenses.filter(x => x.id !== editingExpenseId);
  persist();
  closeModal($("expenseModal"));
  renderExpenses();
});

// ============================================================
// 💱 幣別與匯率 Modal
// ============================================================
$("ratesBtn").addEventListener("click", () => {
  $("baseCurrencySelect").innerHTML = CURRENCIES.map(c =>
    `<option value="${c.code}" ${c.code === state.baseCurrency ? "selected" : ""}>
      ${c.symbol} ${c.code} (${c.name})
    </option>`
  ).join("");
  renderRatesList();
  $("ratesUpdatedAt").textContent = state.ratesUpdatedAt
    ? `📅 上次更新：${new Date(state.ratesUpdatedAt).toLocaleString("zh-TW")}`
    : "📅 尚未更新過匯率";
  openModal($("ratesModal"));
});

function renderRatesList() {
  const list = $("ratesList");
  list.innerHTML = CURRENCIES.filter(c => c.code !== "TWD").map(c => {
    // rates[X] = 1 TWD = X 個 X 幣 → 1 X = 1 / rates[X] TWD
    const oneXinTwd = state.rates[c.code] ? (1 / state.rates[c.code]) : 0;
    return `
      <div class="rate-row">
        <span class="rate-ccy">${c.symbol} ${c.code} <small>${c.name}</small></span>
        <span class="rate-eq">1 ${c.code} =</span>
        <input type="number" step="0.0001" class="rate-input" data-rate-ccy="${c.code}"
               value="${oneXinTwd.toFixed(4)}" />
        <span class="rate-twd">TWD</span>
      </div>
    `;
  }).join("");
}

$("saveRatesBtn").addEventListener("click", () => {
  state.baseCurrency = $("baseCurrencySelect").value;
  $("ratesList").querySelectorAll("[data-rate-ccy]").forEach(inp => {
    const ccy = inp.dataset.rateCcy;
    const oneXinTwd = +inp.value || 0;
    // 我們存的 rates[X] 是「1 TWD = X 個 X 幣」，所以反過來
    state.rates[ccy] = oneXinTwd > 0 ? (1 / oneXinTwd) : state.rates[ccy];
  });
  persist();
  closeModal($("ratesModal"));
  renderExpenses();
});

$("fetchRatesBtn").addEventListener("click", async () => {
  const btn = $("fetchRatesBtn");
  btn.textContent = "🔄 抓取中...";
  btn.disabled = true;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/TWD");
    const data = await res.json();
    if (data.result !== "success" || !data.rates) throw new Error("API 回應異常");
    // API: rates[X] 表示「1 TWD = rates[X] X」 → 直接套用
    Object.entries(data.rates).forEach(([ccy, val]) => {
      if (val) state.rates[ccy] = val;
    });
    state.ratesUpdatedAt = Date.now();
    persist();
    renderRatesList();
    $("ratesUpdatedAt").textContent =
      `📅 上次更新：${new Date(state.ratesUpdatedAt).toLocaleString("zh-TW")}`;
    btn.textContent = "✓ 抓到了";
    setTimeout(() => btn.textContent = "🔄 抓最新匯率", 1500);
  } catch (err) {
    alert(`😢 抓不到匯率：${err.message}\n（可能是網路問題，或 file:// 開啟的 CORS 限制）\n你可以手動輸入再儲存。`);
    btn.textContent = "🔄 抓最新匯率";
  } finally {
    btn.disabled = false;
  }
});

// ============================================================
// 👥 同行夥伴 Modal
// ============================================================
$("membersBtn").addEventListener("click", () => {
  renderMembersList();
  openModal($("membersModal"));
});

function renderMembersList() {
  const list = $("membersList");
  list.innerHTML = state.people.map(p => `
    <div class="member-row" data-pid="${p.id}">
      <span class="avatar mini" style="background:${p.color}">${escapeHtml(p.name[0])}</span>
      <input type="text" class="member-name" value="${escapeHtml(p.name)}" />
      <input type="color" class="member-color" value="${p.color}" />
      <button class="icon-btn tiny del" data-member-del="${p.id}" title="刪除">✕</button>
    </div>
  `).join("");

  list.querySelectorAll(".member-name").forEach(inp => {
    inp.addEventListener("blur", () => {
      const pid = inp.closest(".member-row").dataset.pid;
      const p = state.people.find(x => x.id === pid);
      if (p) { p.name = inp.value.trim() || p.name; persist(); renderMembersList(); renderAll(); }
    });
  });
  list.querySelectorAll(".member-color").forEach(inp => {
    inp.addEventListener("change", () => {
      const pid = inp.closest(".member-row").dataset.pid;
      const p = state.people.find(x => x.id === pid);
      if (p) { p.color = inp.value; persist(); renderMembersList(); renderAll(); }
    });
  });
  list.querySelectorAll("[data-member-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.people.length <= 1) {
        alert("至少要留 1 個人喔～");
        return;
      }
      if (!confirm("把這個夥伴刪掉嗎？相關的記帳會改成由第一個人付。")) return;
      const removedId = btn.dataset.memberDel;
      const fallback = state.people.find(p => p.id !== removedId).id;
      state.people = state.people.filter(p => p.id !== removedId);
      // 把該人付的款項改成 fallback；分攤名單也移除該人
      state.expenses.forEach(e => {
        if (e.paidBy === removedId) e.paidBy = fallback;
        e.splitWith = (e.splitWith || []).filter(id => id !== removedId);
        if (e.splitWith.length === 0) e.splitWith = state.people.map(p => p.id);
      });
      persist();
      renderMembersList();
      renderAll();
    });
  });
}

$("addMemberBtn").addEventListener("click", () => {
  const colors = ["#FFB5A7", "#B8E0D2", "#FCD5CE", "#E4C1F9", "#FFE5A0", "#C9F4B5", "#B5C9F4", "#F4B5D9"];
  const color = colors[state.people.length % colors.length];
  state.people.push({
    id: "p_" + Math.random().toString(36).slice(2, 6),
    name: "新成員",
    color,
  });
  persist();
  renderMembersList();
  renderAll();
});

// ============================================================
// 匯出 PDF（用瀏覽器列印→另存為 PDF）
// ============================================================
$("exportPdfBtn").addEventListener("click", () => {
  buildPrintView();
  window.print();
});

function buildPrintView() {
  const el = $("printView");
  const t = state.travel;
  const baseCcy = state.baseCurrency;
  const baseInfo = ccyInfo(baseCcy);

  // 從 meta.dates 解析出發日期
  function parseTripStart() {
    const str = state.meta.dates || "";
    const m = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  const startDate = parseTripStart();
  const weekDays = ["日","一","二","三","四","五","六"];

  function dayDateLabel(dayNum) {
    if (!startDate) return "";
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayNum - 1);
    return `${d.getMonth()+1}/${d.getDate()} （${weekDays[d.getDay()]}）`;
  }

  // 花費統計
  const auto = collectAutoEntries();
  const allCosts = [...state.expenses, ...auto];
  const totalCost = allCosts.reduce((n, e) => n + convertAmount(e.amt, e.ccy, baseCcy), 0);

  // 行前準備
  const allPrep = state.prep.flatMap(c => (c.subcats || []).flatMap(s => s.items || []));
  const prepDone = allPrep.filter(p => p.done).length;

  // 行程統計
  const days = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  const totalSpots = days.reduce((n, d) => n + (state.days[d] || []).length, 0);
  const peopleNames = (state.people || []).map(p => p.name).join("、") || "—";

  // ── 出發與回程（封面左右各一欄，佔 1/4 高）──
  let travelHtml = "";
  if (t.outbound || t.return) {
    travelHtml += `<div class="pv-cover-travel">`;
    ["outbound", "return"].forEach(leg => {
      const d = t[leg];
      if (!d) {
        travelHtml += `<div class="pv-cover-travel-card pv-cover-travel-empty"></div>`;
        return;
      }
      travelHtml += `
        <div class="pv-cover-travel-card">
          <div class="pv-cover-travel-label">${leg === "outbound" ? "✈️ 去程" : "🛬 回程"}</div>
          <div class="pv-cover-travel-main">${escapeHtml(d.type)} ${escapeHtml(d.number)}</div>
          <div class="pv-cover-travel-row">🛫 ${escapeHtml(d.departAt)}&nbsp; ${escapeHtml(d.departFrom)}</div>
          <div class="pv-cover-travel-row">🛬 ${escapeHtml(d.arriveAt)}&nbsp; ${escapeHtml(d.arriveTo)}</div>
          ${d.note ? `<div class="pv-cover-travel-note">${escapeHtml(d.note)}</div>` : ""}
        </div>`;
    });
    travelHtml += `</div>`;
  }

  // ── 封面（含出發回程 + 底部總覽條）──
  let html = `
    <div class="pv-cover">
      <div class="pv-cover-top"></div>
      <div class="pv-cover-inner">
        <div class="pv-cover-emoji">${escapeHtml(state.meta.cover || "🌏")}</div>
        <h1 class="pv-cover-title">${escapeHtml(state.meta.title || "旅遊行程")}</h1>
        <div class="pv-cover-rule"></div>
        <p class="pv-cover-dates">${escapeHtml(state.meta.dates || "")}</p>
        <p class="pv-cover-people">${escapeHtml(peopleNames)}</p>
      </div>
      ${travelHtml}
      <div class="pv-summary">
        <div class="pv-stat"><div class="pv-stat-n">${days.length}</div><div class="pv-stat-l">天</div></div>
        <div class="pv-stat"><div class="pv-stat-n">${totalSpots}</div><div class="pv-stat-l">個景點</div></div>
        <div class="pv-stat"><div class="pv-stat-n">${state.people.length || "—"}</div><div class="pv-stat-l">名旅伴</div></div>
        <div class="pv-stat pv-stat-cost">
          <div class="pv-stat-n">${formatMoney(totalCost, baseCcy)}</div>
          <div class="pv-stat-l">預估總花費 (${baseCcy})</div>
        </div>
      </div>
    </div>
  `;

  // ── 行前準備 ──
  if (allPrep.length > 0) {
    const PREP_ROW_BG = ["#FFFDF5","#F0F5EC","#EFF5F9","#F5EDDF","#F5F0FB","#FFF5EC"];
    const buildPrepCatGrid = (cat, idx) => {
      const allItems = (cat.subcats||[]).flatMap(s => s.items || []);
      if (allItems.length === 0) return '';
      const bg = PREP_ROW_BG[idx % PREP_ROW_BG.length];
      let s = `<div class="pv-prep-cat" style="--row-bg:${bg}">`;
      s += `<div class="pv-prep-cat-name">${escapeHtml(cat.name)}</div>`;
      s += `<div class="pv-prep-items-grid">`;
      (cat.subcats||[]).forEach(sub => {
        if (!sub.items || sub.items.length === 0) return;
        s += `<div class="pv-prep-sub-name">${escapeHtml(sub.name)}</div>`;
        sub.items.forEach(it => {
          s += `<div class="pv-prep-item"><span class="${it.done ? "pv-check" : "pv-uncheck"}">${it.done ? "☑" : "☐"}</span><span>${escapeHtml(it.text)}</span></div>`;
        });
      });
      s += `</div></div>`;
      return s;
    };

    const allPrepCats = state.prep.filter(c => (c.subcats||[]).flatMap(s=>s.items||[]).length > 0);
    let catsHtml = "";
    allPrepCats.forEach((cat, i) => { catsHtml += buildPrepCatGrid(cat, i); });

    html += `
      <div class="pv-section">
        <div class="pv-section-head">
          <span class="pv-section-icon">📝</span>
          <h2>行前準備</h2>
          <span class="pv-section-sub">${prepDone} / ${allPrep.length} 已完成</span>
        </div>
        <div class="pv-prep-cols">
          ${catsHtml}
        </div>
      </div>
    `;
  }

  // ── 每日行程 ──
  if (days.length > 0) {
    html += `
      <div class="pv-section pv-section--itinerary">
        <div class="pv-section-head"><span class="pv-section-icon">🗓️</span><h2>每日行程</h2></div>
    `;
    days.forEach(d => {
      const spots = state.days[d] || [];
      if (spots.length === 0) return;
      const dateStr = dayDateLabel(d);
      const colorIdx = ((d - 1) % 5);
      html += `
        <div class="pv-day pv-day-color-${colorIdx}">
          <div class="pv-day-head">
            <span class="pv-day-n">Day ${d}</span>
            ${dateStr ? `<span class="pv-day-date">${dateStr}</span>` : ""}
          </div>
      `;
      spots.forEach((s, i) => {
        const cat = spotCat(s.category);
        const isLastHotel = (i === spots.length - 1) && s.category === "hotel";
        const durLabel = isLastHotel ? "🛌 過夜" : (s.dur || 0) + " 分";
        const costLabel = s.cost ? `${s.costCcy || baseCcy} ${Number(s.cost).toLocaleString()}` : "";
        html += `
          <div class="pv-spot">
            <div class="pv-time">${escapeHtml(s.start)}<small>${durLabel}</small></div>
            <div class="pv-spot-body">
              <div class="pv-spot-name">${cat.emoji} ${escapeHtml(s.name)}<span class="pv-cat-badge">${cat.label}</span></div>
              ${s.addr ? `<div class="pv-spot-addr">📍 ${escapeHtml(s.addr)}</div>` : ""}
              ${costLabel ? `<div class="pv-spot-cost">💴 ${costLabel}</div>` : ""}
              ${s.note ? `<div class="pv-spot-note">${escapeHtml(s.note)}</div>` : ""}
            </div>
          </div>
        `;
        if (i < spots.length - 1) {
          const tr = getTransit(s, spots[i + 1]);
          const legs = tr.legs.map(leg => {
            const route = (leg.from || leg.to) ? ` ${escapeHtml(leg.from||"?")}→${escapeHtml(leg.to||"?")}` : "";
            return `${leg.mode} ${leg.mins}分${route}`;
          }).join(" + ");
          html += `<div class="pv-transit">${legs}・共 ${tr.totalMins} 分</div>`;
        }
      });
      html += `</div>`;
    });
    html += `</div>`;
  }

  // ── 花費總覽 + 結語（接在最後一節，不單獨成頁）──
  const closingHtml = `<div class="pv-closing">${generatePdfClosing(days.length, state.people, allCosts, totalCost, baseCcy)}</div>`;

  if (state.expenses.length > 0) {
    html += `
      <div class="pv-section">
        <div class="pv-section-head"><span class="pv-section-icon">💰</span><h2>花費總覽</h2></div>
        <div class="pv-cost-total">${formatMoney(totalCost, baseCcy)} <small>${baseCcy}</small></div>
        <ul class="pv-expense-list">
    `;
    state.expenses.forEach(e => {
      const payer = getPerson(e.paidBy);
      html += `
        <li class="pv-expense-item">
          <span class="pv-expense-name">${escapeHtml(e.item)}<small>${escapeHtml(payer?.name || "")}</small></span>
          <span class="pv-expense-amt">${e.ccy} ${Number(e.amt).toLocaleString()}</span>
        </li>
      `;
    });
    html += `</ul>${closingHtml}</div>`;
  } else {
    html += closingHtml;
  }

  el.innerHTML = html;
}

function generatePdfClosing(dayCount, people, allCosts, totalCost, baseCcy) {
  const allSpots = Object.values(state.days).flat();
  const text = [state.meta.title || "", ...allSpots.map(s => `${s.name} ${s.addr || ""}`)].join(" ");

  const destMap = [
    { p: /日本|東京|京都|大阪|沖繩|北海道|奈良|福岡/, emoji: "🌸", msg: "日本的每條巷弄都藏著驚喜，下次一定還要再來！" },
    { p: /韓國|首爾|釜山|濟州|明洞/, emoji: "⭐", msg: "韓國美食、美景、美人，一趟根本不夠玩！" },
    { p: /泰國|曼谷|清邁|普吉/, emoji: "🌺", msg: "泰國的微笑和香料，會在心裡留很久很久。" },
    { p: /歐洲|巴黎|倫敦|羅馬|義大利|法國|德國/, emoji: "🏛️", msg: "歐洲的街道和故事讀不完，期待下次慢慢品味。" },
    { p: /美國|紐約|洛杉磯|舊金山/, emoji: "🗽", msg: "美國的遼闊和多元，每次都帶來全新的冒險！" },
    { p: /新加坡|馬來|越南|印尼|峇里/, emoji: "🌴", msg: "東南亞的陽光和熱情，讓人一秒充好電！" },
  ];

  let destEmoji = "✨", destMsg = "旅行中的每一刻，都是最獨一無二的故事。";
  for (const d of destMap) {
    if (d.p.test(text)) { destEmoji = d.emoji; destMsg = d.msg; break; }
  }

  const names = people.map(p => p.name);
  const withWho = names.length > 0 ? `和 ${names.join("、")} ` : "";
  const costStr = totalCost > 0 ? `花了 ${formatMoney(totalCost, baseCcy)} 換來的美好回憶，` : "";

  return `${destEmoji} 旅遊小天使說：${withWho}${dayCount} 天的旅程，${costStr}每一分都值得。${destMsg} 收好這本手冊，帶著滿滿的回憶繼續出發吧！ ${destEmoji}`;
}

// ============================================================
// 初始化
// ============================================================
function renderAvatars() {
  const wrap = $("topAvatars");
  if (!wrap) return;
  wrap.innerHTML = state.people.slice(0, 4).map(p =>
    `<span class="avatar" style="background:${p.color}" title="${escapeHtml(p.name)}">${escapeHtml(p.name[0])}</span>`
  ).join("") + (state.people.length > 4
    ? `<span class="avatar more">+${state.people.length - 4}</span>`
    : "");
  // 點頭像區 → 開成員管理
  wrap.style.cursor = "pointer";
  wrap.onclick = () => $("membersBtn").click();
}

function renderAll() {
  renderAvatars();
  renderDayTabs();
  renderTimeline();
  renderTravel();
  renderExpenses();
  renderPrep();
  refreshAiTips();
}
renderAll();
