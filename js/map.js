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

// Confine comunale di Castelfranco Veneto (OSM relation 45549), semplificato a 195
// vertici — stessa costante usata in CastelfrancoStreets. È incorporato direttamente
// nel codice (non scaricato da Nominatim ad ogni caricamento pagina): un fetch
// runtime introduce un punto di fallimento in più senza alcun bisogno, dato che il
// confine amministrativo non cambia.
const CASTELFRANCO_BOUNDARY = [[45.66879,11.86777],[45.66731,11.86807],[45.66648,11.87335],[45.66632,11.88088],[45.66283,11.88174],[45.66290,11.88312],[45.65884,11.88454],[45.65885,11.88731],[45.65639,11.88740],[45.65451,11.88943],[45.65425,11.88590],[45.64953,11.88688],[45.64826,11.88754],[45.64726,11.88896],[45.64522,11.89009],[45.63847,11.89155],[45.63369,11.89321],[45.63197,11.89517],[45.63028,11.89550],[45.62997,11.89421],[45.63258,11.89235],[45.63310,11.88949],[45.63237,11.88927],[45.63050,11.89040],[45.62993,11.89021],[45.62833,11.89242],[45.62774,11.89085],[45.62656,11.89194],[45.62585,11.88999],[45.61954,11.89441],[45.61306,11.89821],[45.61434,11.89961],[45.61685,11.90119],[45.61847,11.90126],[45.62414,11.90010],[45.62535,11.89935],[45.62641,11.89779],[45.62751,11.89768],[45.62837,11.90153],[45.62767,11.90174],[45.62722,11.90419],[45.62591,11.90603],[45.62613,11.90696],[45.62553,11.90793],[45.62501,11.90740],[45.62456,11.90771],[45.62308,11.91093],[45.62227,11.91074],[45.62081,11.91135],[45.61925,11.91320],[45.61867,11.91716],[45.61974,11.91689],[45.62182,11.91777],[45.62103,11.92252],[45.61889,11.92752],[45.62147,11.92712],[45.62224,11.92837],[45.62259,11.92604],[45.62546,11.92421],[45.62877,11.92616],[45.63052,11.92859],[45.63127,11.92895],[45.63249,11.92920],[45.63417,11.92846],[45.63602,11.92844],[45.63713,11.92751],[45.63885,11.92715],[45.64830,11.93232],[45.64804,11.93415],[45.64759,11.93424],[45.64736,11.93855],[45.64685,11.93901],[45.64771,11.94535],[45.65111,11.94244],[45.65107,11.94371],[45.65029,11.95069],[45.64768,11.95054],[45.64756,11.95362],[45.64685,11.95722],[45.64466,11.95666],[45.64445,11.96199],[45.64233,11.96208],[45.64198,11.96481],[45.64106,11.96535],[45.64111,11.96620],[45.64052,11.96628],[45.64055,11.96881],[45.64240,11.96624],[45.64690,11.96505],[45.64702,11.96552],[45.64817,11.96554],[45.64819,11.96638],[45.64963,11.96642],[45.65017,11.96637],[45.65042,11.96542],[45.65099,11.96546],[45.65138,11.96822],[45.65315,11.96724],[45.65312,11.96664],[45.65473,11.96638],[45.65442,11.96883],[45.65448,11.96924],[45.65500,11.96916],[45.65539,11.97188],[45.65682,11.97204],[45.65830,11.97152],[45.65908,11.97508],[45.66150,11.97457],[45.66183,11.97371],[45.66391,11.97328],[45.66424,11.97620],[45.66298,11.97647],[45.66303,11.97832],[45.66126,11.97877],[45.66126,11.97937],[45.66005,11.97966],[45.66055,11.98316],[45.66074,11.98373],[45.66116,11.98367],[45.66166,11.98635],[45.66232,11.98722],[45.66445,11.99708],[45.67009,11.99641],[45.68567,11.99175],[45.68706,11.99310],[45.68804,11.99284],[45.68870,11.99406],[45.68967,11.99381],[45.68988,11.99414],[45.69428,11.99294],[45.69559,11.98774],[45.69998,11.97791],[45.70060,11.97200],[45.70185,11.96605],[45.70464,11.96100],[45.70563,11.95794],[45.70786,11.95362],[45.70730,11.95270],[45.70617,11.94342],[45.70400,11.94397],[45.70389,11.94283],[45.70253,11.94322],[45.70229,11.94211],[45.69830,11.94318],[45.69773,11.94220],[45.69735,11.94231],[45.69664,11.93913],[45.69501,11.93976],[45.69437,11.93685],[45.69350,11.93714],[45.69327,11.93582],[45.68939,11.93677],[45.68824,11.92899],[45.69061,11.92813],[45.69084,11.92756],[45.69462,11.92757],[45.69541,11.92451],[45.69709,11.92441],[45.69709,11.92155],[45.69893,11.92150],[45.69799,11.90990],[45.69879,11.90850],[45.69840,11.90671],[45.69657,11.90684],[45.69641,11.90605],[45.69513,11.90660],[45.69523,11.90728],[45.69266,11.90793],[45.69198,11.90885],[45.69014,11.90947],[45.69028,11.91116],[45.68912,11.91245],[45.68877,11.90975],[45.68698,11.91054],[45.68695,11.90941],[45.68646,11.90945],[45.68627,11.90881],[45.68625,11.90583],[45.68567,11.90596],[45.68539,11.90319],[45.68491,11.90329],[45.68492,11.90063],[45.68407,11.90070],[45.68351,11.89879],[45.68491,11.89472],[45.68313,11.89511],[45.68237,11.89060],[45.68040,11.89197],[45.67791,11.89281],[45.67696,11.88705],[45.67490,11.88646],[45.67367,11.88696],[45.67330,11.88453],[45.67187,11.88491],[45.66879,11.86777]];

function isInsideCastelfranco(lat, lon) {
  let inside = false;
  for (let i = 0, j = CASTELFRANCO_BOUNDARY.length - 1; i < CASTELFRANCO_BOUNDARY.length; j = i++) {
    const [yi, xi] = CASTELFRANCO_BOUNDARY[i];
    const [yj, xj] = CASTELFRANCO_BOUNDARY[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

L.polygon(CASTELFRANCO_BOUNDARY, {
  color: "#2e7d46",
  weight: 2,
  fillOpacity: 0,
  dashArray: "6 6",
  interactive: false,
}).addTo(map);

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
  let layer = buildLayer(element);
  if (element.geom_type === "line") {
    // Fascia invisibile larga sopra la linea: col dito su smartphone una linea sottile
    // è quasi impossibile da toccare con precisione.
    const hit = L.polyline(element.geom_coords, { weight: 28, opacity: 0, lineCap: "round" });
    layer = L.featureGroup([layer, hit]);
  }
  layer.addTo(map);
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
    // cosi' l'utente ottiene comunque un risultato utile. Il confine reale (costante
    // incorporata, nessun fetch di rete) filtra comunque entrambi i casi.
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
