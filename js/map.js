const CATEGORY_LABELS = {
  sfalci: "Sfalci erba",
  potature: "Potature",
  asfaltature: "Asfaltature",
};

// Tipi di geometria ammessi per categoria (deve rispecchiare il backend).
const CATEGORY_GEOM_TYPES = {
  sfalci: ["polygon"],
  potature: ["point", "line"],
  asfaltature: ["line"],
};

const GEOM_LABELS = { point: "Punto", line: "Linea", polygon: "Area" };

const params = new URLSearchParams(window.location.search);
const category = params.get("cat");

if (!CATEGORY_GEOM_TYPES[category]) {
  window.location.href = "dashboard.html";
}

document.getElementById("page-title").textContent = CATEGORY_LABELS[category];

const CASTELFRANCO = [45.6716, 11.9236];
const map = L.map("map").setView(CASTELFRANCO, 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let canEdit = false;
const layersById = new Map();

// ── Scala colore in base a quanto tempo fa è stato eseguito il lavoro ──
function colorForLastDone(dateStr) {
  if (!dateStr) return "#555555"; // mai eseguito
  const last = new Date(dateStr + "T00:00:00");
  const days = Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000));
  const clamped = Math.min(days, 365);
  const hue = 120 * (1 - clamped / 365); // 120 (verde, recente) -> 0 (rosso, lontano)
  return `hsl(${hue.toFixed(0)}, 65%, 42%)`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// ── Rendering geometrie ──
function markerIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function buildLayer(element) {
  const color = colorForLastDone(element.data_ultima_esecuzione);
  if (element.geom_type === "point") {
    const [lat, lon] = element.geom_coords;
    return L.marker([lat, lon], { icon: markerIcon(color) });
  }
  if (element.geom_type === "line") {
    return L.polyline(element.geom_coords, { color, weight: 5 });
  }
  if (element.geom_type === "polygon") {
    return L.polygon(element.geom_coords, { color, fillColor: color, fillOpacity: 0.35, weight: 2 });
  }
}

function elementCenter(element) {
  if (element.geom_type === "point") {
    const [lat, lon] = element.geom_coords;
    return L.latLng(lat, lon);
  }
  const bounds = L.latLngBounds(element.geom_coords);
  return bounds.getCenter();
}

function addElementToMap(element) {
  const layer = buildLayer(element).addTo(map);
  layer.on("click", (e) => openPanel(element, layer, e.latlng || elementCenter(element)));
  layersById.set(element.id, { element, layer });
}

function removeElementFromMap(id) {
  const entry = layersById.get(id);
  if (entry) {
    map.removeLayer(entry.layer);
    layersById.delete(id);
  }
}

async function loadElements() {
  try {
    const elements = await apiFetch(`/api/points?category=${category}`);
    elements.forEach(addElementToMap);
  } catch (err) {
    alert(err.message);
  }
}

// ── Mini popup flottante dettagli / modifica ──
let panelState = null; // { element, layer, editing, popup }

function buildPopupHtml() {
  return `
    <div class="popup-form">
      <h2 class="popup-title">${GEOM_LABELS[panelState.element.geom_type]} — ${CATEGORY_LABELS[category]}</h2>
      <label>Nota</label>
      <textarea id="popup-note"></textarea>
      <label>Programmato per il</label>
      <input type="date" id="popup-programmata" />
      <label>Ultima esecuzione</label>
      <input type="date" id="popup-ultima" />
      <div class="error-msg" id="popup-error"></div>
      <div class="popup-actions">
        <button class="btn-save" id="popup-edit" hidden>Modifica</button>
        <button class="btn-save" id="popup-save" hidden>Salva</button>
        <button class="btn-delete" id="popup-delete" hidden>Elimina</button>
      </div>
    </div>`;
}

function applyPanelMode() {
  const isNew = panelState.element.id === undefined;
  const editing = panelState.editing;

  const note = document.getElementById("popup-note");
  const programmata = document.getElementById("popup-programmata");
  const ultima = document.getElementById("popup-ultima");
  const editBtn = document.getElementById("popup-edit");
  const saveBtn = document.getElementById("popup-save");
  const deleteBtn = document.getElementById("popup-delete");
  if (!note) return;

  note.disabled = !editing;
  programmata.disabled = !editing;
  ultima.disabled = !editing;

  editBtn.hidden = !canEdit || editing;
  saveBtn.hidden = !editing;
  deleteBtn.hidden = !editing || isNew;
}

function wirePopupHandlers() {
  const note = document.getElementById("popup-note");
  const programmata = document.getElementById("popup-programmata");
  const ultima = document.getElementById("popup-ultima");
  const error = document.getElementById("popup-error");
  const editBtn = document.getElementById("popup-edit");
  const saveBtn = document.getElementById("popup-save");
  const deleteBtn = document.getElementById("popup-delete");
  if (!note) return;

  note.value = panelState.element.note || "";
  programmata.value = panelState.element.data_programmata || "";
  ultima.value = panelState.element.data_ultima_esecuzione || "";

  applyPanelMode();

  editBtn.addEventListener("click", () => {
    panelState.editing = true;
    applyPanelMode();
  });

  saveBtn.addEventListener("click", async () => {
    error.textContent = "";
    const noteVal = note.value;
    const data_programmata = programmata.value || null;
    const data_ultima_esecuzione = ultima.value || null;

    try {
      if (panelState.element.id === undefined) {
        const created = await apiFetch("/api/points", {
          method: "POST",
          body: JSON.stringify({
            category,
            geom_type: panelState.element.geom_type,
            geom_coords: panelState.element.geom_coords,
            note: noteVal,
            data_programmata,
            data_ultima_esecuzione,
          }),
        });
        map.removeLayer(panelState.layer);
        addElementToMap(created);
        finishDrawingUi();
      } else {
        const updated = await apiFetch(`/api/points/${panelState.element.id}`, {
          method: "PUT",
          body: JSON.stringify({ note: noteVal, data_programmata, data_ultima_esecuzione }),
        });
        removeElementFromMap(updated.id);
        addElementToMap(updated);
      }
      map.closePopup();
    } catch (err) {
      error.textContent = err.message || "Errore durante il salvataggio";
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (panelState.element.id === undefined) return;
    if (!confirm("Eliminare questo elemento?")) return;
    try {
      await apiFetch(`/api/points/${panelState.element.id}`, { method: "DELETE" });
      removeElementFromMap(panelState.element.id);
      map.closePopup();
    } catch (err) {
      alert(err.message || "Errore durante l'eliminazione");
    }
  });
}

function openPanel(element, layer, latlng) {
  panelState = { element, layer, editing: element.id === undefined };
  const popup = L.popup({ closeButton: true, minWidth: 240, autoPan: true })
    .setLatLng(latlng)
    .setContent(buildPopupHtml())
    .openOn(map);
  panelState.popup = popup;
  wirePopupHandlers();
}

function closePanel() {
  map.closePopup();
  panelState = null;
}

map.on("popupclose", (e) => {
  if (panelState && panelState.popup === e.popup) {
    if (panelState.element.id === undefined) {
      map.removeLayer(panelState.layer);
      cancelDrawing();
    }
    panelState = null;
  }
});

// ── Disegno di nuovi elementi ──
const toolbar = document.getElementById("draw-toolbar");
const idleControls = document.getElementById("draw-idle-controls");
const activeControls = document.getElementById("draw-active-controls");
const drawHint = document.getElementById("draw-hint");
const btnPoint = document.getElementById("btn-draw-point");
const btnLine = document.getElementById("btn-draw-line");
const btnPolygon = document.getElementById("btn-draw-polygon");
const btnFinish = document.getElementById("btn-draw-finish");
const btnCancel = document.getElementById("btn-draw-cancel");

let drawing = null; // { geomType, vertices, tempLayer }

function setupDrawToolbar() {
  const allowed = CATEGORY_GEOM_TYPES[category];
  btnPoint.hidden = !allowed.includes("point");
  btnLine.hidden = !allowed.includes("line");
  btnPolygon.hidden = !allowed.includes("polygon");
  toolbar.hidden = false;
}

function startDrawing(geomType) {
  drawing = { geomType, vertices: [], tempLayer: null };
  idleControls.hidden = true;
  activeControls.hidden = false;
  btnFinish.hidden = geomType === "point";
  if (geomType === "point") {
    drawHint.textContent = "Clicca sulla mappa per posizionare il punto.";
  } else if (geomType === "line") {
    drawHint.textContent = "Clicca per aggiungere vertici, poi 'Fine' (almeno 2 punti).";
  } else {
    drawHint.textContent = "Clicca per aggiungere vertici, poi 'Fine' (almeno 3 punti).";
  }
}

function cancelDrawing() {
  if (drawing && drawing.tempLayer) {
    map.removeLayer(drawing.tempLayer);
  }
  drawing = null;
  idleControls.hidden = false;
  activeControls.hidden = true;
  closePanel();
}

function finishDrawingUi() {
  drawing = null;
  idleControls.hidden = false;
  activeControls.hidden = true;
}

function updateTempLayer() {
  if (drawing.tempLayer) {
    map.removeLayer(drawing.tempLayer);
  }
  if (drawing.vertices.length === 0) return;
  const style = { color: "#1f5c32", weight: 4, dashArray: "6 6" };
  if (drawing.geomType === "line") {
    drawing.tempLayer = L.polyline(drawing.vertices, style).addTo(map);
  } else if (drawing.geomType === "polygon") {
    drawing.tempLayer = L.polygon(drawing.vertices, { ...style, fillOpacity: 0.2 }).addTo(map);
  }
}

function openCreatePanel(geomType, coords) {
  const fakeElement = { id: undefined, geom_type: geomType, geom_coords: coords, note: "", data_programmata: null, data_ultima_esecuzione: null };
  const layer = buildLayer(fakeElement).addTo(map);
  openPanel(fakeElement, layer, elementCenter(fakeElement));
}

btnPoint.addEventListener("click", () => startDrawing("point"));
btnLine.addEventListener("click", () => startDrawing("line"));
btnPolygon.addEventListener("click", () => startDrawing("polygon"));
btnCancel.addEventListener("click", cancelDrawing);

btnFinish.addEventListener("click", () => {
  if (!drawing) return;
  const minPoints = drawing.geomType === "polygon" ? 3 : 2;
  if (drawing.vertices.length < minPoints) {
    alert(`Servono almeno ${minPoints} punti.`);
    return;
  }
  const coords = drawing.vertices;
  const geomType = drawing.geomType;
  if (drawing.tempLayer) {
    map.removeLayer(drawing.tempLayer);
  }
  drawing = null;
  idleControls.hidden = false;
  activeControls.hidden = true;
  openCreatePanel(geomType, coords);
});

map.on("click", (e) => {
  if (!canEdit || !drawing) return;
  const coord = [e.latlng.lat, e.latlng.lng];

  if (drawing.geomType === "point") {
    const geomType = "point";
    idleControls.hidden = false;
    activeControls.hidden = true;
    drawing = null;
    openCreatePanel(geomType, coord);
    return;
  }

  drawing.vertices.push(coord);
  updateTempLayer();
});

requireAuth().then((me) => {
  if (!me) return;
  canEdit = me.role === "admin" || me.role === "editor";
  if (canEdit) setupDrawToolbar();
  loadElements();
});
