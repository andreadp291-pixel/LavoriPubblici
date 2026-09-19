requireAuth();

const CATEGORY_LABELS = {
  sfalci: "Sfalci erba",
  potature: "Potature",
  asfaltature: "Asfaltature",
};

const STATO_LABELS = {
  da_fare: "Da fare",
  in_corso: "In corso",
  fatto: "Fatto",
};

const STATO_COLORS = {
  da_fare: "#b23b3b",
  in_corso: "#c98a1f",
  fatto: "#2e7d46",
};

const params = new URLSearchParams(window.location.search);
const category = params.get("cat");

if (!CATEGORY_LABELS[category]) {
  window.location.href = "dashboard.html";
}

document.getElementById("page-title").textContent = CATEGORY_LABELS[category];

const CASTELFRANCO = [45.6716, 11.9236];
const map = L.map("map").setView(CASTELFRANCO, 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const markers = new Map();

function markerIcon(stato) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${STATO_COLORS[stato]};border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function popupHtml(point) {
  const isNew = point.id === undefined;
  return `
    <div class="popup-form" data-id="${isNew ? "" : point.id}">
      <label>Stato</label>
      <select class="f-stato">
        ${Object.entries(STATO_LABELS)
          .map(
            ([val, label]) =>
              `<option value="${val}" ${point.stato === val ? "selected" : ""}>${label}</option>`
          )
          .join("")}
      </select>
      <label>Note</label>
      <textarea class="f-note">${point.note ? escapeHtml(point.note) : ""}</textarea>
      <div class="popup-actions">
        <button class="btn-save">Salva</button>
        ${isNew ? "" : '<button class="btn-delete">Elimina</button>'}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function bindPopupActions(marker, point) {
  marker.on("popupopen", () => {
    const el = marker.getPopup().getElement();
    const saveBtn = el.querySelector(".btn-save");
    const deleteBtn = el.querySelector(".btn-delete");

    saveBtn.addEventListener("click", async () => {
      const stato = el.querySelector(".f-stato").value;
      const note = el.querySelector(".f-note").value;
      try {
        if (point.id === undefined) {
          const created = await apiFetch("/api/points", {
            method: "POST",
            body: JSON.stringify({ category, lat: point.lat, lon: point.lon, note, stato }),
          });
          map.removeLayer(marker);
          addMarker(created);
        } else {
          const updated = await apiFetch(`/api/points/${point.id}`, {
            method: "PUT",
            body: JSON.stringify({ note, stato }),
          });
          point.note = updated.note;
          point.stato = updated.stato;
          marker.setIcon(markerIcon(point.stato));
          marker.closePopup();
        }
      } catch (err) {
        alert(err.message);
      }
    });

    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Eliminare questo punto?")) return;
        try {
          await apiFetch(`/api/points/${point.id}`, { method: "DELETE" });
          map.removeLayer(marker);
          markers.delete(point.id);
        } catch (err) {
          alert(err.message);
        }
      });
    }
  });
}

function addMarker(point) {
  const marker = L.marker([point.lat, point.lon], { icon: markerIcon(point.stato) }).addTo(map);
  marker.bindPopup(popupHtml(point));
  bindPopupActions(marker, point);
  if (point.id !== undefined) {
    markers.set(point.id, marker);
  }
  return marker;
}

map.on("click", (e) => {
  const point = { lat: e.latlng.lat, lon: e.latlng.lng, note: "", stato: "da_fare" };
  const marker = addMarker(point);
  marker.openPopup();
});

async function loadPoints() {
  try {
    const points = await apiFetch(`/api/points?category=${category}`);
    points.forEach((p) => addMarker(p));
  } catch (err) {
    alert(err.message);
  }
}

loadPoints();
