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

function addElementToMap(element) {
  const layer = buildLayer(element).addTo(map);
  layer.on("click", () => openPanel(element, layer));
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

// ── Pannello dettagli / modifica ──
const panel = document.getElementById("element-panel");
const panelTitle = document.getElementById("panel-title");
const panelNote = document.getElementById("panel-note");
const panelProgrammata = document.getElementById("panel-programmata");
const panelUltima = document.getElementById("panel-ultima");
const panelError = document.getElementById("panel-error");
const panelEditBtn = document.getElementById("panel-edit");
const panelSaveBtn = document.getElementById("panel-save");
const panelDeleteBtn = document.getElementById("panel-delete");

let panelState = null; // { element, layer, editing }

function applyPanelMode() {
  const isNew = panelState.element.id === undefined;
  const editing = panelState.editing;
  const fieldsEnabled = editing;

  panelNote.disabled = !fieldsEnabled;
  panelProgrammata.disabled = !fieldsEnabled;
  panelUltima.disabled = !fieldsEnabled;

  panelEditBtn.hidden = !canEdit || editing;
  panelSaveBtn.hidden = !editing;
  panelDeleteBtn.hidden = !editing || isNew;
}

function openPanel(element, layer) {
  panelState = { element, layer, editing: element.id === undefined };
  panelTitle.textContent = `${GEOM_LABELS[element.geom_type]} — ${CATEGORY_LABELS[category]}`;
  panelNote.value = element.note || "";
  panelProgrammata.value = element.data_programmata || "";
  panelUltima.value = element.data_ultima_esecuzione || "";
  panelError.textContent = "";

  applyPanelMode();

  panel.hidden = false;
}

function closePanel() {
  panel.hidden = true;
  panelState = null;
}

panelEditBtn.addEventListener("click", () => {
  if (!panelState) return;
  panelState.editing = true;
  applyPanelMode();
});

document.getElementById("panel-close").addEventListener("click", () => {
  if (panelState && panelState.element.id === undefined) {
    cancelDrawing();
  } else {
    closePanel();
  }
});

panelSaveBtn.addEventListener("click", async () => {
  if (!panelState) return;
  panelError.textContent = "";
  const note = panelNote.value;
  const data_programmata = panelProgrammata.value || null;
  const data_ultima_esecuzione = panelUltima.value || null;

  try {
    if (panelState.element.id === undefined) {
      const created = await apiFetch("/api/points", {
        method: "POST",
        body: JSON.stringify({
          category,
          geom_type: panelState.element.geom_type,
          geom_coords: panelState.element.geom_coords,
          note,
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
        body: JSON.stringify({ note, data_programmata, data_ultima_esecuzione }),
      });
      removeElementFromMap(updated.id);
      addElementToMap(updated);
    }
    closePanel();
  } catch (err) {
    panelError.textContent = err.message || "Errore durante il salvataggio";
  }
});

panelDeleteBtn.addEventListener("click", async () => {
  if (!panelState || panelState.element.id === undefined) return;
  if (!confirm("Eliminare questo elemento?")) return;
  try {
    await apiFetch(`/api/points/${panelState.element.id}`, { method: "DELETE" });
    removeElementFromMap(panelState.element.id);
    closePanel();
  } catch (err) {
    alert(err.message || "Errore durante l'eliminazione");
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
  openPanel(fakeElement, layer);
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
