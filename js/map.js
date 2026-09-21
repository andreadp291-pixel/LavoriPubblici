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

// ── Import da OpenStreetMap (Overpass API), come in CastelfrancoStreets ──
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
// Le query sull'intera area comunale (non più su un piccolo bbox di vista) impiegano
// piu' tempo, soprattutto la prima volta che Overpass calcola l'area dalla relation:
// serve un timeout piu' lungo di quello usato per le query sul solo riquadro visibile.
const OVERPASS_TIMEOUT_MS = 30000;
const OVERPASS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuti

function overpassCacheKey(query) {
  return "osmCache_v1_" + query.replace(/\s+/g, " ").trim();
}

function readOverpassCache(query) {
  try {
    const raw = localStorage.getItem(overpassCacheKey(query));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > OVERPASS_CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeOverpassCache(query, data) {
  try {
    localStorage.setItem(overpassCacheKey(query), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // localStorage pieno o non disponibile: va bene lo stesso senza cache
  }
}

async function fetchOneMirror(url, query) {
  const res = await fetch(url, {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Interroga tutti i mirror in parallelo e usa il primo che risponde: molto più
// veloce del tentare un server alla volta quando uno è lento o irraggiungibile.
async function fetchOverpass(query) {
  const cached = readOverpassCache(query);
  if (cached) return cached;

  const data = await Promise.any(OVERPASS_MIRRORS.map((url) => fetchOneMirror(url, query)));
  writeOverpassCache(query, data);
  return data;
}

const params = new URLSearchParams(window.location.search);
const category = params.get("cat");

if (!CATEGORY_GEOM_TYPES[category]) {
  window.location.href = "dashboard.html";
}

document.getElementById("page-title").textContent = CATEGORY_LABELS[category];

const CASTELFRANCO = [45.6716, 11.9236];
const map = L.map("map", { maxZoom: 22 }).setView(CASTELFRANCO, 16);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  maxNativeZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let canEdit = false;
const layersById = new Map();

// Confine comunale: usato sia per disegnare il contorno di riferimento sia per
// filtrare lato client i risultati OSM, cosi' siamo SEMPRE sicuri che quello che
// viene proposto sia realmente dentro il territorio comunale (l'area() di Overpass
// da sola non basta: se scatta il fallback sul bbox rettangolare, quel rettangolo
// include anche zone fuori dal confine reale, che qui vengono scartate).
let castelfrancoBoundaryRings = null; // array di anelli [[lat,lon], ...] (poligoni esterni, buchi ignorati)

function ringsFromGeoJson(geojson) {
  const rings = [];
  const addPolygonCoords = (coords) => {
    // coords[0] = anello esterno in formato GeoJSON [lon,lat]; ignoriamo eventuali buchi.
    rings.push(coords[0].map(([lon, lat]) => [lat, lon]));
  };
  if (geojson.type === "Polygon") addPolygonCoords(geojson.coordinates);
  else if (geojson.type === "MultiPolygon") geojson.coordinates.forEach(addPolygonCoords);
  return rings;
}

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Nessun confine caricato ancora: non blocchiamo l'import (fail-open) piuttosto che
// nascondere tutto per un fetch a Nominatim non ancora arrivato o fallito.
function isInsideCastelfranco(lat, lon) {
  if (!castelfrancoBoundaryRings) return true;
  return castelfrancoBoundaryRings.some((ring) => pointInRing(lat, lon, ring));
}

fetch(`https://nominatim.openstreetmap.org/lookup?osm_type=R&osm_ids=45549&format=json&polygon_geojson=1`)
  .then((r) => r.json())
  .then((arr) => {
    if (arr && arr[0] && arr[0].geojson) {
      castelfrancoBoundaryRings = ringsFromGeoJson(arr[0].geojson);
      L.geoJSON(arr[0].geojson, {
        style: { color: "#2e7d46", weight: 2, fillOpacity: 0, dashArray: "6 6" },
        interactive: false,
      }).addTo(map);
    }
  })
  .catch(() => {});

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
  const title = panelState.bulkEntries
    ? panelState.bulkEntries.length > 1
      ? `${panelState.bulkEntries.length} elementi selezionati — ${CATEGORY_LABELS[category]}`
      : `${GEOM_LABELS[panelState.bulkEntries[0].geomType]} da OSM — ${CATEGORY_LABELS[category]}`
    : `${GEOM_LABELS[panelState.element.geom_type]} — ${CATEGORY_LABELS[category]}`;
  return `
    <div class="popup-form">
      <h2 class="popup-title">${title}</h2>
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

// Cerca i campi SOLO dentro il contenitore del popup corrente (mai document.getElementById):
// più popup possono transitare nel DOM in sequenza ravvicinata e gli id non sono univoci
// a livello di intero documento, quindi una ricerca globale rischia di pescare i campi
// di un popup precedente non ancora rimosso, mischiando le note tra un elemento e l'altro.
function panelField(id) {
  const container = panelState && panelState.popup && panelState.popup.getElement();
  return container ? container.querySelector("#" + id) : null;
}

function applyPanelMode() {
  const isNew = panelState.element.id === undefined;
  const editing = panelState.editing;

  const note = panelField("popup-note");
  const programmata = panelField("popup-programmata");
  const ultima = panelField("popup-ultima");
  const editBtn = panelField("popup-edit");
  const saveBtn = panelField("popup-save");
  const deleteBtn = panelField("popup-delete");
  if (!note) return;

  note.disabled = !editing;
  programmata.disabled = !editing;
  ultima.disabled = !editing;

  editBtn.hidden = !canEdit || editing;
  saveBtn.hidden = !editing;
  deleteBtn.hidden = !editing || isNew;
}

function wirePopupHandlers() {
  const note = panelField("popup-note");
  const programmata = panelField("popup-programmata");
  const ultima = panelField("popup-ultima");
  const error = panelField("popup-error");
  const editBtn = panelField("popup-edit");
  const saveBtn = panelField("popup-save");
  const deleteBtn = panelField("popup-delete");
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
      if (panelState.bulkEntries) {
        for (const entry of panelState.bulkEntries) {
          const created = await apiFetch("/api/points", {
            method: "POST",
            body: JSON.stringify({
              category,
              geom_type: entry.geomType,
              geom_coords: entry.coords,
              note: noteVal,
              data_programmata,
              data_ultima_esecuzione,
            }),
          });
          addElementToMap(created);
        }
      } else if (panelState.element.id === undefined) {
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
  const popup = L.popup({ closeButton: true, minWidth: 200, maxWidth: 240, autoPan: true })
    .setLatLng(latlng)
    .setContent(buildPopupHtml())
    .openOn(map);
  panelState.popup = popup;
  wirePopupHandlers();
}

// Apre un'unica card per più candidati OSM selezionati insieme: nota e date inserite
// una sola volta vengono applicate a tutti gli elementi al salvataggio.
function openBulkPanel(entries) {
  const bulkElement = {
    id: undefined,
    geom_type: entries[0].geomType,
    geom_coords: entries[0].coords,
    note: "",
    data_programmata: null,
    data_ultima_esecuzione: null,
  };
  panelState = { element: bulkElement, layer: null, editing: true, bulkEntries: entries };
  const popup = L.popup({ closeButton: true, minWidth: 200, maxWidth: 240, autoPan: true })
    .setLatLng(elementCenter(bulkElement))
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
    if (panelState.element.id === undefined && panelState.layer) {
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
const btnUndo = document.getElementById("btn-draw-undo");
const btnImportOsm = document.getElementById("btn-import-osm");

let drawing = null; // { geomType, vertices, markers, shapeLayer, group }

function setupDrawToolbar() {
  const allowed = CATEGORY_GEOM_TYPES[category];
  btnPoint.hidden = !allowed.includes("point");
  btnLine.hidden = !allowed.includes("line");
  btnPolygon.hidden = !allowed.includes("polygon");
  const osmCfg = OSM_IMPORT[category];
  btnImportOsm.hidden = !osmCfg;
  if (osmCfg) btnImportOsm.textContent = osmCfg.buttonLabel;
  toolbar.hidden = false;
}

btnImportOsm.addEventListener("click", importFromOsm);

function startDrawing(geomType) {
  clearOsmSelection();
  drawing = { geomType, vertices: [], markers: [], shapeLayer: null, group: L.layerGroup().addTo(map) };
  idleControls.hidden = true;
  activeControls.hidden = false;
  btnFinish.hidden = geomType === "point";
  btnUndo.hidden = geomType === "point";
  if (geomType === "point") {
    drawHint.textContent = "Clicca sulla mappa per posizionare il punto.";
  } else if (geomType === "line") {
    drawHint.textContent = "Clicca per aggiungere vertici (trascinabili), poi 'Fine' (almeno 2 punti).";
  } else {
    drawHint.textContent = "Clicca per aggiungere vertici (trascinabili), poi 'Fine' (almeno 3 punti).";
  }
}

function cancelDrawing() {
  if (drawing && drawing.group) {
    map.removeLayer(drawing.group);
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

function makeVertexMarker(coord) {
  const marker = L.marker(coord, {
    draggable: true,
    icon: L.divIcon({
      className: "",
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#ffffff;border:2px solid #1f5c32;box-shadow:0 0 2px rgba(0,0,0,0.5);"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    }),
  });
  marker.on("drag", () => {
    const ll = marker.getLatLng();
    drawing.vertices[drawing.markers.indexOf(marker)] = [ll.lat, ll.lng];
    redrawShape();
  });
  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    const idx = drawing.markers.indexOf(marker);
    if (idx === -1) return;
    drawing.vertices.splice(idx, 1);
    drawing.markers.splice(idx, 1);
    drawing.group.removeLayer(marker);
    redrawShape();
  });
  return marker;
}

function redrawShape() {
  if (drawing.shapeLayer) {
    drawing.group.removeLayer(drawing.shapeLayer);
    drawing.shapeLayer = null;
  }
  const style = { color: "#1f5c32", weight: 4, dashArray: "6 6" };
  if (drawing.geomType === "line" && drawing.vertices.length >= 2) {
    drawing.shapeLayer = L.polyline(drawing.vertices, style).addTo(drawing.group);
  } else if (drawing.geomType === "polygon" && drawing.vertices.length >= 2) {
    drawing.shapeLayer = L.polygon(drawing.vertices, { ...style, fillOpacity: 0.2 }).addTo(drawing.group);
  }
}

function addVertex(coord) {
  drawing.vertices.push(coord);
  const marker = makeVertexMarker(coord).addTo(drawing.group);
  drawing.markers.push(marker);
  redrawShape();
}

function undoLastVertex() {
  if (!drawing || drawing.vertices.length === 0) return;
  drawing.vertices.pop();
  const marker = drawing.markers.pop();
  if (marker) drawing.group.removeLayer(marker);
  redrawShape();
}

function openCreatePanel(geomType, coords, note) {
  const fakeElement = { id: undefined, geom_type: geomType, geom_coords: coords, note: note || "", data_programmata: null, data_ultima_esecuzione: null };
  const layer = buildLayer(fakeElement).addTo(map);
  openPanel(fakeElement, layer, elementCenter(fakeElement));
}

// ── Import da OpenStreetMap (Overpass API) ──
let osmCandidatesLayer = null;

// ID della relation OSM del comune di Castelfranco Veneto (stesso usato da CastelSafe/
// CastelfrancoStreets). L'area-id per Overpass è 3600000000 + id relation.
const CASTELFRANCO_RELATION_ID = 45549;
const CASTELFRANCO_AREA_ID = 3600000000 + CASTELFRANCO_RELATION_ID;
const CASTELFRANCO_AREA_SETUP = `area(${CASTELFRANCO_AREA_ID})->.cf;`;

// Configurazione dell'import per categoria: query Overpass e etichette risultanti.
// Tutte le query sono filtrate sull'area amministrativa del comune (non su un bbox
// rettangolare), cosi' non vengono proposti elementi fuori dal territorio comunale.
function buildAreaOrBboxQuery(clauses, useArea, bbox) {
  const filter = useArea ? "(area.cf)" : `(${bbox})`;
  const setup = useArea ? CASTELFRANCO_AREA_SETUP : "";
  const body = clauses.map((c) => c.replace("%F%", filter)).join("\n      ");
  return `[out:json][timeout:28];${setup}(
      ${body}
    );out geom;`;
}

const OSM_IMPORT = {
  potature: {
    buttonLabel: "Importa alberi/siepi da OSM",
    noneLabel: "Nessun albero/siepe OSM trovato qui",
    clauses: [
      'node["natural"="tree"]%F%;',
      'way["natural"="tree_row"]%F%;',
      'way["barrier"="hedge"]%F%;',
    ],
    tagLabel: (tags) => {
      if (tags.natural === "tree") return "Albero (OSM)";
      if (tags.natural === "tree_row") return "Filare di alberi (OSM)";
      if (tags.barrier === "hedge") return "Siepe (OSM)";
      return "Elemento OSM";
    },
  },
  asfaltature: {
    buttonLabel: "Importa strade da OSM",
    noneLabel: "Nessuna strada OSM trovata qui",
    wayGeom: "line",
    clauses: ['way["highway"]["highway"!="proposed"]["highway"!="construction"]%F%;'],
    tagLabel: (tags) => {
      const name = tags.name ? ` ${tags.name}` : "";
      return `Strada${name} (OSM)`;
    },
  },
  sfalci: {
    buttonLabel: "Importa prati/parchi da OSM",
    noneLabel: "Nessun prato/parco OSM trovato qui",
    wayGeom: "polygon",
    clauses: [
      'way["leisure"="park"]%F%;',
      'way["leisure"="garden"]%F%;',
      'way["landuse"="grass"]%F%;',
      'way["landuse"="meadow"]%F%;',
      'relation["leisure"="park"]%F%;',
      'relation["leisure"="garden"]%F%;',
      'relation["landuse"="grass"]%F%;',
      'relation["landuse"="meadow"]%F%;',
    ],
    tagLabel: (tags) => {
      const name = tags.name ? ` ${tags.name}` : "";
      if (tags.leisure === "park") return `Parco${name} (OSM)`;
      if (tags.leisure === "garden") return `Giardino${name} (OSM)`;
      if (tags.landuse === "meadow") return `Prato${name} (OSM)`;
      return `Area verde${name} (OSM)`;
    },
  },
};

function addAreaCandidate(id, coords, note) {
  const visible = L.polygon(coords, { color: "#8a5a2b", weight: 3, dashArray: "4 4", fillColor: "#8a5a2b", fillOpacity: 0.25 }).addTo(osmCandidatesLayer);
  const toggle = () => toggleAreaSelection(id, coords, note, visible);
  visible.on("click", toggle);
  visible.on("mouseover", () => { if (!osmSelections.has(id)) visible.setStyle({ weight: 5, color: "#c98a1f", fillColor: "#c98a1f", fillOpacity: 0.35 }); });
  visible.on("mouseout", () => { if (!osmSelections.has(id)) visible.setStyle({ weight: 3, color: "#8a5a2b", fillColor: "#8a5a2b", fillOpacity: 0.25 }); });
}

function osmCandidateStyleMarker() {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#8a5a2b;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function clearOsmCandidates() {
  clearOsmSelection();
  if (osmCandidatesLayer) {
    map.removeLayer(osmCandidatesLayer);
    osmCandidatesLayer = null;
  }
  const cfg = OSM_IMPORT[category];
  btnImportOsm.textContent = cfg.buttonLabel;
}

async function importFromOsm() {
  const cfg = OSM_IMPORT[category];
  if (!cfg) return;
  if (osmCandidatesLayer) {
    clearOsmCandidates();
    return;
  }
  btnImportOsm.disabled = true;
  btnImportOsm.textContent = "Ricerca su OSM in corso...";
  try {
    // Prima cerca sull'intera area comunale; se non trova nulla (es. area() non
    // disponibile su qualche mirror) riprova sul riquadro della vista corrente,
    // cosi' l'utente ottiene comunque un risultato utile.
    let data = await fetchOverpass(buildAreaOrBboxQuery(cfg.clauses, true));
    if (!data.elements || data.elements.length === 0) {
      const b = map.getBounds();
      const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
      data = await fetchOverpass(buildAreaOrBboxQuery(cfg.clauses, false, bbox));
    }

    osmCandidatesLayer = L.layerGroup().addTo(map);
    let count = 0;
    // Un elemento passa solo se almeno un suo punto ricade davvero dentro il confine
    // comunale (poligono reale, non il rettangolo di bbox usato come fallback sopra).
    const hasPointInside = (coords) => coords.some(([lat, lon]) => isInsideCastelfranco(lat, lon));
    data.elements.forEach((el) => {
      const note = cfg.tagLabel(el.tags || {});
      if (el.type === "node") {
        if (!isInsideCastelfranco(el.lat, el.lon)) return;
        const nodeId = el.id;
        const coord = [el.lat, el.lon];
        const marker = L.marker(coord, { icon: osmCandidateStyleMarker() });
        // Cerchio invisibile più largo attorno al punto, solo per facilitare il click.
        const hitArea = L.circleMarker(coord, { radius: 16, color: "#000", weight: 0, opacity: 0, fillOpacity: 0 });
        const toggle = () => togglePointSelection(nodeId, coord, note, marker);
        marker.on("click", toggle);
        hitArea.on("click", toggle);
        hitArea.on("mouseover", () => { if (!osmSelections.has(nodeId)) marker.setOpacity(0.6); });
        hitArea.on("mouseout", () => { if (!osmSelections.has(nodeId)) marker.setOpacity(1); });
        marker.addTo(osmCandidatesLayer);
        hitArea.addTo(osmCandidatesLayer);
        count++;
      } else if (el.type === "way" && el.geometry && el.geometry.length >= 2 && cfg.wayGeom === "polygon") {
        const wayId = el.id;
        const coords = el.geometry.map((p) => [p.lat, p.lon]);
        if (!hasPointInside(coords)) return;
        addAreaCandidate(wayId, coords, note);
        count++;
      } else if (el.type === "relation" && cfg.wayGeom === "polygon" && el.members) {
        // Molti parchi grandi sono mappati come relation multipoligono: prendiamo i
        // member "outer" (i contorni esterni) e li trattiamo come aree separate.
        el.members
          .filter((m) => m.type === "way" && m.role === "outer" && m.geometry && m.geometry.length >= 3)
          .forEach((m, i) => {
            const coords = m.geometry.map((p) => [p.lat, p.lon]);
            if (!hasPointInside(coords)) return;
            addAreaCandidate(`${el.id}/${i}`, coords, note);
            count++;
          });
      } else if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
        const wayId = el.id;
        const coords = el.geometry.map((p) => [p.lat, p.lon]);
        if (!hasPointInside(coords)) return;
        const visible = L.polyline(coords, { color: "#8a5a2b", weight: 4, dashArray: "4 4" }).addTo(osmCandidatesLayer);
        // Linea invisibile più larga solo per facilitare il click, senza appesantire il disegno.
        const hitArea = L.polyline(coords, { color: "#000", weight: 20, opacity: 0 }).addTo(osmCandidatesLayer);
        const toggle = () => toggleOsmSelection(wayId, coords, note, visible);
        hitArea.on("click", toggle);
        visible.on("click", toggle);
        hitArea.on("mouseover", () => { if (!osmSelections.has(wayId)) visible.setStyle({ weight: 7, color: "#c98a1f" }); });
        hitArea.on("mouseout", () => { if (!osmSelections.has(wayId)) visible.setStyle({ weight: 4, color: "#8a5a2b" }); });
        count++;
      }
    });

    btnImportOsm.textContent = count > 0
      ? `${count} elementi OSM trovati (clicca per importare) — Nascondi`
      : `${cfg.noneLabel} — Nascondi`;
  } catch (err) {
    const msg = err && err.errors ? "nessun server OSM ha risposto in tempo" : err.message || err;
    alert("Errore durante la ricerca su OpenStreetMap: " + msg);
    btnImportOsm.textContent = cfg.buttonLabel;
  } finally {
    btnImportOsm.disabled = false;
  }
}

// ── Selezione di un tratto parziale di una strada OSM (trim handles, stile CastelSafe) ──
const osmSelectControls = document.getElementById("osm-select-controls");
const btnOsmImportSelection = document.getElementById("btn-osm-import-selection");
const btnOsmCancelSelection = document.getElementById("btn-osm-cancel-selection");
const osmSelections = new Map(); // wayId -> { coords, note, cum, total, startDist, endDist, startMarker, endMarker, draftLayer, sourceVisible }

function lineCumulativeMeters(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + map.distance(L.latLng(coords[i - 1]), L.latLng(coords[i])));
  }
  return cum;
}

function nearestPointOnLine(coords, latlng) {
  let best = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((latlng.lat - ax) * dx + (latlng.lng - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distSq = (latlng.lat - px) ** 2 + (latlng.lng - py) ** 2;
    if (!best || distSq < best.distSq) {
      best = { distSq, segIndex: i, segFraction: t, point: [px, py] };
    }
  }
  return best;
}

function distanceAlongLine(coords, cum, segIndex, segFraction) {
  const segLen = map.distance(L.latLng(coords[segIndex]), L.latLng(coords[segIndex + 1]));
  return cum[segIndex] + segFraction * segLen;
}

function pointAtDistance(coords, cum, dist) {
  for (let i = 0; i < cum.length - 1; i++) {
    if (dist >= cum[i] && dist <= cum[i + 1]) {
      const segLen = cum[i + 1] - cum[i];
      const t = segLen === 0 ? 0 : (dist - cum[i]) / segLen;
      const [ax, ay] = coords[i];
      const [bx, by] = coords[i + 1];
      return [ax + t * (bx - ax), ay + t * (by - ay)];
    }
  }
  return coords[coords.length - 1];
}

function trimLineCoords(coords, cum, startDist, endDist) {
  const result = [pointAtDistance(coords, cum, startDist)];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] > startDist && cum[i] < endDist) result.push(coords[i]);
  }
  result.push(pointAtDistance(coords, cum, endDist));
  return result;
}

function trimHandleIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#c98a1f;border:3px solid white;box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function redrawOsmDraft(s) {
  const trimmed = trimLineCoords(s.coords, s.cum, s.startDist, s.endDist);
  if (s.draftLayer) osmCandidatesLayer.removeLayer(s.draftLayer);
  s.draftLayer = L.polyline(trimmed, { color: "#c98a1f", weight: 6 }).addTo(osmCandidatesLayer);
}

function updateOsmSelectControls() {
  const n = osmSelections.size;
  osmSelectControls.hidden = n === 0;
  idleControls.hidden = n > 0;
  btnOsmImportSelection.textContent = n > 1 ? `Chiudi selezione (${n} elementi)` : "Chiudi selezione";
}

function selectedPointIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#c98a1f;border:3px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function togglePointSelection(nodeId, coord, note, marker) {
  if (osmSelections.has(nodeId)) {
    deselectOsmEntry(nodeId);
    return;
  }
  marker.setIcon(selectedPointIcon());
  osmSelections.set(nodeId, { type: "point", coord, note, marker });
  updateOsmSelectControls();
}

function toggleAreaSelection(wayId, coords, note, visible) {
  if (osmSelections.has(wayId)) {
    deselectOsmEntry(wayId);
    return;
  }
  visible.setStyle({ weight: 5, color: "#c98a1f", fillColor: "#c98a1f", fillOpacity: 0.4 });
  osmSelections.set(wayId, { type: "area", coords, note, visible });
  updateOsmSelectControls();
}

function toggleOsmSelection(wayId, coords, note, sourceVisible) {
  if (osmSelections.has(wayId)) {
    deselectOsmEntry(wayId);
    return;
  }

  const cum = lineCumulativeMeters(coords);
  const total = cum[cum.length - 1];

  const s = { type: "line", coords, note, cum, total, startDist: 0, endDist: total, sourceVisible };
  osmSelections.set(wayId, s);

  const makeHandle = (which) => {
    const dist = which === "start" ? s.startDist : s.endDist;
    const marker = L.marker(pointAtDistance(coords, cum, dist), { icon: trimHandleIcon(), draggable: true });
    const MIN_GAP_M = 2;
    marker.on("drag", (e) => {
      const nearest = nearestPointOnLine(coords, e.target.getLatLng());
      if (!nearest) return;
      let dist2 = distanceAlongLine(coords, cum, nearest.segIndex, nearest.segFraction);
      dist2 = Math.max(0, Math.min(total, dist2));
      if (which === "start") {
        s.startDist = Math.min(dist2, s.endDist - MIN_GAP_M);
      } else {
        s.endDist = Math.max(dist2, s.startDist + MIN_GAP_M);
      }
      e.target.setLatLng(pointAtDistance(coords, cum, which === "start" ? s.startDist : s.endDist));
      redrawOsmDraft(s);
    });
    marker.addTo(osmCandidatesLayer);
    return marker;
  };

  s.startMarker = makeHandle("start");
  s.endMarker = makeHandle("end");
  redrawOsmDraft(s);

  updateOsmSelectControls();
}

function deselectOsmEntry(id) {
  const s = osmSelections.get(id);
  if (!s) return;
  if (s.type === "point") {
    s.marker.setIcon(osmCandidateStyleMarker());
  } else if (s.type === "area") {
    s.visible.setStyle({ weight: 3, color: "#8a5a2b", fillColor: "#8a5a2b", fillOpacity: 0.25 });
  } else {
    if (s.startMarker) osmCandidatesLayer.removeLayer(s.startMarker);
    if (s.endMarker) osmCandidatesLayer.removeLayer(s.endMarker);
    if (s.draftLayer) osmCandidatesLayer.removeLayer(s.draftLayer);
    s.sourceVisible.setStyle({ weight: 4, color: "#8a5a2b" });
  }
  osmSelections.delete(id);
  updateOsmSelectControls();
}

function clearOsmSelection() {
  Array.from(osmSelections.keys()).forEach(deselectOsmEntry);
}

btnOsmCancelSelection.addEventListener("click", clearOsmSelection);
btnOsmImportSelection.addEventListener("click", () => {
  const entries = Array.from(osmSelections.values()).map((s) => {
    if (s.type === "point") return { geomType: "point", coords: s.coord, note: s.note };
    if (s.type === "area") return { geomType: "polygon", coords: s.coords, note: s.note };
    return { geomType: "line", coords: trimLineCoords(s.coords, s.cum, s.startDist, s.endDist), note: s.note };
  });
  if (entries.length === 0) return;
  clearOsmSelection();
  openBulkPanel(entries);
});

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
  map.removeLayer(drawing.group);
  drawing = null;
  idleControls.hidden = false;
  activeControls.hidden = true;
  openCreatePanel(geomType, coords);
});

btnUndo.addEventListener("click", undoLastVertex);

map.on("click", (e) => {
  if (!canEdit || !drawing) return;
  const coord = [e.latlng.lat, e.latlng.lng];

  if (drawing.geomType === "point") {
    const geomType = "point";
    idleControls.hidden = false;
    activeControls.hidden = true;
    map.removeLayer(drawing.group);
    drawing = null;
    openCreatePanel(geomType, coord);
    return;
  }

  addVertex(coord);
});

requireAuth().then((me) => {
  if (!me) return;
  canEdit = me.role === "admin" || me.role === "editor";
  if (canEdit) setupDrawToolbar();
  loadElements();
});
