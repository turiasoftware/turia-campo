"use strict";
const $ = (id) => document.getElementById(id);
const CRS = "EPSG:25830";
proj4.defs(CRS, "+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
const project = (lon, lat) => proj4("EPSG:4326", CRS, [lon, lat]);
const inverse = (x, y) => proj4(CRS, "EPSG:4326", [x, y]);
const fmt = (n, d = 1) =>
  n.toLocaleString("es-ES", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    useGrouping: false,
  });
const xyText = (p) => "X " + fmt(p.x, 2) + " m · Y " + fmt(p.y, 2) + " m";
const types = {
  ALC: ["Trampa / Alcantarilla", "#994721"],
  VAL: ["Válvula", "#206997"],
  ARQ: ["Arqueta", "#765198"],
  POZ: ["Pozo", "#336b54"],
  ACO: ["Acometida", "#885f17"],
  OTR: ["Otro", "#4e6268"],
};
for (const [prefix, [label]] of Object.entries(types))
  $("type").add(new Option(prefix === "ALC" ? "Alcantarilla" : label, prefix));
$("type").value = "ALC";

let db,
  points = [],
  activePanel = "",
  returnFocus,
  imageURL = "",
  toastTimer,
  saving = false,
  draft = null,
  exporting = false;
let live = null,
  averaged = null,
  averaging = null,
  precisionRequested = false,
  gpsWatch = null,
  gpsMessage = "",
  follow = false,
  compass = null;
let guide = null,
  guideLine = null,
  liveMarker = null,
  selectedLayer = "pnoa",
  lastMapStatus = "";
let geometry = null,
  vertices = [],
  mode = "",
  exportURL = "",
  exportName = "";
let deletionRevision = 0;
const geoLayers = new Map();
const map = L.map("map", {
  zoomControl: false,
  minZoom: 5,
  maxZoom: 22,
  attributionControl: true,
}).setView(perales.center, 17);
map.attributionControl.setPrefix(false);
$("map").after(document.querySelector(".crosshair"));
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4600);
}
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function append(...nodes) {
  $("content").append(...nodes);
}
function action(label, fn, cls = "") {
  const b = el("button", label, cls);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function link(label, href) {
  const a = el("a", label, "action");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function revokeImage() {
  if (imageURL) URL.revokeObjectURL(imageURL);
  imageURL = "";
}
function panel(key, title) {
  if (!activePanel) returnFocus = document.activeElement;
  revokeImage();
  activePanel = key;
  $("sheetTitle").textContent = title;
  $("content").replaceChildren();
  $("shade").hidden = $("sheet").hidden = false;
  $("sheet").scrollTop = 0;
  for (const n of document.querySelectorAll("header,main,.dock,#measureBar")) n.inert = true;
  $("close").focus({ preventScroll: true });
}
function closeSheet(force = false) {
  if (saving && !force) return;
  if (draft?.file && !force && !confirm("¿Descartar esta captura y su foto?")) return;
  if (draft && !force) releaseReservation(draft);
  draft = null;
  revokeImage();
  activePanel = "";
  $("shade").hidden = $("sheet").hidden = true;
  for (const n of document.querySelectorAll("header,main,.dock,#measureBar")) n.inert = false;
  $("content").replaceChildren();
  returnFocus?.focus?.({ preventScroll: true });
}
$("close").onclick = () => closeSheet();
$("shade").onclick = () => closeSheet();
document.addEventListener("keydown", (e) => {
  if (!activePanel) return;
  if (e.key === "Escape") closeSheet();
  if (e.key === "Tab") {
    const f = [
      ...$("sheet").querySelectorAll(
        "button:not(:disabled),a[href],input:not(:disabled),select,textarea",
      ),
    ];
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
      e.preventDefault();
      f[0].focus();
    }
  }
});
let swipeY = null;
document.querySelector(".sheethead").addEventListener(
  "touchstart",
  (e) => {
    swipeY = e.touches[0].clientY;
  },
  { passive: true },
);
document.querySelector(".sheethead").addEventListener(
  "touchend",
  (e) => {
    if (swipeY != null && e.changedTouches[0].clientY - swipeY > 70) closeSheet();
    swipeY = null;
  },
  { passive: true },
);

const ign = "https://www.ign.es/wmts/";
const wmts = (service, layer) =>
  ign +
  service +
  "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" +
  layer +
  "&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
const baseNames = { pnoa: "Ortofoto PNOA", base: "Mapa Base IGN" };
const baseLayers = {
  pnoa: zonas.layer(),
  base: L.tileLayer(wmts("ign-base", "IGNBaseTodo"), {
    attribution: "© Instituto Geográfico Nacional",
    maxNativeZoom: 19,
    maxZoom: 22,
  }),
};
const municipality = L.geoJSON(perales.boundary, {
  style: { color: "#ffd062", weight: 3, dashArray: "7 5", fill: false },
  interactive: false,
  attribution: "Límite municipal © IGN",
});
const CAT = "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx";
const SIG = "https://wms.mapa.gob.es/sigpac/wms",
  HUB = "https://sigpac-hubcloud.es/wms";
const REC = "AU.Sigpac:recinto";
const wmsOptions = {
  format: "image/png",
  transparent: true,
  version: "1.1.1",
  minZoom: 15,
  maxZoom: 22,
  updateWhenIdle: true,
};
const overlays = {
  cat: L.tileLayer.wms(CAT, {
    ...wmsOptions,
    layers: "Catastro",
    opacity: 0.3,
    attribution: "Dirección General del Catastro",
  }),
  sig: L.tileLayer.wms(SIG, {
    ...wmsOptions,
    version: "1.3.0",
    layers: REC,
    opacity: 0.8,
    attribution: "FEGA · SIGPAC (CC BY 4.0)",
  }),
};
const requested = { cat: false, sig: false };
let opacity = 30,
  sigEndpoint = SIG;
function mapStatus(message = "") {
  lastMapStatus = message;
  const offline = !navigator.onLine;
  $("mapStatus").textContent =
    message ||
    (offline
      ? selectedLayer === "pnoa"
        ? "Sin conexión · zonas guardadas"
        : "Mapa Base IGN requiere conexión"
      : "");
  $("mapStatus").hidden = !$("mapStatus").textContent;
}
for (const [id, layer] of Object.entries(baseLayers)) {
  let fallback = false;
  layer
    .on("tileerror", () => {
      if (!map.hasLayer(layer)) return;
      if (id === "base" && !fallback && navigator.onLine) {
        fallback = true;
        layer.setUrl("https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{-y}.jpeg");
      } else
        mapStatus(
          !navigator.onLine && id === "pnoa"
            ? "Sin ortofoto guardada para esta zona"
            : "Fondo sin cargar · comprueba la conexión",
        );
    })
    .on("tileload", () => {
      if (map.hasLayer(layer) && /^(Fondo|Sin ortofoto)/.test(lastMapStatus)) mapStatus();
    });
}
overlays.sig.on("tileerror", () => {
  if (!map.hasLayer(overlays.sig)) return;
  if (navigator.onLine && sigEndpoint === SIG) {
    sigEndpoint = HUB;
    overlays.sig.setUrl(HUB);
  } else mapStatus("SIGPAC sin respuesta");
});
overlays.cat.on("tileerror", () => {
  if (map.hasLayer(overlays.cat)) mapStatus("Catastro sin respuesta");
});
for (const [id, label] of [
  ["sig", "SIGPAC"],
  ["cat", "Catastro"],
])
  overlays[id].on("tileload", () => {
    if (lastMapStatus.startsWith(label)) mapStatus();
  });
baseLayers.pnoa.addTo(map);
function syncLayers() {
  const allowed = map.getZoom() >= 15;
  for (const [id, layer] of Object.entries(overlays)) {
    if (allowed && requested[id]) {
      if (!map.hasLayer(layer)) layer.addTo(map);
      layer.bringToFront();
    } else if (map.hasLayer(layer)) map.removeLayer(layer);
  }
  if (activePanel === "layers") showLayers();
}
map.on("zoomend", syncLayers);
function controlRow(label, input) {
  const row = el("label", null, "setting");
  row.append(el("span", label), input);
  return row;
}
function showLayers() {
  panel("layers", "Capas del mapa");
  append(el("div", "Mapa de fondo", "kicker"));
  for (const [key, name] of Object.entries(baseNames)) {
    const radio = el("input");
    radio.type = "radio";
    radio.name = "base";
    radio.checked = key === selectedLayer;
    radio.onchange = () => {
      map.removeLayer(baseLayers[selectedLayer]);
      selectedLayer = key;
      baseLayers[key].addTo(map).bringToBack();
      $("baseName").textContent = name;
      mapStatus();
      syncLayers();
    };
    append(controlRow(name, radio));
  }
  append(
    action("Volver a Perales del Alfambra", () => {
      closeSheet(true);
      follow = false;
      map.setView(perales.center, 17);
    }),
  );
  const limitToggle = el("input");
  limitToggle.type = "checkbox";
  limitToggle.checked = map.hasLayer(municipality);
  limitToggle.onchange = () => {
    if (limitToggle.checked) municipality.addTo(map);
    else municipality.remove();
  };
  append(controlRow("Límite municipal de Perales", limitToggle));
  append(
    action("Ver término municipal completo", () => {
      closeSheet(true);
      follow = false;
      municipality.addTo(map);
      map.fitBounds(perales.bounds, { padding: [15, 15] });
    }),
  );
  if (selectedLayer === "pnoa")
    append(
      action("Ver a máxima resolución", () => {
        closeSheet(true);
        map.setZoom(baseLayers.pnoa.options.maxNativeZoom);
      }),
    );
  addZoneButton();
  const z = map.getZoom();
  append(el("div", "Superposiciones · zoom " + z, "kicker"));
  for (const [key, label] of [
    ["cat", "Catastro"],
    ["sig", "Recintos SIGPAC"],
  ]) {
    const cb = el("input");
    cb.type = "checkbox";
    cb.id = "toggle-" + key;
    cb.checked = requested[key];
    cb.disabled = z < 15;
    cb.onchange = () => {
      requested[key] = cb.checked;
      mapStatus();
      syncLayers();
    };
    append(controlRow(label, cb));
    if (key === "cat") {
      const r = el("input");
      r.type = "range";
      r.min = 0;
      r.max = 100;
      r.value = opacity;
      r.setAttribute("aria-label", "Opacidad de Catastro");
      const row = controlRow("Opacidad · " + opacity + " %", r);
      r.oninput = () => {
        opacity = Number(r.value);
        overlays.cat.setOpacity(opacity / 100);
        row.firstChild.textContent = "Opacidad · " + opacity + " %";
      };
      append(row);
    }
  }
  if (z < 15) append(action("Acercar a zoom 15 para activar capas", () => map.setZoom(15)));
}
$("layers").onclick = showLayers;
$("plus").onclick = () => map.zoomIn();
$("minus").onclick = () => map.zoomOut();
map.on("dragstart", () => {
  follow = false;
});
window.addEventListener("offline", () => mapStatus());
window.addEventListener("online", () => {
  mapStatus();
  baseLayers[selectedLayer].redraw();
  for (const layer of Object.values(overlays)) if (map.hasLayer(layer)) layer.redraw();
});
mapStatus();
function copyXY(p) {
  const value = p.x.toFixed(3) + ";" + p.y.toFixed(3);
  if (navigator.clipboard?.writeText)
    navigator.clipboard
      .writeText(value)
      .then(() => toast("Coordenadas copiadas"))
      .catch(() => prompt("Copia X;Y en ETRS89 / UTM 30N", value));
  else prompt("Copia X;Y en ETRS89 / UTM 30N", value);
}
function serviceLinks(p) {
  const cat = new URL(
    "https://ovc.catastro.meh.es/OVCServWeb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR",
  );
  cat.search = new URLSearchParams({
    SRS: CRS,
    Coordenada_X: p.x.toFixed(3),
    Coordenada_Y: p.y.toFixed(3),
  });
  const sig = new URL(HUB);
  sig.search = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    SRS: CRS,
    LAYERS: REC,
    QUERY_LAYERS: REC,
    STYLES: "",
    FORMAT: "image/png",
    INFO_FORMAT: "text/html",
    WIDTH: 101,
    HEIGHT: 101,
    X: 50,
    Y: 50,
    BBOX: [p.x - 50.5, p.y - 50.5, p.x + 50.5, p.y + 50.5].join(","),
  });
  return [
    link("Referencia catastral por coordenadas", cat.href),
    link("Recinto SIGPAC por coordenadas", sig.href),
    link("Abrir visor nacional SIGPAC", "https://sigpac.mapa.gob.es/fega/visor/"),
  ];
}
$("query").onclick = () => {
  const c = map.getCenter(),
    [x, y] = project(c.lng, c.lat);
  panel("query", "Consultar centro del mapa");
  append(
    el("p", xyText({ x, y }), "readout num"),
    el("small", "ETRS89 / UTM 30N · consulta en la sede oficial"),
    ...serviceLinks({ x, y }),
    action("Copiar X e Y", () => copyXY({ x, y })),
  );
};

let activeProject = "general";
let projects = new Map([["general", "General"]]);
let withPhoto = true;
let inventoryReady = false;
const projectOf = (point) => point.proyecto_id || "general";
const projectName = (id) => projects.get(id) || "General";
const activePoints = () => points.filter((point) => projectOf(point) === activeProject);
function openDB() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open("turia-campo-inventario", 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("points")) {
        d.createObjectStore("points", { keyPath: "codigo" });
        d.createObjectStore("photos");
        d.createObjectStore("series");
      }
      const projectStore = d.createObjectStore("projects", { keyPath: "id" });
      projectStore.createIndex("nombre", "key", { unique: true });
      projectStore.add({ id: "general", name: "General", key: "general" });
      d.createObjectStore("settings");
      const cursor = req.transaction.objectStore("points").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        row.update({
          ...row.value,
          uid: row.value.uid || crypto.randomUUID(),
          proyecto_id: "general",
        });
        row.continue();
      };
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => {
        d.close();
        db = null;
        toast("Vuelve a abrir la aplicación para seguir guardando");
      };
      ok(d);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => toast("Cierra otras pestañas de Turia Campo para abrir el inventario");
  });
}
function readStore(store, key) {
  return new Promise((ok, fail) => {
    const s = db.transaction(store).objectStore(store),
      r = key === undefined ? s.getAll() : s.get(key);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function loadProjects() {
  const rows = await readStore("projects");
  projects = new Map(rows.map((p) => [p.id, p.name]));
}
function writeLocal(store, value, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || Error("Escritura interrumpida"));
    tx.objectStore(store).put(value, key);
  });
}
function refreshCaptureBar() {
  $("projectName").textContent = projectName(activeProject);
  $("captureLabel").textContent = withPhoto ? "Fijar punto + foto" : "Fijar punto";
  $("captureIcon").setAttribute("href", withPhoto ? "#camera" : "#pin");
}
async function selectProject(id) {
  await writeLocal("settings", id, "activeProject");
  activeProject = id;
  if (guide) endGuide();
  for (const marker of geoLayers.values()) marker.remove();
  geoLayers.clear();
  activePoints().forEach(addMarker);
  updateCount();
  refreshCaptureBar();
  if (exportURL) URL.revokeObjectURL(exportURL);
  exportURL = "";
}
function showProjects() {
  if (!inventoryReady || saving) return;
  panel("projects", "Proyecto o recorrido");
  const list = el("select");
  list.setAttribute("aria-label", "Proyecto activo");
  for (const [id, name] of projects) list.add(new Option(name, id, false, id === activeProject));
  list.onchange = async () => {
    list.disabled = true;
    try {
      await selectProject(list.value);
      closeSheet(true);
    } catch {
      toast("No se ha podido cambiar el recorrido.");
      list.disabled = false;
    }
  };
  const name = el("input");
  name.maxLength = 80;
  name.placeholder = "Ej. Perales · Camino del molino";
  name.setAttribute("aria-label", "Nombre del proyecto o recorrido");
  const writeProject = async (rename) => {
    const value = name.value.trim();
    if (!value) {
      name.focus();
      toast("Escribe el nombre del recorrido.");
      return;
    }
    const id = rename ? activeProject : crypto.randomUUID();
    const rec = { id, name: value, key: value.toLocaleLowerCase("es").normalize("NFC") };
    try {
      await writeLocal("projects", rec);
      await loadProjects();
      await selectProject(id);
      changes?.postMessage({ projects: true });
      closeSheet(true);
      toast("Recorrido activo · " + value);
    } catch (error) {
      toast(
        error.name === "ConstraintError"
          ? "Ese nombre ya existe. Selecciona el recorrido en la lista."
          : "No se ha podido guardar el recorrido.",
      );
    }
  };
  append(
    controlRow("Proyecto activo", list),
    name,
    action("Crear y activar", () => writeProject(false), "primary"),
    action("Renombrar el activo", () => writeProject(true)),
  );
}
$("project").onclick = showProjects;
const dbReady = openDB()
  .then(async (d) => {
    db = d;
    points = await readStore("points");
    await loadProjects();
    const savedProject = await readStore("settings", "activeProject");
    if (projects.has(savedProject)) activeProject = savedProject;
    withPhoto = (await readStore("settings", "withPhoto")) !== false;
    inventoryReady = true;
    refreshCaptureBar();
    activePoints().forEach(addMarker);
    updateCount();
    if (activePanel === "inventory") showInventory();
    return true;
  })
  .catch(() => {
    db = null;
    toast("No se puede abrir IndexedDB. Revisa el espacio o los permisos del navegador.");
    return false;
  });
function addMarker(p) {
  if (projectOf(p) !== activeProject || geoLayers.has(p.codigo)) return;
  const icon = L.divIcon({
    className: "pmarker",
    html: '<span style="background:' + types[p.prefix][1] + '">' + p.prefix + "</span>",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
  const marker = L.marker([p.lat, p.lon], {
    icon,
    title: p.codigo,
    alt: p.codigo + " · " + p.tipo,
  }).addTo(map);
  marker.on("click", (e) => {
    if (mode) map.fire("click", { latlng: e.latlng });
    else showDetail(p);
  });
  geoLayers.set(p.codigo, marker);
}
function updateCount() {
  $("count").textContent = activePoints().length;
}
const MAX_AGE = 15000,
  AVERAGE_LIFE = 20000,
  MAX_SAMPLE_ERROR = 25;
const preciseCapture = { seconds: 30, minSamples: 6, minSpanSeconds: 20, maxError: 8 };
function fresh(p) {
  return p && p.time <= Date.now() + 1000 && Date.now() - p.time <= MAX_AGE;
}
function currentAverage() {
  return averaged &&
    Date.now() - averaged.time <= AVERAGE_LIFE &&
    fresh(live) &&
    (!precisionRequested || live.accuracy <= preciseCapture.maxError) &&
    Math.hypot(live.x - averaged.x, live.y - averaged.y) <=
      Math.max(5, averaged.accuracy, live.accuracy)
    ? averaged
    : null;
}
function showFix() {
  const p = currentAverage() || live;
  $("east").textContent = p ? fmt(p.x, 1) : "—";
  $("north").textContent = p ? fmt(p.y, 1) : "—";
  $("acc").textContent = p ? "±" + fmt(p.accuracy) + " m" : "—";
  const good = fresh(live);
  $("gps").classList.toggle("on", !!good);
  $("gps").lastElementChild.textContent = averaging
    ? "Media · " + Math.max(0, Math.ceil((averaging.end - Date.now()) / 1000)) + " s"
    : currentAverage()
      ? "GPS · media"
      : good
        ? "GPS activo"
        : gpsWatch != null
          ? gpsMessage || "Buscando GPS"
          : gpsMessage || "Activar GPS";
  document.querySelector(".meta b").textContent = currentAverage()
    ? "POSICIÓN PROMEDIADA"
    : live && !good
      ? "ÚLTIMA LECTURA GPS"
      : "POSICIÓN GPS";
  if (liveMarker) liveMarker.setStyle({ opacity: good ? 1 : 0.45, fillOpacity: good ? 1 : 0.45 });
  const quality = $("gpsQuality");
  quality.hidden = !(averaging || currentAverage() || precisionRequested);
  if (averaging) {
    const accepted = [...averaging.samples.values()];
    quality.textContent =
      accepted.length +
      " lecturas válidas · " +
      averaging.rejected.size +
      " descartadas" +
      (accepted.length > 1 ? " · dispersión " + fmt(weightedFix(accepted).spread) + " m" : "");
  } else if (currentAverage()) {
    quality.textContent =
      p.method + " · " + p.samples + " lecturas · dispersión " + fmt(p.spread) + " m";
  } else if (precisionRequested)
    quality.textContent = "Toma precisa pendiente · repítela o elige GPS directo en Herramientas.";
  updateGuide();
}
function receivePosition(pos) {
  const c = pos.coords,
    t = pos.timestamp;
  if (
    ![c.longitude, c.latitude, c.accuracy, t].every(Number.isFinite) ||
    c.accuracy <= 0 ||
    !fresh({ time: t }) ||
    (live && t < live.time)
  )
    return;
  const [x, y] = project(c.longitude, c.latitude);
  live = {
    lon: c.longitude,
    lat: c.latitude,
    x,
    y,
    accuracy: c.accuracy,
    time: t,
    method: "GPS",
    samples: 1,
  };
  gpsMessage = "";
  if (averaging && t >= averaging.start && t <= averaging.end) {
    if (c.accuracy <= averaging.limit) {
      averaging.samples.set(t, { ...live });
      averaging.rejected.delete(t);
    } else if (!averaging.samples.has(t)) averaging.rejected.add(t);
  }
  if (!liveMarker)
    liveMarker = L.circleMarker([live.lat, live.lon], {
      radius: 8,
      color: "white",
      weight: 3,
      fillColor: "#1766bf",
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);
  else liveMarker.setLatLng([live.lat, live.lon]);
  if (follow && !mode)
    map.setView([live.lat, live.lon], Math.max(17, map.getZoom()), { animate: false });
  if (averaged && !currentAverage()) averaged = null;
  showFix();
}
function startGPS() {
  if (!window.isSecureContext || !navigator.geolocation) {
    toast("El GPS requiere HTTPS y acceso a Localización.");
    return false;
  }
  if (gpsWatch != null) return true;
  gpsMessage = "";
  follow = true;
  gpsWatch = navigator.geolocation.watchPosition(
    receivePosition,
    (e) => {
      gpsMessage = e.code === 1 ? "GPS denegado" : "Sin señal GPS";
      if (e.code === 1) {
        navigator.geolocation.clearWatch(gpsWatch);
        gpsWatch = null;
        live = null;
        averaged = null;
        cancelAverage();
        if (liveMarker) {
          liveMarker.remove();
          liveMarker = null;
        }
      }
      showFix();
      toast(
        e.code === 1
          ? "Permite la ubicación a este sitio en Safari y activa el GPS de nuevo."
          : "Esperando una nueva lectura de ubicación.",
      );
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 18000 },
  );
  showFix();
  return true;
}
$("gps").onclick = () => {
  if (gpsWatch != null) showTools();
  else startGPS();
};
$("locate").onclick = () => {
  follow = true;
  if (startGPS() && fresh(live)) map.setView([live.lat, live.lon], Math.max(17, map.getZoom()));
  else toast("Esperando posición GPS");
};
// Algunos móviles entregan pocas actualizaciones de watchPosition en reposo.
let requestingFix = false;
function requestFreshFix() {
  if (
    requestingFix ||
    gpsWatch == null ||
    document.hidden ||
    !navigator.geolocation.getCurrentPosition
  )
    return;
  requestingFix = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      requestingFix = false;
      if (gpsWatch != null) receivePosition(pos);
    },
    () => {
      requestingFix = false;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 4000 },
  );
}
function cancelAverage() {
  if (averaging) {
    clearTimeout(averaging.timer);
    clearInterval(averaging.poll);
  }
  averaging = null;
}
function startAverage(seconds = 15) {
  if (!startGPS()) return;
  cancelAverage();
  averaged = null;
  const start = Date.now();
  precisionRequested = seconds === preciseCapture.seconds;
  averaging = {
    start,
    seconds,
    limit: precisionRequested ? preciseCapture.maxError : MAX_SAMPLE_ERROR,
    end: start + seconds * 1000,
    samples: new Map(),
    rejected: new Set(),
  };
  averaging.timer = setTimeout(finishAverage, seconds * 1000);
  averaging.poll = setInterval(requestFreshFix, 1000);
  requestFreshFix();
  closeSheet(true);
  toast("Mantén el iPhone quieto sobre el punto durante " + seconds + " s");
  showFix();
}
function median(values) {
  const a = [...values].sort((x, y) => x - y),
    i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
function weightedFix(samples) {
  let w = 0,
    sx = 0,
    sy = 0;
  for (const p of samples) {
    const weight = 1 / p.accuracy ** 2;
    w += weight;
    sx += weight * p.x;
    sy += weight * p.y;
  }
  const x = sx / w,
    y = sy / w;
  const spread = Math.sqrt(
    samples.reduce((sum, p) => sum + ((p.x - x) ** 2 + (p.y - y) ** 2) / p.accuracy ** 2, 0) / w,
  );
  // Las lecturas de un mismo móvil pueden compartir un sesgo. El radio
  // declarado no se reduce artificialmente por el número de observaciones.
  const reported = Math.sqrt(samples.length / w);
  return { x, y, spread, reported, accuracy: Math.hypot(spread, reported) };
}
function finishAverage() {
  if (!averaging) return;
  const session = averaging,
    strict = session.seconds === preciseCapture.seconds;
  let samples = [...session.samples.values()].sort((a, b) => a.time - b.time);
  cancelAverage();
  if (strict && samples.length) {
    const mx = median(samples.map((p) => p.x)),
      my = median(samples.map((p) => p.y));
    const d = samples.map((p) => Math.hypot(p.x - mx, p.y - my)),
      mid = median(d);
    const cutoff = Math.max(2.5, mid + 3 * 1.4826 * median(d.map((v) => Math.abs(v - mid))));
    samples = samples.filter((p, i) => d[i] <= cutoff);
  }
  if (
    samples.length < (strict ? preciseCapture.minSamples : 2) ||
    !fresh(samples.at(-1)) ||
    (strict && samples.at(-1).time - samples[0].time < preciseCapture.minSpanSeconds * 1000)
  ) {
    toast(
      strict
        ? `Toma insuficiente. Repite con el móvil quieto. Se necesitan ${preciseCapture.minSamples} lecturas de ±${preciseCapture.maxError} m o mejores a lo largo de ${preciseCapture.minSpanSeconds} s.`
        : "Media descartada. Se necesitan dos lecturas recientes de ±25 m o mejores.",
    );
    showFix();
    return;
  }
  const result = weightedFix(samples);
  if (strict) {
    const n = Math.max(2, Math.floor(samples.length / 3));
    const first = weightedFix(samples.slice(0, n)),
      last = weightedFix(samples.slice(-n));
    if (result.spread > 3 || Math.hypot(first.x - last.x, first.y - last.y) > 4) {
      toast("La posición ha variado durante la toma. Repite con el móvil quieto sobre el punto.");
      showFix();
      return;
    }
  }
  const [lon, lat] = inverse(result.x, result.y);
  averaged = {
    ...result,
    lon,
    lat,
    time: samples.at(-1).time,
    samples: samples.length,
    discarded: session.rejected.size + session.samples.size - samples.length,
    method: "Media " + session.seconds + " s",
  };
  if (currentAverage()) toast("Media de " + samples.length + " lecturas lista para fijar");
  else {
    averaged = null;
    toast("Media caducada o desplazamiento detectado. Repite la toma.");
  }
  showFix();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && averaging) {
    cancelAverage();
    toast("Promedio interrumpido al salir de la aplicación");
  }
  if (!document.hidden) showFix();
});
setInterval(() => {
  showFix();
  if (gpsWatch != null && live && Date.now() - live.time > 10000) requestFreshFix();
}, 1000);
function orientation(e) {
  if (
    Number.isFinite(e.webkitCompassHeading) &&
    e.webkitCompassHeading >= 0 &&
    e.webkitCompassAccuracy !== -1
  )
    compass = { value: e.webkitCompassHeading % 360, time: Date.now() };
}
window.addEventListener("deviceorientation", orientation, true);
async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent === "undefined") throw Error();
    if (
      typeof DeviceOrientationEvent.requestPermission === "function" &&
      (await DeviceOrientationEvent.requestPermission()) !== "granted"
    ) {
      toast("Permiso de brújula denegado");
      return;
    }
    toast("Brújula habilitada. Mueve el iPhone para obtener un rumbo.");
  } catch {
    toast("Este navegador no ofrece rumbo de brújula");
  }
}
function updateGuide() {
  if (!guide) return;
  const good = fresh(live);
  if (!good) {
    $("guideText").textContent = "Esperando posición GPS actual";
    if (guideLine) {
      guideLine.remove();
      guideLine = null;
    }
    return;
  }
  const dx = guide.x - live.x,
    dy = guide.y - live.y,
    d = Math.hypot(dx, dy),
    az = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  $("guideText").textContent =
    fmt(d) +
    " m · " +
    (d < 0.05 ? "en el punto" : fmt(az, 0) + "° desde norte UTM") +
    " · GPS ±" +
    fmt(live.accuracy) +
    " m";
  const ends = [
    [live.lat, live.lon],
    [guide.lat, guide.lon],
  ];
  if (guideLine) guideLine.setLatLngs(ends);
  else
    guideLine = L.polyline(ends, {
      color: "#0d514a",
      dashArray: "7 7",
      weight: 3,
      interactive: false,
    }).addTo(map);
}
function beginGuide(p) {
  guide = p;
  $("guideTitle").textContent = "Guía a " + p.codigo;
  $("guideBar").hidden = false;
  closeSheet(true);
  startGPS();
  updateGuide();
  requestAnimationFrame(() => map.invalidateSize());
}
function endGuide() {
  guide = null;
  if (guideLine) guideLine.remove();
  guideLine = null;
  $("guideBar").hidden = true;
  requestAnimationFrame(() => map.invalidateSize());
}
$("endGuide").onclick = endGuide;
function photoName(file, code) {
  const formats = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/tiff": "tif",
    "image/bmp": "bmp",
    "image/heic-sequence": "heics",
    "image/heif-sequence": "heifs",
  };
  const ext =
    formats[file.type.toLowerCase()] ||
    file.name.match(/\.([a-z\d]{1,7})$/i)?.[1].toLowerCase() ||
    "img";
  return code + "." + ext;
}
function previewPhoto(blob, label) {
  revokeImage();
  imageURL = URL.createObjectURL(blob);
  const pic = el("img");
  pic.className = "thumb";
  pic.alt = label;
  pic.src = imageURL;
  pic.onerror = () =>
    pic.replaceWith(
      el("small", "La foto original se conserva. Este navegador no puede mostrar su formato."),
    );
  return pic;
}
// Clasificación local por vecinos próximos. Cada ejemplo conserva el tipo
// confirmado por la persona que inventarió el punto.
const imageExamples = new Map();
async function describePhoto(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw Error("Imagen sin tamaño");
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      48,
      48,
    );
    const pixels = ctx.getImageData(0, 0, 48, 48).data;
    // Histogramas locales de color y orientación de bordes en nueve celdas.
    const cells = Array.from({ length: 9 }, () => new Float32Array(32));
    const luminance = (i) => pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    for (let y = 1; y < 47; y++)
      for (let x = 1; x < 47; x++) {
        const i = (y * 48 + x) * 4,
          cell = cells[Math.floor(y / 16) * 3 + Math.floor(x / 16)];
        for (let c = 0; c < 3; c++) cell[c * 8 + (pixels[i + c] >> 5)]++;
        const gx = luminance(i + 4) - luminance(i - 4),
          gy = luminance(i + 192) - luminance(i - 192);
        const angle = (Math.atan2(gy, gx) + Math.PI) % Math.PI;
        cell[24 + Math.floor((angle * 8) / Math.PI)] += Math.hypot(gx, gy) / 255;
      }
    return cells.flatMap((cell) => {
      const norm = Math.hypot(...cell) || 1;
      return Array.from(cell, (v) => v / norm);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function photoSuggestion(file) {
  const target = await describePhoto(file);
  const ranks = [];
  for (const prefix of Object.keys(types)) {
    const records = points
      .filter((p) => p.prefix === prefix && p.archivo_foto)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 6);
    const distances = [];
    for (const point of records) {
      try {
        let descriptor = imageExamples.get(point.codigo);
        if (!descriptor) {
          descriptor = await describePhoto(await readStore("photos", point.codigo));
          imageExamples.set(point.codigo, descriptor);
        }
        const cosine = target.reduce((total, v, i) => total + v * descriptor[i], 0) / 9;
        distances.push(Math.max(0, 1 - cosine));
      } catch {
        /* Una foto que el navegador no decodifica queda fuera de los ejemplos. */
      }
    }
    if (distances.length >= 2) {
      distances.sort((a, b) => a - b);
      ranks.push({ prefix, distance: (distances[0] + distances[1]) / 2 });
    }
  }
  if (ranks.length < 2)
    return {
      message:
        "Faltan ejemplos. Guarda al menos dos fotos de cada uno de dos tipos distintos en este dispositivo.",
    };
  ranks.sort((a, b) => a.distance - b.distance);
  if (ranks[0].distance > 0.3 || ranks[1].distance - ranks[0].distance < 0.045)
    return { message: "La foto no distingue un tipo con claridad. Selecciónalo tú." };
  return { prefix: ranks[0].prefix };
}
// Reservar en una transacción evita duplicados entre ventanas. La cámara
// se abre en el mismo gesto del usuario mientras IndexedDB asigna el número.
function reserveCode(prefix) {
  return new Promise((ok, fail) => {
    const tx = db.transaction("series", "readwrite"),
      store = tx.objectStore("series");
    let seq;
    tx.oncomplete = () => ok({ seq, codigo: prefix + "-" + String(seq).padStart(3, "0") });
    tx.onabort = () => fail(tx.error || Error("No se pudo reservar el código"));
    const r = store.get(prefix);
    r.onsuccess = () => {
      seq = (r.result || 0) + 1;
      store.put(seq, prefix);
    };
  });
}
async function releaseReservation(d) {
  try {
    const reserved = await d.reservation;
    if (!reserved || !db) return;
    const tx = db.transaction("series", "readwrite"),
      s = tx.objectStore("series"),
      r = s.get(d.prefix);
    r.onsuccess = () => {
      if (r.result === reserved.seq) s.put(reserved.seq - 1, d.prefix);
    };
  } catch {
    /* Una interrupción puede dejar un salto en la serie. */
  }
}
function startCapture() {
  if (saving) return;
  if (!inventoryReady || !db) {
    toast("El almacenamiento local aún no está disponible.");
    return;
  }
  if (averaging) {
    toast("Espera a que termine la toma de " + averaging.seconds + " s.");
    return;
  }
  if (precisionRequested && !currentAverage()) {
    toast("Repite la toma precisa o selecciona GPS directo en Herramientas.");
    return;
  }
  const position = currentAverage() || (fresh(live) ? live : null);
  if (!position) {
    startGPS();
    toast("Espera una lectura GPS actual y vuelve a pulsar Fijar punto.");
    return;
  }
  if (draft) releaseReservation(draft);
  const prefix = $("type").value;
  draft = {
    ...position,
    uid: crypto.randomUUID(),
    proyecto_id: activeProject,
    prefix,
    tipo: types[prefix][0],
    fecha: new Date().toISOString(),
    rumbo: compass && Date.now() - compass.time < 15000 ? compass.value : null,
  };
  draft.reservation = reserveCode(prefix).catch(() => null);
  if (!withPhoto) {
    savePoint({ currentTarget: $("capture") });
    return;
  }
  $("photo").value = "";
  $("photo").click();
}
$("capture").onclick = startCapture;
$("photo").addEventListener("cancel", () => {
  if (draft) releaseReservation(draft);
  draft = null;
});
$("photo").onchange = () => {
  const file = $("photo").files[0];
  if (!draft || !file) {
    if (draft) releaseReservation(draft);
    draft = null;
    return;
  }
  draft.file = file;
  panel("capture", "Guardar punto");
  const pending = draft;
  function refreshTitle() {
    const reservation = pending.reservation;
    reservation.then((r) => {
      if (
        r &&
        pending.reservation === reservation &&
        draft === pending &&
        activePanel === "capture"
      )
        $("sheetTitle").textContent = "Guardar " + r.codigo;
    });
  }
  refreshTitle();
  const category = el("select");
  for (const [key, [label]] of Object.entries(types))
    category.add(new Option(label, key, false, key === pending.prefix));
  function chooseType(prefix) {
    if (draft !== pending || saving || prefix === pending.prefix) return;
    releaseReservation({ ...pending });
    pending.prefix = prefix;
    pending.tipo = types[prefix][0];
    pending.reservation = reserveCode(prefix).catch(() => null);
    category.value = prefix;
    refreshTitle();
  }
  category.onchange = () => chooseType(category.value);
  const feedback = el("div");
  feedback.setAttribute("role", "status");
  const suggest = action("Sugerir tipo por foto", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    feedback.textContent = "Comparando con tus fotos clasificadas…";
    try {
      const result = await photoSuggestion(file);
      if (draft !== pending) return;
      feedback.replaceChildren();
      if (result.prefix) {
        feedback.append(
          el("small", "Sugerencia por parecido visual"),
          action("Usar " + types[result.prefix][0], () => {
            chooseType(result.prefix);
            feedback.textContent = "Tipo seleccionado · " + pending.tipo;
          }),
        );
      } else feedback.textContent = result.message;
    } catch {
      feedback.textContent = "Este navegador no ha podido analizar la foto. Puedes elegir el tipo.";
    } finally {
      button.disabled = false;
    }
  });
  const notes = el("textarea");
  notes.id = "notes";
  notes.maxLength = 8000;
  notes.placeholder = "Estado, material, diámetro…";
  const label = el("label", "Notas de campo");
  label.htmlFor = "notes";
  const row = el("div", null, "readout");
  row.append(
    controlRow("Tipo de punto", category),
    el("span", xyText(draft), "num"),
    el(
      "small",
      draft.method +
        " · ±" +
        fmt(draft.accuracy) +
        " m" +
        (draft.rumbo === null ? " · Sin brújula" : " · Brújula " + fmt(draft.rumbo, 0) + "°"),
    ),
  );
  append(
    previewPhoto(file, "Fotografía de la captura"),
    row,
    suggest,
    feedback,
    label,
    notes,
    action("Guardar punto y foto", savePoint, "primary"),
  );
};
async function commitPoint(snapshot, notes) {
  let reserved = await snapshot.reservation;
  if (!reserved) {
    snapshot.reservation = reserveCode(snapshot.prefix).catch(() => null);
    reserved = await snapshot.reservation;
  }
  if (!reserved) throw Error("No se pudo reservar el código");
  const { file, reservation, ...data } = snapshot,
    codigo = reserved.codigo;
  const point = {
    ...data,
    codigo,
    notas: notes,
    archivo_foto: file ? "FOTOS/" + photoName(file, codigo + "_" + data.uid) : "",
  };
  return new Promise((ok, fail) => {
    const tx = db.transaction(["points", "photos"], "readwrite");
    tx.oncomplete = () => ok(point);
    tx.onabort = () => fail(tx.error || Error("Transacción cancelada"));
    tx.objectStore("points").add(point);
    if (file) tx.objectStore("photos").add(file, codigo);
  });
}
const changes =
  typeof BroadcastChannel === "function" ? new BroadcastChannel("turia-campo-cambios") : null;
function reflectDeletion(code) {
  deletionRevision++;
  imageExamples.delete(code);
  points = points.filter((point) => point.codigo !== code);
  geoLayers.get(code)?.remove();
  geoLayers.delete(code);
  if (guide?.codigo === code) endGuide();
  updateCount();
  if (exportURL) URL.revokeObjectURL(exportURL);
  exportURL = "";
  if (
    activePanel === "inventory" ||
    activePanel === "export" ||
    (activePanel === "detail" && $("content").dataset.point === code)
  )
    showInventory();
  else if (activePanel === "tools") showTools();
}
async function deletePoint(point, button) {
  if (
    button.disabled ||
    !confirm(
      "¿Borrar " +
        point.codigo +
        " (" +
        point.tipo +
        (point.archivo_foto ? ") y su foto" : ")") +
        " de este dispositivo? Esta acción es definitiva.",
    )
  )
    return;
  button.disabled = true;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["points", "photos"], "readwrite");
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error("Transacción cancelada"));
      tx.objectStore("points").delete(point.codigo);
      tx.objectStore("photos").delete(point.codigo);
    });
  } catch {
    button.disabled = false;
    toast("No se ha podido borrar el punto. Vuelve a intentarlo.");
    return;
  }
  reflectDeletion(point.codigo);
  changes?.postMessage({ deleted: point.codigo });
  toast(point.codigo + " borrado");
}
if (changes)
  changes.onmessage = async ({ data }) => {
    if (!db) return;
    if (typeof data?.deleted === "string") {
      reflectDeletion(data.deleted);
      return;
    }
    if (data?.projects) {
      await loadProjects();
      refreshCaptureBar();
      if (activePanel === "projects") showProjects();
      return;
    }
    if (typeof data !== "string") return;
    try {
      const revision = deletionRevision;
      const point = await readStore("points", data);
      if (revision !== deletionRevision && !(await readStore("points", data))) return;
      if (point && !points.some((p) => p.codigo === data)) {
        points.push(point);
        addMarker(point);
        updateCount();
        if (activePanel === "inventory") showInventory();
      }
    } catch {
      toast("No se ha podido actualizar el listado");
    }
  };
async function savePoint(e) {
  if (saving || !draft) return;
  saving = true;
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const p = await commitPoint(draft, $("notes")?.value.trim() || "");
    if (!points.some((point) => point.codigo === p.codigo)) points.push(p);
    addMarker(p);
    updateCount();
    changes?.postMessage(p.codigo);
    closeSheet(true);
    precisionRequested = false;
    averaged = null;
    showFix();
    toast(
      p.codigo +
        (p.archivo_foto ? " guardado con su foto" : " guardado") +
        " · " +
        projectName(projectOf(p)),
    );
  } catch (err) {
    if (!draft?.file && draft) {
      await releaseReservation(draft);
      draft = null;
      toast("No se ha guardado el punto. Comprueba el espacio y vuelve a pulsar Fijar punto.");
      return;
    }
    toast(
      err.name === "QuotaExceededError"
        ? "Espacio insuficiente. Libera espacio y reintenta con esta captura."
        : "No se ha guardado. Conserva esta pantalla y vuelve a intentarlo.",
    );
  } finally {
    saving = false;
    b.disabled = false;
  }
}
async function showDetail(p) {
  panel("detail", p.codigo);
  const token = p.codigo;
  $("content").dataset.point = token;
  const place = el("div");
  const data = el("div", null, "readout");
  data.append(
    el("b", p.tipo),
    el("small", projectName(projectOf(p))),
    el("span", xyText(p), "num"),
    el("small", "ETRS89 / UTM 30N · ±" + fmt(p.accuracy) + " m"),
    el(
      "small",
      new Date(p.fecha).toLocaleString("es-ES") +
        " · " +
        p.method +
        (p.samples > 1 ? " (" + p.samples + " lecturas)" : ""),
    ),
    el(
      "small",
      p.rumbo === null
        ? "Rumbo de brújula sin lectura"
        : "Rumbo de brújula " + fmt(p.rumbo, 0) + "°",
    ),
  );
  if (Number.isFinite(p.spread))
    data.append(
      el(
        "small",
        "Dispersión " +
          fmt(p.spread) +
          " m · radio GPS típico ±" +
          fmt(p.reported) +
          " m · " +
          p.discarded +
          " descartadas",
      ),
    );
  append(place, data);
  if (p.notas) {
    const notes = el("p", p.notas);
    notes.style.whiteSpace = "pre-wrap";
    append(notes);
  }
  append(
    action("Guiar hasta aquí", () => beginGuide(p), "primary"),
    action("Copiar X e Y", () => copyXY(p)),
    action("Ver en el mapa", () => {
      closeSheet(true);
      follow = false;
      map.setView([p.lat, p.lon], 19);
    }),
    ...serviceLinks(p),
    action("Borrar punto", (e) => deletePoint(p, e.currentTarget), "delete-point"),
  );
  if (!p.archivo_foto) {
    place.textContent = "Punto sin foto";
    return;
  }
  try {
    const photo = await readStore("photos", p.codigo);
    if (activePanel === "detail" && $("content").dataset.point === token) {
      if (!photo) throw Error();
      place.append(previewPhoto(photo, "Foto de " + p.codigo));
    }
  } catch {
    if (place.isConnected) place.textContent = "No se ha podido leer la foto del inventario.";
  }
}
function showInventory() {
  panel("inventory", "Inventario · " + projectName(activeProject));
  const records = activePoints();
  append(
    el(
      "div",
      records.length + " " + (records.length === 1 ? "punto guardado" : "puntos guardados"),
      "kicker",
    ),
  );
  if (!records.length)
    append(el("p", "Elige un tipo y pulsa el botón de captura para iniciar el inventario."));
  else {
    append(action("Exportar ZIP · " + records.length + " puntos", exportZip, "primary"));
    const list = el("div", null, "pointlist");
    for (const p of records.sort((a, b) => b.fecha.localeCompare(a.fecha))) {
      const btn = action("", () => showDetail(p), "item"),
        badge = el("span", p.prefix, "badge");
      badge.style.background = types[p.prefix][1];
      const title = el("span", null, "itemtext");
      title.append(
        el("b", p.codigo),
        el("small", p.tipo + " · " + new Date(p.fecha).toLocaleDateString("es-ES")),
      );
      btn.append(badge, title);
      list.append(btn);
    }
    append(list);
  }
}
$("inventory").onclick = showInventory;
function addZoneButton() {
  append(action("Zonas sin conexión", showZones));
}
let zoneProgressTimer;
window.addEventListener("zonaschange", () => {
  if (activePanel !== "zones" || zoneProgressTimer) return;
  zoneProgressTimer = setTimeout(() => {
    zoneProgressTimer = null;
    if (activePanel === "zones") refreshZones();
  }, 250);
});
function showZones() {
  panel("zones", "Zonas sin conexión");
  append(
    el(
      "small",
      "Encuadra en el mapa el recorrido que quieras guardar. Se descargará la ortofoto PNOA del área visible.",
    ),
    action("Guardar esta zona sin conexión", planZone, "primary"),
  );
  const list = el("div", null, "pointlist");
  list.id = "savedAreas";
  append(list);
  refreshZones();
  const legacy =
    "turia-ortofoto:" +
    new URL("./perales/", document.baseURI).href +
    ":perales-municipio-20261119-r1";
  if (window.caches)
    caches
      .keys()
      .then((keys) => {
        if (keys.includes(legacy) && list.isConnected)
          append(
            action("Liberar la antigua precarga de Perales", async () => {
              if (confirm("¿Retirar la ortofoto antigua de 417 MB de este dispositivo?")) {
                await caches.delete(legacy);
                showZones();
              }
            }),
          );
      })
      .catch(() => {});
}
async function refreshZones() {
  const list = $("savedAreas");
  if (!list) return;
  try {
    const areas = await zonas.list();
    if (!list.isConnected) return;
    const fragment = document.createDocumentFragment();
    for (const a of areas) {
      const box = el("div", null, "readout"),
        ready = a.done === a.total,
        running = zonas.jobs.has(a.id);
      box.append(
        el("b", a.name),
        el(
          "small",
          (ready ? "Lista sin conexión" : running ? "Descargando" : "En pausa") +
            " · " +
            a.done +
            "/" +
            a.total +
            " teselas · " +
            fmt(a.bytes / 1e6, 1) +
            " MB",
        ),
      );
      if (zonas.messages.has(a.id)) box.append(el("small", zonas.messages.get(a.id)));
      if (!ready)
        box.append(
          action(running ? "Pausar" : "Reanudar", () =>
            running ? zonas.jobs.get(a.id)?.abort() : zonas.run(a),
          ),
        );
      box.append(
        action("Ver zona", () => {
          closeSheet(true);
          follow = false;
          if (selectedLayer !== "pnoa") {
            map.removeLayer(baseLayers[selectedLayer]);
            selectedLayer = "pnoa";
            baseLayers.pnoa.addTo(map).bringToBack();
            $("baseName").textContent = baseNames.pnoa;
          }
          map.fitBounds(a.bounds);
        }),
        action("Retirar zona", async () => {
          if (
            !confirm(
              "¿Retirar la ortofoto de «" + a.name + "»? Los puntos y sus fotos se conservan.",
            )
          )
            return;
          try {
            await zonas.erase(a.id);
            baseLayers.pnoa.redraw();
            refreshZones();
          } catch {
            toast("No se ha podido retirar la zona");
          }
        }),
      );
      fragment.append(box);
    }
    if (!areas.length) fragment.append(el("small", "Todavía no hay zonas guardadas."));
    list.replaceChildren(fragment);
  } catch {
    list.textContent = "No se ha podido abrir el almacenamiento de zonas.";
  }
}
function planZone() {
  follow = false;
  const b = map.getBounds(),
    bounds = [
      [b.getSouth(), b.getWest()],
      [b.getNorth(), b.getEast()],
    ];
  panel("planZone", "Guardar zona visible");
  const name = el("input");
  name.value = "Salida " + new Date().toLocaleDateString("es-ES");
  name.maxLength = 80;
  const level = el("select");
  for (const [n, title] of [
    [17, "General · nivel 17"],
    [18, "Caminos · nivel 18"],
    [19, "Detalle · nivel 19"],
    [20, "Máximo · nivel 20"],
  ])
    level.add(new Option(title, n));
  level.value = "19";
  const estimate = el("p", null, "readout");
  const v = [b.getSouthWest(), b.getSouthEast(), b.getNorthEast(), b.getNorthWest()].map((ll) => {
    const [x, y] = project(ll.lng, ll.lat);
    return { x, y };
  });
  const size = metrics(v, true).area / 1e6;
  const save = action(
    "Descargar ortofoto",
    async () => {
      save.disabled = true;
      try {
        const a = await zonas.create(
          name.value.trim() || "Zona de campo",
          bounds,
          Number(level.value),
        );
        showZones();
        zonas.run(a);
      } catch (e) {
        toast(e.message);
        update();
      }
    },
    "primary",
  );
  function update() {
    const n = zonas.count(bounds, Number(level.value));
    save.disabled = !navigator.onLine || n > zonas.maxTiles || !shellReady;
    estimate.textContent =
      fmt(size, 2) +
      " km² · " +
      n.toLocaleString("es-ES") +
      " teselas · unos " +
      fmt(n * 0.015, 1) +
      " MB. " +
      (!navigator.onLine
        ? "Conéctate para descargar."
        : !shellReady
          ? "Preparando el arranque sin conexión."
          : n > zonas.maxTiles
            ? "Acerca el mapa o reduce el detalle."
            : "El tamaño final depende de las imágenes.");
  }
  level.onchange = update;
  append(
    controlRow("Nombre", name),
    controlRow("Detalle", level),
    estimate,
    save,
    action("Ajustar encuadre en el mapa", () => closeSheet(true)),
  );
  update();
  if (!shellReady && navigator.serviceWorker)
    navigator.serviceWorker.ready.then(() => {
      if (save.isConnected) update();
    });
}
function showTools() {
  panel("tools", "Herramientas");
  const photoMode = el("input");
  photoMode.type = "checkbox";
  photoMode.checked = withPhoto;
  photoMode.disabled = !inventoryReady;
  photoMode.onchange = async () => {
    photoMode.disabled = true;
    try {
      await writeLocal("settings", photoMode.checked, "withPhoto");
      withPhoto = photoMode.checked;
      refreshCaptureBar();
    } catch {
      photoMode.checked = withPhoto;
      toast("No se ha podido guardar la preferencia.");
    }
    photoMode.disabled = false;
  };
  append(
    controlRow("Tomar foto al fijar punto", photoMode),
    action("Proyecto o recorrido · " + projectName(activeProject), showProjects),
  );
  append(
    el("div", "Posicionamiento", "kicker"),
    action(averaging ? "Cancelar promedio" : "Promediar posición (15 s)", () => {
      if (averaging) {
        cancelAverage();
        showFix();
        showTools();
      } else startAverage();
    }),
    el(
      "small",
      "Mantén el iPhone quieto. Se usan lecturas de ±25 m o mejores. La media queda disponible durante 20 s desde la última muestra.",
    ),
    action(`Toma precisa · ${preciseCapture.seconds} s`, () =>
      startAverage(preciseCapture.seconds),
    ),
    el(
      "small",
      `Mantén el móvil quieto sobre el punto. Hacen falta ${preciseCapture.minSamples} lecturas de ±${preciseCapture.maxError} m o mejores repartidas en al menos ${preciseCapture.minSpanSeconds} s.`,
    ),
    ...(precisionRequested
      ? [
          action("Usar GPS directo", () => {
            cancelAverage();
            averaged = null;
            precisionRequested = false;
            showFix();
            closeSheet(true);
          }),
        ]
      : []),
    action("Habilitar brújula del iPhone", enableCompass),
  );
  if (gpsWatch == null)
    append(
      action("Activar seguimiento GPS", () => {
        startGPS();
        closeSheet(true);
      }),
    );
  append(
    el("div", "Inventario local", "kicker"),
    action("Exportar ZIP", exportZip, "primary"),
    el(
      "small",
      "Incluye GeoJSON, CSV y fotos originales. Guarda una copia antes de borrar los datos del sitio.",
    ),
    el("div", "Uso sin cobertura", "kicker"),
  );
  addZoneButton();
  if (exportURL) append(downloadLink());
}
$("tools").onclick = showTools;
const headers = [
  "codigo",
  "tipo",
  "X_UTM30",
  "Y_UTM30",
  "precision_m",
  "rumbo",
  "fecha",
  "notas",
  "archivo_foto",
  "metodo",
  "n_lecturas",
  "fecha_gps",
  "dispersion_m",
  "radio_gps_m",
  "n_descartadas",
  "proyecto",
  "id_punto",
];
function attributes(p) {
  return {
    codigo: p.codigo,
    proyecto: projectName(projectOf(p)),
    id_punto: p.uid,
    tipo: p.tipo,
    X_UTM30: +p.x.toFixed(3),
    Y_UTM30: +p.y.toFixed(3),
    precision_m: +p.accuracy.toFixed(2),
    rumbo: p.rumbo,
    fecha: p.fecha,
    notas: p.notas,
    archivo_foto: p.archivo_foto,
    metodo: p.method,
    n_lecturas: p.samples,
    fecha_gps: new Date(p.time).toISOString(),
    dispersion_m: p.spread == null ? null : +p.spread.toFixed(2),
    radio_gps_m: +(p.reported ?? p.accuracy).toFixed(2),
    n_descartadas: p.discarded ?? null,
  };
}
function csvCell(value) {
  if (value == null) return "";
  if (typeof value === "number") return String(value).replace(".", ",");
  let s = String(value);
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadLink() {
  const a = el("a", "Descargar " + exportName, "action");
  a.href = exportURL;
  a.download = exportName;
  return a;
}
async function exportZip(e) {
  if (exporting) {
    toast("Exportación en curso");
    return;
  }
  if (!(await dbReady)) {
    toast("Almacenamiento local no disponible");
    return;
  }
  exporting = true;
  const revision = deletionRevision;
  const button = e?.target?.closest?.("button"),
    old = button?.textContent;
  try {
    const selected = activeProject;
    const label = projectName(selected);
    const records = (await readStore("points")).filter((p) => projectOf(p) === selected);
    if (!records.length) {
      toast("Todavía no hay puntos para exportar");
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "Preparando ZIP…";
    }
    const zip = new JSZip();
    zip.folder("FOTOS");
    const features = [],
      rows = [headers.join(";")];
    for (const p of records) {
      if (p.archivo_foto) {
        const photo = await readStore("photos", p.codigo);
        if (!photo) throw Error("Falta la foto de " + p.codigo);
        zip.file(p.archivo_foto, new Uint8Array(await photo.arrayBuffer()), {
          compression: "STORE",
        });
      }
      const props = attributes(p);
      features.push({
        type: "Feature",
        id: p.uid,
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: props,
      });
      rows.push(headers.map((k) => csvCell(props[k])).join(";"));
    }
    zip.file(
      "puntos_utm30.geojson",
      JSON.stringify({ type: "FeatureCollection", features }, null, 2),
    );
    zip.file("puntos_utm30.csv", "\uFEFF" + rows.join("\r\n") + "\r\n");
    const blob = await zip.generateAsync(
      { type: "blob", compression: "STORE", streamFiles: true },
      (m) => {
        if (button) button.textContent = "Preparando ZIP · " + Math.round(m.percent) + " %";
      },
    );
    if (selected !== activeProject || revision !== deletionRevision)
      throw Error("El inventario ha cambiado. Vuelve a exportar.");
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(blob);
    exportName =
      "Turia_Campo_" +
      label.replace(/[^\p{L}\p{N}_-]+/gu, "_") +
      "_" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".zip";
    if (draft || !["inventory", "tools", "export"].includes(activePanel)) {
      toast("ZIP preparado. Disponible en Herramientas.");
      return;
    }
    panel("export", "Inventario exportado");
    append(
      el(
        "p",
        label +
          " · " +
          records.length +
          " puntos · " +
          records.filter((p) => p.archivo_foto).length +
          " fotos · " +
          fmt(blob.size / 1048576, 2) +
          " MB",
      ),
      el(
        "small",
        "Si Safari no abre la descarga automáticamente, pulsa el enlace y guarda el archivo en Archivos.",
      ),
    );
    const download = downloadLink();
    append(download);
    download.click();
  } catch (err) {
    toast("Exportación interrumpida. " + (err.message || "Comprueba el espacio disponible."));
  } finally {
    exporting = false;
    if (button) {
      button.disabled = false;
      button.textContent = old;
    }
  }
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const box = (p, q, r) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  const [u, v, w, z] = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)];
  return (
    (Math.sign(u) * Math.sign(v) < 0 && Math.sign(w) * Math.sign(z) < 0) ||
    (!u && box(a, b, c)) ||
    (!v && box(a, b, d)) ||
    (!w && box(c, d, a)) ||
    (!z && box(c, d, b))
  );
}
function metrics(v, polygon) {
  let length = 0,
    area2 = 0,
    cross = false;
  const parts = [],
    closed = polygon && v.length >= 3;
  const edges = closed ? v.length : Math.max(0, v.length - 1);
  for (let i = 0; i < edges; i++) {
    const a = v[i],
      b = v[(i + 1) % v.length],
      s = distance(a, b);
    parts.push(s);
    length += s;
    if (closed) {
      const origin = v[0];
      area2 += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
      for (let j = 0; j < i - 1; j++) {
        if (j === 0 && i === edges - 1) continue;
        if (segmentsCross(a, b, v[j], v[j + 1])) cross = true;
      }
    }
  }
  return { length, parts, closed, cross, area: Math.abs(area2) / 2 };
}
function refreshGeometry() {
  geometry.clearLayers();
  const polygon = mode === "area",
    ll = vertices.map((v) => [v.lat, v.lon]),
    m = metrics(vertices, polygon);
  if (ll.length >= 2) {
    (m.closed
      ? L.polygon(ll, { color: "#ea781c", fillOpacity: 0.17 })
      : L.polyline(ll, { color: "#ea781c" })
    ).addTo(geometry);
  }
  for (const item of ll)
    L.circleMarker(item, {
      radius: 5,
      color: "#133a32",
      weight: 2,
      fillColor: "#edffbf",
      fillOpacity: 1,
      interactive: false,
    }).addTo(geometry);
  $("measureTitle").textContent = polygon ? "Medir superficie" : "Medir distancia";
  $("measureText").textContent = ll.length
    ? (m.closed ? "Perímetro " : "Total ") +
      fmt(m.length) +
      " m" +
      (m.closed
        ? m.cross
          ? " · Bordes cruzados"
          : " · " + fmt(m.area) + " m² · " + fmt(m.area / 10000, 4) + " ha"
        : m.parts.length
          ? " · Último tramo " + fmt(m.parts.at(-1)) + " m"
          : " · Añade otro vértice")
    : "Toca el mapa para marcar el primer vértice";
  $("undo").disabled = !ll.length;
}
function startMeasure(kind) {
  closeSheet(true);
  mode = kind;
  follow = false;
  vertices = [];
  geometry = L.layerGroup().addTo(map);
  document.body.classList.add("measuring");
  $("measureBar").hidden = false;
  map.doubleClickZoom.disable();
  map.invalidateSize();
  refreshGeometry();
}
$("measure").onclick = () => {
  panel("measure", "Medición en campo");
  append(
    el("p", "Marca los vértices sobre el mapa. Las medidas son planas en ETRS89 / UTM 30N."),
    action("Medir distancia", () => startMeasure("line")),
    action("Medir superficie", () => startMeasure("area")),
  );
};
map.on("click", (e) => {
  if (!mode) return;
  const { lng: lon, lat } = e.latlng,
    [x, y] = project(lon, lat);
  if (vertices.length && distance(vertices.at(-1), { x, y }) < 0.02) return;
  vertices.push({ lon, lat, x, y });
  refreshGeometry();
});
$("undo").onclick = () => {
  vertices.pop();
  refreshGeometry();
};
$("measureInfo").onclick = () => {
  const m = metrics(vertices, mode === "area");
  panel("metrics", "Detalle de la medición");
  append(
    el("div", vertices.length + " vértices · ETRS89 / UTM 30N", "kicker"),
    el("b", (m.closed ? "Perímetro " : "Longitud ") + fmt(m.length, 2) + " m"),
  );
  if (m.closed)
    append(
      el(
        "p",
        m.cross
          ? "Los bordes se cruzan. Deshaz los vértices afectados para obtener la superficie."
          : fmt(m.area, 2) + " m² · " + fmt(m.area / 10000, 4) + " ha",
      ),
    );
  for (const [i, d] of m.parts.entries())
    append(
      el(
        "p",
        "V" + (i + 1) + " → V" + (((i + 1) % vertices.length) + 1) + " · " + fmt(d, 2) + " m",
        "readout",
      ),
    );
  append(action("Continuar en el mapa", () => closeSheet(true)));
};
$("finishMeasure").onclick = () => {
  mode = "";
  vertices = [];
  geometry.remove();
  geometry = null;
  map.doubleClickZoom.enable();
  document.body.classList.remove("measuring");
  $("measureBar").hidden = true;
  map.invalidateSize();
};
let shellReady = false;
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker
    .register("./sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      shellReady = true;
      if (activePanel === "tools") showTools();
    })
    .catch(() => toast("No se ha preparado el arranque sin conexión"));
}
if (typeof ResizeObserver !== "undefined")
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($("map"));
