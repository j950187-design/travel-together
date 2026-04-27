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
