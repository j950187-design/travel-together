/* ============================================================
   🏠 首頁：顯示所有旅行、新增新旅行
   ============================================================ */

const gridEl = document.getElementById("tripGrid");
const newTripBtn = document.getElementById("newTripBtn");
const newTripModal = document.getElementById("newTripModal");
const createTripBtn = document.getElementById("createTripBtn");
const coverPicker = document.getElementById("coverPicker");

let chosenCover = "🌸";

// 第一次打開：放一個範例旅行
seedIfEmpty();
renderTrips();

function renderTrips() {
  const all = loadAllTrips();
  const ids = Object.keys(all).sort(
    (a, b) => (all[b].meta.createdAt || 0) - (all[a].meta.createdAt || 0)
  );

  gridEl.innerHTML = "";

  if (ids.length === 0) {
    gridEl.innerHTML = `
      <div class="empty-home">
        <div style="font-size:72px;">🗺️</div>
        <h3>還沒有任何旅行計畫</h3>
        <p>點右上角的「新增旅行」開始你的第一趟冒險吧！</p>
      </div>`;
    return;
  }

  ids.forEach(id => {
    const t = all[id];
    const dayCount = Object.keys(t.days || {}).length;
    const spotCount = Object.values(t.days || {}).reduce((n, d) => n + d.length, 0);
    const photoCount = Object.values(t.days || {}).reduce(
      (n, d) => n + d.reduce((sum, s) => sum + (Array.isArray(s.photos) ? s.photos.length : (s.photo ? 1 : 0)), 0), 0
    );
    const total = (t.expenses || []).reduce((n, e) => n + (Number(e.amt ?? e.amount) || 0), 0);

    const card = document.createElement("div");
    card.className = "trip-card";
    card.innerHTML = `
      <a class="trip-link" href="trip.html?id=${id}">
        <div class="trip-cover">
          <span class="cover-emoji">${t.meta.cover || "🌸"}</span>
        </div>
        <div class="trip-info">
          <h3>${escapeHtml(t.meta.title)}</h3>
          <p class="dates">${escapeHtml(t.meta.dates || "尚未設定日期")}</p>
          <div class="stats">
            <span title="天數">📅 ${dayCount} 天</span>
            <span title="景點數">📍 ${spotCount}</span>
            <span title="照片數">📷 ${photoCount}</span>
            <span title="花費">💰 ${total.toLocaleString()}</span>
          </div>
        </div>
      </a>
      <button class="trip-del" data-id="${id}" title="刪除這趟旅行">✕</button>
    `;
    gridEl.appendChild(card);
  });

  gridEl.querySelectorAll(".trip-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const t = loadTrip(id);
      if (!t) return;
      if (confirm(`真的要刪除「${t.meta.title}」嗎？🥲\n這會連同所有照片、記帳一起消失。`)) {
        deleteTripById(id);
        renderTrips();
      }
    });
  });
}

// ----- 新增旅行 Modal -----
newTripBtn.addEventListener("click", () => {
  document.getElementById("tripTitle").value = "";
  document.getElementById("tripDates").value = "";
  chosenCover = "🌸";
  coverPicker.querySelectorAll("button").forEach(b =>
    b.classList.toggle("active", b.dataset.emoji === "🌸")
  );
  newTripModal.hidden = false;
});

coverPicker.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  chosenCover = b.dataset.emoji;
  coverPicker.querySelectorAll("button").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
});

createTripBtn.addEventListener("click", () => {
  const title = document.getElementById("tripTitle").value.trim() || "我的新旅行";
  const dates = document.getElementById("tripDates").value.trim();
  const id = newTripId();
  saveTrip(id, normalizeTripData({
    meta: {
      title,
      dates,
      cover: chosenCover,
      createdAt: Date.now(),
    },
    currentDay: 1,
    days: { 1: [] },
    expenses: [],
  }));
  // 建完直接跳進去規劃
  window.location.href = `trip.html?id=${id}`;
});

// 通用關閉 Modal
document.querySelectorAll("[data-close]").forEach(el => {
  el.addEventListener("click", e => {
    e.target.closest(".modal").hidden = true;
  });
});
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m) m.hidden = true; });
});

// ============================================================
// 📤 匯出：把所有旅行打包成 .json 檔下載
// ============================================================
document.getElementById("exportAllBtn").addEventListener("click", () => {
  const trips = loadAllTrips();
  const tripCount = Object.keys(trips).length;
  if (tripCount === 0) {
    alert("📭 目前沒有任何旅行可以匯出，先新增一個吧！");
    return;
  }
  const data = {
    app: "TravelTogether",
    version: 1,
    exportedAt: new Date().toISOString(),
    trips,
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `travel-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ============================================================
// 📥 匯入：.json / Line .txt / Excel .xlsx / PDF
// ============================================================
document.getElementById("importInput").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  e.target.value = "";
  const ext = file.name.split(".").pop().toLowerCase();
  try {
    if (ext === "json") {
      const text = await file.text();
      importJsonBackup(text);
    } else if (ext === "txt") {
      const text = await file.text();
      importLineChat(text);
    } else if (ext === "xlsx" || ext === "xls") {
      await importExcel(file);
    } else if (ext === "pdf") {
      await importPdf(file);
    } else {
      alert("😢 不支援此格式，請上傳 .json、.txt（Line）、.xlsx 或 .pdf");
    }
  } catch (err) {
    alert(`😢 匯入失敗：${err.message}`);
  }
});

function importJsonBackup(text) {
  const parsed = JSON.parse(text);
  let incoming;
  if (parsed && parsed.trips && typeof parsed.trips === "object") {
    incoming = parsed.trips;
  } else if (parsed && typeof parsed === "object" && Object.values(parsed).every(t => t && t.meta)) {
    incoming = parsed;
  } else {
    throw new Error("檔案內容不是旅行資料，請確認是從本程式匯出的 .json 檔案。");
  }
  const incomingIds = Object.keys(incoming);
  if (incomingIds.length === 0) { alert("📭 這個檔案裡沒有任何旅行喔"); return; }

  const existing = loadAllTrips();
  const overlap = incomingIds.filter(id => existing[id]);
  let mode = "merge";
  if (overlap.length > 0) {
    const choice = confirm(
      `要匯入 ${incomingIds.length} 趟旅行，其中 ${overlap.length} 趟跟現有的 ID 重複。\n\n` +
      `按「確定」→ 覆蓋同 ID 的舊資料\n按「取消」→ 當新旅行另存`
    );
    mode = choice ? "overwrite" : "asNew";
  }
  let added = 0, replaced = 0;
  for (const [id, trip] of Object.entries(incoming)) {
    const normalizedTrip = normalizeTripData(JSON.parse(JSON.stringify(trip)));
    if (existing[id] && mode === "overwrite") { existing[id] = normalizedTrip; replaced++; }
    else if (existing[id]) {
      const newId = newTripId();
      const cp = normalizedTrip;
      if (cp.meta) cp.meta.title = (cp.meta.title || "未命名") + "（匯入）";
      existing[newId] = cp; added++;
    } else { existing[id] = normalizedTrip; added++; }
  }
  saveAllTrips(existing);
  alert(`📥 匯入完成！新增 ${added} 趟${replaced ? `、覆蓋 ${replaced} 趟舊資料` : ""}。`);
  renderTrips();
}

function extractCurrencyAmounts(text) {
  const re = /(?:(NT\$|NTD|TWD|\$|¥|JPY)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(元|日圓|円|日幣|台幣|新台幣))/gi;
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const marker = (m[1] || m[4] || "").toUpperCase();
    const raw = m[2] || m[3];
    const amt = normalizeAmount(raw);
    if (amt <= 0) continue;
    const ccy = /JPY|¥|日|円/.test(marker) ? "JPY" : "TWD";
    found.push({ amt, ccy });
  }
  return found;
}

// ── Line 聊天記錄解析 ──────────────────────────────────────
function importLineChat(text) {
  const lines = text.split(/\r?\n/);

  // 1. 取得群組 / 對話名稱作為行程標題
  let title = "Line 匯入行程";
  const headerM = text.match(/\[LINE\].*[「"'](.+?)[」"']/) ||
                  text.match(/\[LINE\] Chat history with [「"']?(.+?)[」"']?[\r\n]/);
  if (headerM) title = headerM[1].trim();

  // 2. 逐行解析，按日期分組
  // Line 日期行格式：2024/01/15(週一)  或  2024年1月15日(週一)
  const dateLine = /^(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})[日(（]/;
  // Line 訊息格式：12:00\t發話人\t內容  (有些版本是 下午12:00)
  const msgLine  = /^(上午|下午|AM|PM)?\s*(\d{1,2}:\d{2})[\t\s]+(.+?)[\t	](.+)$/i;

  const days = [];      // [{ dateStr, msgs: [{time,sender,text}] }]
  let cur = null;

  for (const line of lines) {
    const dm = line.match(dateLine);
    if (dm) {
      cur = { dateStr: `${dm[1]}/${dm[2].padStart(2,"0")}/${dm[3].padStart(2,"0")}`, msgs: [] };
      days.push(cur);
      continue;
    }
    const mm = line.match(msgLine);
    if (mm && cur) {
      cur.msgs.push({
        time: normalizeTimeValue(`${mm[1] || ""}${mm[2]}`, mm[2]),
        sender: mm[3].trim(),
        text: mm[4].trim()
      });
    }
  }

  if (days.length === 0) throw new Error("找不到 Line 聊天記錄的日期格式，請確認是 Line 匯出的 .txt 檔。");

  // 3. 旅伴（去掉系統訊息發話人）
  const systemSenders = new Set(["系統訊息","System Message","LINE"]);
  const senders = new Set();
  days.forEach(d => d.msgs.forEach(m => { if (!systemSenders.has(m.sender)) senders.add(m.sender); }));
  const peopleList = makePeopleFromNames([...senders]);
  const peopleIds = peopleList.length ? peopleList.map(p => p.id) : getDefaultPeople().map(p => p.id);
  const personIdByName = new Map((peopleList.length ? peopleList : getDefaultPeople()).map(p => [p.name, p.id]));
  const people = [...senders].join("、");

  // 4. 日期範圍
  const allDates = days.map(d => d.dateStr).sort();
  const dateRange = allDates.length > 1
    ? `${allDates[0]} - ${allDates[allDates.length - 1]}`
    : allDates[0];

  // 5. 每日行程：偵測地點 & 費用，其餘聊天存成備注景點
  const spotCategories = {
    餐廳: ["餐廳","吃飯","吃","午餐","晚餐","早餐","ramen","拉麵","燒肉","壽司","咖啡"],
    住宿: ["飯店","旅館","民宿","hotel","住","check","入住"],
    景點: ["景點","參觀","逛","公園","博物館","寺","神社","城","市場","購物","mall"],
    交通: ["飛機","班機","新幹線","電車","捷運","JR","出發","抵達","機場"],
  };
  const tripDays = {};
  const tripExpenses = [];

  days.forEach((day, idx) => {
    const dayNum = idx + 1;
    const spots = [];

    // 偵測地點關鍵字，提取潛在景點名
    const locationRe = /(?:去|到|前往|抵達|參觀|逛)([^\s，,。！!？?、\d]{2,10})/g;
    const foundLocations = new Map(); // name → {time, note, cat}

    day.msgs.forEach(msg => {
      if (systemSenders.has(msg.sender)) return;

      // 地點偵測
      let lm;
      while ((lm = locationRe.exec(msg.text)) !== null) {
        const loc = lm[1].replace(/[的了嗎呢吧～～!！？?。，,]/g, "").trim();
        if (loc.length >= 2 && !foundLocations.has(loc)) {
          let cat = "景點";
          for (const [c, kws] of Object.entries(spotCategories)) {
            if (kws.some(k => msg.text.includes(k))) { cat = c; break; }
          }
          foundLocations.set(loc, { time: msg.time, sender: msg.sender, cat, text: msg.text });
        }
      }

      // 費用偵測
      extractCurrencyAmounts(msg.text).forEach(({ amt, ccy }) => {
        tripExpenses.push({
          id: `exp-line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          item: msg.text.substring(0, 40),
          amt,
          ccy,
          paidBy: personIdByName.get(msg.sender) || peopleIds[0] || "p1",
          splitWith: peopleIds,
        });
      });
    });

    // 自動偵測到的地點 → 各別景點卡
    for (const [name, info] of foundLocations) {
      spots.push({
        id: `spot-line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        category: normalizeSpotCategory(info.cat),
        addr: "",
        note: `來自 Line：${info.text}`,
        cost: "",
        costCcy: "TWD",
        start: normalizeTimeValue(info.time, "09:00"),
        dur: 60,
        photos: [],
        shopItems: []
      });
    }

    // 全天聊天紀錄 → 存成一張「聊天備注」景點卡
    const chatNote = day.msgs
      .filter(m => !systemSenders.has(m.sender))
      .map(m => `${m.time} ${m.sender}：${m.text}`)
      .join("\n");
    if (chatNote) {
      spots.push({
        id: `spot-note-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: `💬 Day ${dayNum} 聊天記錄`,
        category: "other",
        addr: "",
        note: chatNote,
        cost: "",
        costCcy: "TWD",
        start: "09:00",
        dur: 0,
        photos: [],
        shopItems: []
      });
    }

    tripDays[dayNum] = spots;
  });

  // 6. 組成旅行物件並儲存
  const tripId = newTripId();
  const trip = {
    meta: {
      title,
      dates: dateRange,
      people,
      cover: "💬",
      createdAt: Date.now()
    },
    days: tripDays,
    people: peopleList.length ? peopleList : getDefaultPeople(),
    travel: { outbound: null, return: null },
    expenses: tripExpenses,
    prep: [],
    baseCurrency: "TWD"
  };

  const existing = loadAllTrips();
  existing[tripId] = normalizeTripData(trip);
  saveAllTrips(existing);

  const locCount = Object.values(tripDays).flat().filter(s => !s.name.startsWith("💬 Day")).length;
  const expCount = tripExpenses.length;
  alert(
    `✅ Line 聊天記錄匯入完成！\n\n` +
    `📅 ${days.length} 天  👥 ${[...senders].length} 位旅伴\n` +
    `📍 偵測到 ${locCount} 個地點  💰 ${expCount} 筆費用\n\n` +
    `每天的完整對話已存在「💬 聊天備注」景點卡，方便對照參考。`
  );
  renderTrips();
}

// ============================================================
// 共用工具
// ============================================================
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error(`無法載入外部函式庫：${src}`));
    document.head.appendChild(s);
  });
}

function makeSpotId() { return `spot-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function makeExpId()  { return `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function guessCat(name) {
  const n = (name || "").toLowerCase();
  if (/餐|食|吃|飯|cafe|coffee|咖啡|breakfast|lunch|dinner|ramen|拉麵|燒肉|壽司|居酒屋/.test(n)) return "food";
  if (/hotel|飯店|旅館|民宿|住宿|inn|lodge|hostel/.test(n)) return "hotel";
  if (/購物|商場|百貨|市場|mall|shop|shopping|買/.test(n)) return "shopping";
  if (/airport|機場|飛機|flight|航班|bus|train|jr|新幹線|電車|捷運|交通|車站/.test(n)) return "other";
  return "sight";
}

function parseAnyDate(cell) {
  if (!cell && cell !== 0) return null;
  // Excel serial number
  if (typeof cell === "number" && cell > 1000) {
    const d = new Date(Math.round((cell - 25569) * 86400 * 1000));
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  }
  const s = String(cell);
  const m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return `${m[1]}/${m[2].padStart(2,"0")}/${m[3].padStart(2,"0")}`;
  return null;
}

function saveTripAndAlert(trip, summary) {
  const id = newTripId();
  const all = loadAllTrips();
  all[id] = normalizeTripData(trip);
  saveAllTrips(all);
  alert(summary);
  renderTrips();
}

// ============================================================
// 📊 Excel (.xlsx / .xls) 匯入
// ============================================================
async function importExcel(file) {
  if (!window.XLSX) {
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
  }
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array", cellDates: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // 找 header 行（前 5 行裡含最多關鍵字的那行）
  const colKeys = {
    date:     ["日期","date","出發日","day"],
    time:     ["時間","time","出發","抵達"],
    location: ["地點","景點","活動","行程","名稱","location","place","name","item"],
    note:     ["備注","說明","note","memo","description","備註"],
    cost:     ["費用","金額","價格","cost","price","amount","花費"],
  };
  let headerIdx = 0, colMap = {};
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const found = {};
    rows[i].forEach((cell, ci) => {
      const s = String(cell).toLowerCase().trim();
      for (const [key, kws] of Object.entries(colKeys)) {
        if (!found[key] && kws.some(k => s.includes(k))) found[key] = ci;
      }
    });
    if (Object.keys(found).length > Object.keys(colMap).length) {
      colMap = found; headerIdx = i;
    }
  }

  const dayMap = new Map();
  let curDate = null;
  const expenseRe = /(?:NT\$|NTD|\$|¥|JPY)?\s*([\d,]+)/;

  rows.slice(headerIdx + 1).forEach(row => {
    const rawDate = colMap.date !== undefined ? row[colMap.date] : null;
    const ds = parseAnyDate(rawDate);
    if (ds) curDate = ds;
    if (!curDate) return;

    const name = String(colMap.location !== undefined ? row[colMap.location] : (row[1] || "")).trim();
    if (!name) return;

    const timeStr  = String(colMap.time !== undefined ? row[colMap.time] : "").trim();
    const noteStr  = String(colMap.note !== undefined ? row[colMap.note] : "").trim();
    const costRaw  = String(colMap.cost !== undefined ? row[colMap.cost] : "").trim();
    const costM    = costRaw.match(expenseRe);
    const cost     = costM ? parseFloat(costM[1].replace(/,/g, "")) : "";

    if (!dayMap.has(curDate)) dayMap.set(curDate, []);
    dayMap.get(curDate).push({
      id: makeSpotId(), name, category: guessCat(name),
      addr: "", note: noteStr,
      cost: cost || "", costCcy: "TWD",
      start: normalizeTimeValue(timeStr, "09:00"), dur: 60,
      photos: [], shopItems: []
    });
  });

  if (dayMap.size === 0) throw new Error("Excel 中找不到可解析的行程資料（需有日期欄位）。");

  const dates    = [...dayMap.keys()].sort();
  const tripDays = {};
  dates.forEach((d, i) => { tripDays[i + 1] = dayMap.get(d); });
  const title    = file.name.replace(/\.[^.]+$/, "") || "Excel 匯入行程";
  const dateRange = dates.length > 1 ? `${dates[0]} - ${dates[dates.length-1]}` : dates[0];
  const spotCount = Object.values(tripDays).flat().length;

  saveTripAndAlert({
    meta: { title, dates: dateRange, people: "", cover: "📊", createdAt: Date.now() },
    days: tripDays,
    travel: { outbound: null, return: null },
    expenses: [], prep: [], baseCurrency: "TWD"
  }, `✅ Excel 匯入完成！\n\n📅 ${dates.length} 天  📍 ${spotCount} 個項目`);
}

// ============================================================
// 📄 PDF 匯入（用 PDF.js 提取文字，再解析結構）
// ============================================================
async function importPdf(file) {
  if (!window.pdfjsLib) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // 逐頁提取文字，保留換行結構
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    // 根據 y 座標分行，讓不同高度的文字不黏在一起
    const byLine = new Map();
    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!byLine.has(y)) byLine.set(y, []);
      byLine.get(y).push(item.str);
    });
    [...byLine.keys()].sort((a,b) => b - a).forEach(y => {
      fullText += byLine.get(y).join(" ").trim() + "\n";
    });
    fullText += "\n";
  }

  // ── 解析邏輯：與 Line txt 類似 ──
  const lines   = fullText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const dateRe  = /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/;
  const timeRe  = /^(\d{1,2}:\d{2})/;

  const dayMap  = new Map();
  const expenses = [];
  let curDate   = null;

  lines.forEach(line => {
    const dm = line.match(dateRe);
    if (dm) {
      curDate = `${dm[1]}/${dm[2].padStart(2,"0")}/${dm[3].padStart(2,"0")}`;
      if (!dayMap.has(curDate)) dayMap.set(curDate, []);
      return;
    }

    // 費用偵測（不管有沒有日期都收）
    extractCurrencyAmounts(line).forEach(({ amt, ccy }) => {
      expenses.push({
        id: makeExpId(), item: line.substring(0, 40),
        amt, ccy, paidBy: "p1", splitWith: ["p1", "p2", "p3"]
      });
    });

    if (!curDate) return;
    const tm   = line.match(timeRe);
    const name = line.replace(timeRe, "").replace(dateRe, "").trim();
    if (name.length < 2 || name.length > 80) return;

    dayMap.get(curDate).push({
      id: makeSpotId(), name: name.substring(0, 50),
      category: guessCat(name), addr: "", note: "",
      cost: "", costCcy: "TWD",
      start: tm ? normalizeTimeValue(tm[1], "09:00") : "09:00", dur: 60,
      photos: [], shopItems: []
    });
  });

  // 沒解析到日期 → 把所有文字存成備注
  if (dayMap.size === 0) {
    dayMap.set("day1", [{
      id: makeSpotId(), name: "📄 PDF 內容備注",
      category: "other", addr: "",
      note: fullText.substring(0, 3000),
      cost: "", costCcy: "TWD", start: "09:00", dur: 0,
      photos: [], shopItems: []
    }]);
  }

  const dates    = [...dayMap.keys()].sort();
  const tripDays = {};
  dates.forEach((d, i) => { tripDays[i + 1] = dayMap.get(d); });
  const title    = file.name.replace(/\.[^.]+$/, "") || "PDF 匯入行程";
  const validDates = dates.filter(d => /\d{4}/.test(d));
  const dateRange  = validDates.length > 1
    ? `${validDates[0]} - ${validDates[validDates.length-1]}`
    : (validDates[0] || "");
  const spotCount = Object.values(tripDays).flat().length;

  saveTripAndAlert({
    meta: { title, dates: dateRange, people: "", cover: "📄", createdAt: Date.now() },
    days: tripDays,
    travel: { outbound: null, return: null },
    expenses, prep: [], baseCurrency: "TWD"
  }, `✅ PDF 匯入完成！\n\n📅 ${validDates.length} 天  📍 ${spotCount} 個項目  💰 ${expenses.length} 筆費用`);
}
