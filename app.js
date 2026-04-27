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

// 行前準備：把舊的「平面陣列」格式遷移成「分類」格式
if (Array.isArray(state.prep)) {
  // 舊版可能是 [{id,text,done}, ...]，也可能已經是新版 [{id,name,items:[...]}]
  const isLegacyFlat = state.prep.length > 0 && !("items" in state.prep[0]);
  if (isLegacyFlat) {
    state.prep = [{ id: "cat-default", name: "📋 待辦事項", items: state.prep }];
  }
}
if (!Array.isArray(state.prep) || state.prep.length === 0) {
  state.prep = [
    { id: "cat-todo",    name: "📋 待辦事項", items: [] },
    { id: "cat-packing", name: "🎒 行李清單", items: [] },
  ];
}
state.prep.forEach(c => { if (!c.items) c.items = []; });

// 幫舊景點補上：分類、多段交通
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
}));

function persist() { saveTrip(TRIP_ID, state); }

let nextSpotId = 1, nextPrepId = 1;
Object.values(state.days).forEach(d =>
  d.forEach(s => { if (s.id >= nextSpotId) nextSpotId = s.id + 1; })
);
state.prep.forEach(cat =>
  cat.items.forEach(p => { if (p.id >= nextPrepId) nextPrepId = p.id + 1; })
);

// ========== DOM 快取 ==========
const $ = id => document.getElementById(id);
const timelineEl   = $("timeline");
const dayTabsEl    = $("dayTabs");
const spotModal    = $("spotModal");
const travelModal  = $("travelModal");
const inviteModal  = $("inviteModal");
const photoPreview = $("photoPreview");
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
});

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
    const btn = document.createElement("button");
    btn.className = "day-tab" + (d === state.currentDay ? " active" : "");
    btn.dataset.day = d;
    btn.innerHTML = `Day ${d}`;
    dayTabsEl.appendChild(btn);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "day-tab add";
  addBtn.id = "addDayBtn";
  addBtn.textContent = "＋";
  dayTabsEl.appendChild(addBtn);
}
dayTabsEl.addEventListener("click", e => {
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
  const hasMemory = !!(spot.photo || spot.note);

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
          ${spot.photo ? `<span class="chip photo-chip">📷</span>` : ""}
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
        ${spot.photo ? `<img class="memory-photo" src="${spot.photo}" alt="旅行照片" />` : ""}
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
let tempPhoto = "";
let chosenCategory = "sight";

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
  $("spotNote").value = spot.note || "";
  setCategory(spot.category || "sight");
  tempPhoto = spot.photo || "";
  renderPhotoPreview();
  $("addrHint").textContent = "";
  spotModal.hidden = false;
}

function resetSpotForm() {
  $("spotName").value = "";
  $("spotAddr").value = "";
  $("spotStart").value = "09:00";
  $("spotDur").value = 90;
  $("spotCost").value = 0;
  $("spotNote").value = "";
  $("addrHint").textContent = "";
  setCategory("sight");
  tempPhoto = "";
  renderPhotoPreview();
  $("spotPhotoInput").value = "";
}

function renderPhotoPreview() {
  if (tempPhoto) {
    photoPreview.innerHTML = `
      <img src="${tempPhoto}" alt="預覽" />
      <button type="button" class="photo-remove" id="removePhotoBtn">✕ 移除</button>`;
    $("removePhotoBtn").addEventListener("click", () => {
      tempPhoto = "";
      $("spotPhotoInput").value = "";
      renderPhotoPreview();
    });
  } else {
    photoPreview.innerHTML = `<div class="photo-placeholder">📷 尚未選擇照片</div>`;
  }
}

$("spotPhotoInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    tempPhoto = await fileToResizedDataURL(file, 800);
    renderPhotoPreview();
  } catch {
    alert("😢 讀取照片失敗，換一張試試？");
  }
});

// ---- 地址自動查詢（OpenStreetMap Nominatim，免費、無須金鑰） ----
async function lookupAddress(query) {
  const hintEl = $("addrHint");
  hintEl.textContent = "🔍 查詢中…";
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=zh-TW`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data[0]) {
      $("spotAddr").value = data[0].display_name;
      hintEl.textContent = "✅ 已自動帶入地址，可再手動調整";
      hintEl.style.color = "#3C8D6A";
    } else {
      hintEl.textContent = "😅 查不到，手動輸入即可";
      hintEl.style.color = "#C26B4A";
    }
  } catch (err) {
    hintEl.textContent = "⚠️ 查詢失敗（網路或 CORS）— 手動輸入即可";
    hintEl.style.color = "#C26B4A";
  }
}

// 離開景點名稱欄位 → 若地址空，自動查
$("spotName").addEventListener("blur", () => {
  const name = $("spotName").value.trim();
  const addr = $("spotAddr").value.trim();
  if (name && !addr) lookupAddress(name);
});
$("lookupAddrBtn").addEventListener("click", () => {
  const q = $("spotAddr").value.trim() || $("spotName").value.trim();
  if (q) lookupAddress(q);
});

// ---- 存景點 ----
$("saveSpot").addEventListener("click", () => {
  const name = $("spotName").value.trim();
  if (!name) { alert("景點名稱不能空白喔 🐱"); return; }

  const data = {
    name,
    addr: $("spotAddr").value.trim(),
    start: $("spotStart").value,
    dur: Math.max(0, +$("spotDur").value || 0),
    cost: +$("spotCost").value,
    note: $("spotNote").value.trim(),
    photo: tempPhoto || "",
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
    if (data.cost > 0) state.expenses.push({ who: "我", item: data.name, amt: data.cost });
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
    body.innerHTML = `
      <div class="travel-line"><b>${escapeHtml(data.type || "")}</b> ${escapeHtml(data.number || "")}</div>
      <div class="travel-line">🛫 ${escapeHtml(data.departAt || "")} <small>${escapeHtml(data.departFrom || "")}</small></div>
      <div class="travel-line">🛬 ${escapeHtml(data.arriveAt || "")} <small>${escapeHtml(data.arriveTo || "")}</small></div>
      ${data.note ? `<div class="travel-note">📝 ${escapeHtml(data.note)}</div>` : ""}
    `;
  });
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

function renderPrep() {
  prepCatsEl.innerHTML = "";
  let total = 0, done = 0;
  state.prep.forEach(cat => {
    cat.items.forEach(it => { total++; if (it.done) done++; });
    prepCatsEl.appendChild(buildCategorySection(cat));
  });
  $("prepCount").textContent = `${done}/${total}`;
}

function buildCategorySection(cat) {
  const section = document.createElement("div");
  section.className = "prep-cat";
  const doneN = cat.items.filter(i => i.done).length;
  section.innerHTML = `
    <div class="prep-cat-head">
      <span class="prep-cat-name" contenteditable="true" spellcheck="false"
            data-cat-rename="${cat.id}">${escapeHtml(cat.name)}</span>
      <span class="prep-cat-count">${doneN}/${cat.items.length}</span>
      <button class="icon-btn tiny del" data-cat-del="${cat.id}" title="刪除整個分類">✕</button>
    </div>
    <ul class="prep-list">
      ${cat.items.map(it => `
        <li class="prep-item ${it.done ? "done" : ""}">
          <label>
            <input type="checkbox" data-prep-toggle="${it.id}" data-cat="${cat.id}" ${it.done ? "checked" : ""} />
            <span class="prep-text" contenteditable="true" spellcheck="false"
                  data-prep-edit="${it.id}" data-cat="${cat.id}">${escapeHtml(it.text)}</span>
          </label>
          <button class="icon-btn tiny del" data-prep-del="${it.id}" data-cat="${cat.id}" title="刪除">✕</button>
        </li>
      `).join("")}
    </ul>
    <div class="prep-add">
      <input type="text" data-cat-add="${cat.id}" placeholder="新增一項…" />
      <button class="btn btn-primary tiny" data-cat-add-btn="${cat.id}">＋</button>
    </div>
  `;

  // ----- 事件繫結 -----
  // 打勾
  section.querySelectorAll("[data-prep-toggle]").forEach(chk => {
    chk.addEventListener("change", () => {
      const c = state.prep.find(x => x.id === chk.dataset.cat);
      const it = c?.items.find(i => i.id === +chk.dataset.prepToggle);
      if (it) { it.done = chk.checked; persist(); renderPrep(); }
    });
  });
  // 文字編輯（離開欄位儲存）
  section.querySelectorAll("[data-prep-edit]").forEach(span => {
    span.addEventListener("blur", () => {
      const c = state.prep.find(x => x.id === span.dataset.cat);
      const it = c?.items.find(i => i.id === +span.dataset.prepEdit);
      if (it) { it.text = span.textContent.trim() || it.text; persist(); }
    });
  });
  // 刪單一項
  section.querySelectorAll("[data-prep-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = state.prep.find(x => x.id === btn.dataset.cat);
      if (!c) return;
      c.items = c.items.filter(i => i.id !== +btn.dataset.prepDel);
      persist();
      renderPrep();
    });
  });
  // 改分類名稱
  section.querySelector("[data-cat-rename]").addEventListener("blur", e => {
    const txt = e.target.textContent.trim();
    if (txt) { cat.name = txt; persist(); }
  });
  // 刪整個分類
  section.querySelector("[data-cat-del]").addEventListener("click", () => {
    if (!confirm(`刪除「${cat.name}」整個分類嗎？所有項目會一起消失 🥲`)) return;
    state.prep = state.prep.filter(x => x.id !== cat.id);
    persist();
    renderPrep();
  });
  // 新增項目（這個分類底下）
  const addInput = section.querySelector("[data-cat-add]");
  const addBtn   = section.querySelector("[data-cat-add-btn]");
  function addItem() {
    const text = addInput.value.trim();
    if (!text) return;
    cat.items.push({ id: nextPrepId++, text, done: false });
    addInput.value = "";
    persist();
    renderPrep();
  }
  addBtn.addEventListener("click", addItem);
  addInput.addEventListener("keydown", e => { if (e.key === "Enter") addItem(); });

  return section;
}

$("addCategoryBtn").addEventListener("click", () => {
  const name = prompt("新分類名稱（建議加 emoji）", "🎁 其他");
  if (!name || !name.trim()) return;
  state.prep.push({
    id: "cat-" + Date.now(),
    name: name.trim(),
    items: [],
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

  // ----- 待辦事項 -----
  const todo = [
    "📅 確認航班 / 車票時間",
    "🏨 確認住宿訂單 + 入住時間",
    `💴 換${dest ? dest.currency : "外幣"} / 提領現金`,
    "📱 申請當地網路（SIM 卡 / eSIM）",
    "🩺 購買旅行保險",
    "📸 備份手機重要資料 / 雲端",
    "🌤️ 查當地一週天氣預報",
    "📞 通知信用卡公司海外消費",
  ];
  if (isOverseas) {
    todo.unshift("🛂 確認護照效期超過 6 個月");
    if (dest) todo.push(`🇯🇵 查 ${dest.hint} 在地禮儀 / 注意事項`);
  }
  if (dest) dest.extraTodo.forEach(t => todo.push(t));
  if (foodCount >= 2)     todo.push(`🍜 預訂熱門餐廳（行程裡有 ${foodCount} 家）`);
  if (shoppingCount >= 1) todo.push(`🛍️ 列出想買清單 / 比價（${shoppingCount} 個購物點）`);
  if (hotelCount >= 2)    todo.push(`🏨 跨多家住宿（${hotelCount} 間），確認 check-in/out 時間`);
  if (spotCount >= 10)    todo.push(`📍 行程豐富（${spotCount} 個景點），印一份備用紙本`);

  // ----- 行李清單 -----
  const packing = [
    "🛂 護照 / 身分證",
    "✈️ 機票 / 行程紙本",
    "💳 信用卡 + 現金",
    "📱 手機 + 充電線",
    "🔋 行動電源",
    "🔌 萬用轉接頭",
    `👕 換洗衣物 ×${dayCount + 1} 套`,
    "🧦 襪子 + 內衣",
    "🧴 盥洗用品（牙刷牙膏）",
    "💊 個人藥品 / 暈車藥",
    "📷 相機 + 記憶卡",
    "🎒 隨身小包 / 後背包",
    "👟 一雙好走的鞋",
  ];
  // 月份天氣建議
  if (month != null) {
    if ([6, 7, 8].includes(month)) {
      packing.push("☀️ 防曬乳 + 太陽眼鏡 + 帽子");
      packing.push("👕 透氣短袖 + 涼鞋");
    } else if ([12, 1, 2].includes(month)) {
      packing.push("🧥 厚外套 / 羽絨服");
      packing.push("🧤 手套、毛帽、圍巾");
      packing.push("♨️ 暖暖包");
    } else if ([3, 4, 5].includes(month)) {
      packing.push("🧥 薄外套（早晚溫差大）");
      packing.push("🌸 春季款式衣物");
    } else {
      packing.push("🧣 洋蔥式穿搭（薄外套 + 內搭）");
    }
  }
  packing.push("☂️ 摺疊雨傘");
  if (hotelCount >= 1) packing.push("👘 飯店過夜衣物");
  if (shoppingCount >= 1) packing.push("🛍️ 預留行李箱空間給戰利品");
  if (foodCount >= 2) packing.push("💊 腸胃藥（吃多了用得上）");

  return { todo, packing, dest, month };
}

$("aiPrepBtn").addEventListener("click", () => {
  const btn = $("aiPrepBtn");
  btn.textContent = "🧠 AI 思考中...";
  btn.disabled = true;
  setTimeout(() => {
    const sug = generateAIPrep();

    // 找到「待辦」與「行李」分類，沒有就建
    let todoCat = state.prep.find(c => c.id === "cat-todo" || c.name.includes("待辦"));
    let packCat = state.prep.find(c => c.id === "cat-packing" || c.name.includes("行李"));
    if (!todoCat) {
      todoCat = { id: "cat-todo", name: "📋 待辦事項", items: [] };
      state.prep.unshift(todoCat);
    }
    if (!packCat) {
      packCat = { id: "cat-packing", name: "🎒 行李清單", items: [] };
      state.prep.push(packCat);
    }

    let added = 0;
    sug.todo.forEach(text => {
      if (!todoCat.items.some(i => i.text === text)) {
        todoCat.items.push({ id: nextPrepId++, text, done: false });
        added++;
      }
    });
    sug.packing.forEach(text => {
      if (!packCat.items.some(i => i.text === text)) {
        packCat.items.push({ id: nextPrepId++, text, done: false });
        added++;
      }
    });

    persist();
    renderPrep();
    btn.textContent = "✨ AI 建議行前準備";
    btn.disabled = false;
    const ctx = sug.dest
      ? `偵測到「${sug.dest.hint}」行程`
      : "依目前行程內容";
    if (added === 0) {
      alert(`🤖 ${ctx}：看起來都齊了！要更多建議，自己再加分類後點一次。`);
    } else {
      alert(`✨ ${ctx}，加了 ${added} 個小提醒到清單裡，記得勾掉已經處理好的～`);
    }
  }, 700);
});

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
  s => s.some(x => x.photo) ? `📷 已經有 <b>${s.filter(x=>x.photo).length} 張旅行照片</b>，繼續記錄下去吧！` : null,
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
  btn.textContent = "🧠 思考中...";
  btn.disabled = true;
  setTimeout(() => {
    takeAiSnapshot();
    rearrangeOneDay(state.currentDay);
    persist();
    renderAll();
    btn.textContent = "✨ 重排這天";
    btn.disabled = false;
  }, 700);
});

$("askAiAllBtn").addEventListener("click", () => {
  if (!confirm("要讓 AI 幫整趟旅行重新排嗎？\n如果不滿意可以按「↩️ 還原」復原。")) return;
  const btn = $("askAiAllBtn");
  btn.textContent = "🧠 整趟思考中...";
  btn.disabled = true;
  setTimeout(() => {
    takeAiSnapshot();
    Object.keys(state.days).forEach(d => rearrangeOneDay(d));
    persist();
    renderAll();
    btn.textContent = "🌐 重排整趟";
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
function collectTransitCosts() {
  // 把每對景點之間「有費用」的交通段，整理成錢包要顯示的條目
  const entries = [];
  Object.keys(state.days).map(Number).sort((a, b) => a - b).forEach(d => {
    const spots = state.days[d] || [];
    spots.forEach((s, i) => {
      if (i === spots.length - 1) return;            // 最後一個沒有「下一站」
      if (!Array.isArray(s.travelLegs)) return;
      const totalCost = s.travelLegs.reduce((n, l) => n + (+l.cost || 0), 0);
      if (totalCost <= 0) return;
      const usedModes = [...new Set(
        s.travelLegs.filter(l => +l.cost > 0 || +l.mins > 0).map(l => l.mode.split(" ")[0])
      )].join("");
      entries.push({
        label: `${usedModes} ${s.name} → ${spots[i + 1].name}`,
        amt: totalCost,
        spotId: s.id,
        day: d,
      });
    });
  });
  return entries;
}

function renderExpenses() {
  expenseListEl.innerHTML = "";
  let total = 0;

  // 1️⃣ 手動輸入的花費
  state.expenses.forEach((e, idx) => {
    total += e.amt;
    const li = document.createElement("li");
    li.innerHTML = `
      <span>
        <div>${escapeHtml(e.item)}</div>
        <div class="who">由 ${escapeHtml(e.who)} 支付</div>
      </span>
      <div class="expense-right">
        <b>${e.amt} <small>TWD</small></b>
        <button class="icon-btn del tiny" data-exp-del="${idx}" title="刪除">✕</button>
      </div>
    `;
    expenseListEl.appendChild(li);
  });

  // 2️⃣ 自動：交通費（從每段 leg.cost 加總）
  const transit = collectTransitCosts();
  if (transit.length > 0) {
    const groupHead = document.createElement("li");
    groupHead.className = "wallet-group-head";
    groupHead.innerHTML = `🚇 交通費（自動計算）`;
    expenseListEl.appendChild(groupHead);
    transit.forEach(t => {
      total += t.amt;
      const li = document.createElement("li");
      li.className = "auto-entry";
      li.dataset.spotId = t.spotId;
      li.dataset.day = t.day;
      li.innerHTML = `
        <span>
          <div>${escapeHtml(t.label)}</div>
          <div class="who"><span class="auto-tag">Day ${t.day} · 自動</span></div>
        </span>
        <div class="expense-right">
          <b>${t.amt} <small>TWD</small></b>
        </div>
      `;
      // 點此條目 → 切到那天並開啟交通編輯
      li.addEventListener("click", () => {
        state.currentDay = t.day;
        const spots = state.days[t.day];
        const fromSpot = spots.find(s => s.id === t.spotId);
        renderAll();
        if (fromSpot) openTransitEditor(fromSpot);
      });
      expenseListEl.appendChild(li);
    });
  }

  $("totalAmount").textContent = total.toLocaleString();
  expenseListEl.querySelectorAll("[data-exp-del]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      state.expenses.splice(+btn.dataset.expDel, 1);
      persist();
      renderExpenses();
    });
  });
}
$("receiptInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const fakeAmt = 100 + Math.floor(Math.random() * 1500);
  state.expenses.push({
    who: "我",
    item: `收據：${file.name.slice(0, 15)}`,
    amt: fakeAmt,
  });
  persist();
  renderExpenses();
  alert(`📷 已辨識金額：${fakeAmt} TWD（示範用，正式版會用 OCR 讀發票）`);
  e.target.value = "";
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
  const allPrep = state.prep.flatMap(c => c.items);
  const prepDone = allPrep.filter(p => p.done).length;
  const totalCost = state.expenses.reduce((n, e) => n + e.amt, 0);

  let html = `
    <div class="print-title">
      <h1>${escapeHtml(state.meta.cover || "🌸")} ${escapeHtml(state.meta.title)}</h1>
      <p>${escapeHtml(state.meta.dates || "")}</p>
    </div>
  `;

  // 去程 / 回程
  if (t.outbound || t.return) {
    html += `<h2>✈️ 出發與回程</h2><div class="print-travel">`;
    ["outbound", "return"].forEach(leg => {
      const d = t[leg];
      if (!d) return;
      html += `
        <div class="print-travel-item">
          <b>${leg === "outbound" ? "去程" : "回程"} · ${escapeHtml(d.type)} ${escapeHtml(d.number)}</b><br/>
          🛫 ${escapeHtml(d.departAt)} ${escapeHtml(d.departFrom)}<br/>
          🛬 ${escapeHtml(d.arriveAt)} ${escapeHtml(d.arriveTo)}
          ${d.note ? `<br/><small>${escapeHtml(d.note)}</small>` : ""}
        </div>`;
    });
    html += `</div>`;
  }

  // 每一天的行程
  const days = Object.keys(state.days).map(Number).sort((a, b) => a - b);
  days.forEach(d => {
    const spots = state.days[d] || [];
    if (spots.length === 0) return;
    html += `<h2>📅 Day ${d}</h2><div class="print-day">`;
    spots.forEach((s, i) => {
      const cat = spotCat(s.category);
      const isLastHotel = (i === spots.length - 1) && s.category === "hotel";
      const durLabel = isLastHotel ? "🛌 過夜" : (s.dur || 0) + " 分";
      html += `
        <div class="print-spot">
          <div class="p-time">${escapeHtml(s.start)}<br/><small>${durLabel}</small></div>
          <div class="p-body">
            <b>${cat.emoji} ${escapeHtml(s.name)}</b>
            <span class="p-cat">${cat.label}</span><br/>
            <small>${escapeHtml(s.addr || "")}</small>
            ${s.cost ? ` · 💴 ${s.cost} TWD` : ""}
            ${s.note ? `<div class="p-note">${escapeHtml(s.note)}</div>` : ""}
          </div>
        </div>`;
      // 多段交通顯示
      if (i < spots.length - 1) {
        const tr = getTransit(s, spots[i + 1]);
        html += `<div class="p-transit">`;
        tr.legs.forEach((leg, li) => {
          const route = (leg.from || leg.to)
            ? ` (${escapeHtml(leg.from || "?")} → ${escapeHtml(leg.to || "?")})` : "";
          html += `${li > 0 ? "<br/>" : ""}↓ ${leg.mode} ${leg.mins} 分${route}`;
        });
        html += ` <b>共 ${tr.totalMins} 分</b></div>`;
      }
    });
    html += `</div>`;
  });

  // 行前準備（依分類）
  if (allPrep.length > 0) {
    html += `<h2>📝 行前準備 (${prepDone}/${allPrep.length})</h2>`;
    state.prep.forEach(cat => {
      if (cat.items.length === 0) return;
      const done = cat.items.filter(i => i.done).length;
      html += `<h3 class="print-prep-cat">${escapeHtml(cat.name)} (${done}/${cat.items.length})</h3><ul class="print-prep">`;
      cat.items.forEach(it => {
        html += `<li>${it.done ? "☑" : "☐"} ${escapeHtml(it.text)}</li>`;
      });
      html += `</ul>`;
    });
  }

  // 花費總覽
  if (state.expenses.length > 0) {
    html += `<h2>💰 花費總覽（共 ${totalCost.toLocaleString()} TWD）</h2><ul class="print-exp">`;
    state.expenses.forEach(e => {
      html += `<li>${escapeHtml(e.item)} — ${e.amt} TWD（${escapeHtml(e.who)}）</li>`;
    });
    html += `</ul>`;
  }

  el.innerHTML = html;
}

// ============================================================
// 初始化
// ============================================================
function renderAll() {
  renderDayTabs();
  renderTimeline();
  renderTravel();
  renderExpenses();
  renderPrep();
  refreshAiTips();
}
renderAll();
