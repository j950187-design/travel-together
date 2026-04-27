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
      (n, d) => n + d.filter(s => s.photo).length, 0
    );
    const total = (t.expenses || []).reduce((n, e) => n + e.amt, 0);

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
  saveTrip(id, {
    meta: {
      title,
      dates,
      cover: chosenCover,
      createdAt: Date.now(),
    },
    currentDay: 1,
    days: { 1: [] },
    expenses: [],
  });
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
// 📥 匯入：從 .json 檔還原 / 合併旅行
// ============================================================
document.getElementById("importInput").addEventListener("change", e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);

      // 接受兩種格式：
      // 1) 我們匯出的格式 { app, version, trips: { id: trip } }
      // 2) 直接是 trips 物件 { id: trip }
      let incoming;
      if (parsed && typeof parsed === "object" && parsed.trips && typeof parsed.trips === "object") {
        incoming = parsed.trips;
      } else if (parsed && typeof parsed === "object" && Object.values(parsed).every(t => t && t.meta)) {
        incoming = parsed;
      } else {
        throw new Error("檔案內容不是旅行資料");
      }

      const incomingIds = Object.keys(incoming);
      if (incomingIds.length === 0) {
        alert("📭 這個檔案裡沒有任何旅行喔");
        return;
      }

      const existing = loadAllTrips();
      const overlap = incomingIds.filter(id => existing[id]);

      // 如果有重疊：詢問要覆蓋還是當新的另存
      let proceed = true;
      let mode = "merge";
      if (overlap.length > 0) {
        const choice = confirm(
          `要匯入 ${incomingIds.length} 趟旅行，其中 ${overlap.length} 趟跟現有的 ID 重複。\n\n` +
          `按「確定」→ 覆蓋同 ID 的舊資料\n` +
          `按「取消」→ 把它們當新旅行另存（不覆蓋）`
        );
        mode = choice ? "overwrite" : "asNew";
      }

      let added = 0, replaced = 0;
      for (const [id, trip] of Object.entries(incoming)) {
        if (existing[id]) {
          if (mode === "overwrite") {
            existing[id] = trip;
            replaced++;
          } else {
            // 另存新 ID，避免覆蓋
            const newId = newTripId();
            const renamed = JSON.parse(JSON.stringify(trip));
            if (renamed.meta) renamed.meta.title = (renamed.meta.title || "未命名") + "（匯入）";
            existing[newId] = renamed;
            added++;
          }
        } else {
          existing[id] = trip;
          added++;
        }
      }
      saveAllTrips(existing);
      alert(`📥 匯入完成！\n新增 ${added} 趟${replaced ? `、覆蓋 ${replaced} 趟舊資料` : ""}。`);
      renderTrips();
    } catch (err) {
      alert(`😢 匯入失敗：${err.message}\n請確認是從本程式匯出的 .json 檔案。`);
    }
    // 清空 input value，下次選同一個檔也會觸發
    e.target.value = "";
  };
  reader.onerror = () => alert("😢 讀取檔案失敗，請再試一次");
  reader.readAsText(file, "utf-8");
});
