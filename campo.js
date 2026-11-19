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
const geoLayers = new Map();
const map = L.map("map", {
  zoomControl: false,
  minZoom: 5,
  maxZoom: 22,
  attributionControl: true,
}).setView([40.345, -1.107], 17);
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
  pnoa: L.tileLayer(wmts("pnoa-ma", "OI.OrthoimageCoverage"), {
    attribution: "PNOA cedido por © IGN",
    maxNativeZoom: 19,
    maxZoom: 22,
  }),
  base: L.tileLayer(wmts("ign-base", "IGNBaseTodo"), {
    attribution: "© Instituto Geográfico Nacional",
    maxNativeZoom: 19,
    maxZoom: 22,
  }),
};
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
  $("mapStatus").textContent = navigator.onLine ? message : "Sin conexión · cartografía en línea";
  $("mapStatus").hidden = !$("mapStatus").textContent;
}
for (const [id, layer] of Object.entries(baseLayers)) {
  let fallback = false;
  layer
    .on("tileerror", () => {
      if (!map.hasLayer(layer)) return;
      if (!fallback && navigator.onLine) {
        fallback = true;
        const name = id === "pnoa" ? "pnoa-ma" : "IGNBaseTodo",
          host = id === "pnoa" ? "pnoa-ma" : "ign-base";
        layer.setUrl("https://tms-" + host + ".idee.es/1.0.0/" + name + "/{z}/{x}/{-y}.jpeg");
      } else mapStatus("Fondo sin cargar · comprueba la conexión");
    })
    .on("tileload", () => {
      if (map.hasLayer(layer) && lastMapStatus.startsWith("Fondo")) mapStatus();
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

function openDB() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open("turia-campo-inventario", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("points", { keyPath: "codigo" });
      d.createObjectStore("photos");
      d.createObjectStore("series");
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
const dbReady = openDB()
  .then(async (d) => {
    db = d;
    points = await readStore("points");
    points.forEach(addMarker);
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
  if (geoLayers.has(p.codigo)) return;
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
  $("count").textContent = points.length;
}
const MAX_AGE = 15000,
  AVERAGE_LIFE = 20000,
  MAX_SAMPLE_ERROR = 25;
function fresh(p) {
  return p && Date.now() - p.time <= MAX_AGE;
}
function currentAverage() {
  return averaged &&
    Date.now() - averaged.time <= AVERAGE_LIFE &&
    fresh(live) &&
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
  if (averaging && t >= averaging.start && t <= averaging.end && c.accuracy <= MAX_SAMPLE_ERROR)
    averaging.samples.set(t, { ...live });
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
function startAverage() {
  if (!startGPS()) return;
  cancelAverage();
  averaged = null;
  const start = Date.now();
  averaging = { start, end: start + 15000, samples: new Map() };
  averaging.timer = setTimeout(finishAverage, 15000);
  averaging.poll = setInterval(requestFreshFix, 1000);
  requestFreshFix();
  closeSheet(true);
  toast("Permanece quieto durante 15 segundos");
  showFix();
}
function finishAverage() {
  if (!averaging) return;
  const samples = [...averaging.samples.values()];
  cancelAverage();
  if (samples.length < 2 || !fresh(samples.at(-1))) {
    toast("Media descartada. Se necesitan dos lecturas distintas de ±25 m o mejores.");
    showFix();
    return;
  }
  let w = 0,
    sx = 0,
    sy = 0;
  for (const p of samples) {
    const weight = 1 / p.accuracy ** 2;
    w += weight;
    sx += p.x * weight;
    sy += p.y * weight;
  }
  const x = sx / w,
    y = sy / w,
    [lon, lat] = inverse(x, y);
  // Radio orientativo conservador: combina la precisión declarada con la dispersión.
  const variance =
    samples.reduce(
      (v, p) => v + (p.accuracy ** 2 + (p.x - x) ** 2 + (p.y - y) ** 2) / p.accuracy ** 2,
      0,
    ) / w;
  averaged = {
    lon,
    lat,
    x,
    y,
    accuracy: Math.sqrt(variance),
    time: samples.at(-1).time,
    samples: samples.length,
    method: "Media 15 s",
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
$("endGuide").onclick = () => {
  guide = null;
  if (guideLine) guideLine.remove();
  guideLine = null;
  $("guideBar").hidden = true;
  requestAnimationFrame(() => map.invalidateSize());
};
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
  if (!db) {
    toast("El almacenamiento local aún no está disponible.");
    return;
  }
  if (averaging) {
    toast("Espera a que termine el promedio de 15 segundos.");
    return;
  }
  const position = currentAverage() || (fresh(live) ? live : null);
  if (!position) {
    startGPS();
    toast("Espera una lectura GPS actual y vuelve a pulsar Fijar punto + foto.");
    return;
  }
  if (draft) releaseReservation(draft);
  const prefix = $("type").value;
  draft = {
    ...position,
    prefix,
    tipo: types[prefix][0],
    fecha: new Date().toISOString(),
    rumbo: compass && Date.now() - compass.time < 15000 ? compass.value : null,
  };
  draft.reservation = reserveCode(prefix).catch(() => null);
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
  pending.reservation.then((r) => {
    if (r && draft === pending && activePanel === "capture")
      $("sheetTitle").textContent = "Guardar " + r.codigo;
  });
  const notes = el("textarea");
  notes.id = "notes";
  notes.maxLength = 8000;
  notes.placeholder = "Estado, material, diámetro…";
  const label = el("label", "Notas de campo");
  label.htmlFor = "notes";
  const row = el("div", null, "readout");
  row.append(
    el("b", draft.tipo),
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
  const point = { ...data, codigo, notas: notes, archivo_foto: "FOTOS/" + photoName(file, codigo) };
  return new Promise((ok, fail) => {
    const tx = db.transaction(["points", "photos"], "readwrite");
    tx.oncomplete = () => ok(point);
    tx.onabort = () => fail(tx.error || Error("Transacción cancelada"));
    tx.objectStore("points").add(point);
    tx.objectStore("photos").add(file, codigo);
  });
}
const changes =
  typeof BroadcastChannel === "function" ? new BroadcastChannel("turia-campo-cambios") : null;
if (changes)
  changes.onmessage = async () => {
    if (!db) return;
    try {
      points = await readStore("points");
      points.forEach(addMarker);
      updateCount();
      if (activePanel === "inventory") showInventory();
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
    const p = await commitPoint(draft, $("notes").value.trim());
    points.push(p);
    addMarker(p);
    updateCount();
    changes?.postMessage(p.codigo);
    closeSheet(true);
    toast(p.codigo + " guardado con su foto");
  } catch (err) {
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
  );
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
  panel("inventory", "Inventario");
  append(
    el(
      "div",
      points.length + " " + (points.length === 1 ? "punto guardado" : "puntos guardados"),
      "kicker",
    ),
  );
  if (!points.length)
    append(el("p", "Elige un tipo y pulsa «Fijar punto + foto» para iniciar el inventario."));
  else {
    append(action("Exportar ZIP · " + points.length + " puntos", exportZip, "primary"));
    const list = el("div", null, "pointlist");
    for (const p of [...points].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
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
function showTools() {
  panel("tools", "Herramientas");
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
    el(
      "small",
      shellReady
        ? "Aplicación disponible sin conexión. Los fondos y las consultas oficiales requieren red."
        : "Abre con conexión para preparar el uso sin cobertura. Los mapas oficiales se cargan en línea.",
    ),
  );
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
];
function attributes(p) {
  return {
    codigo: p.codigo,
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
  const button = e?.target?.closest?.("button"),
    old = button?.textContent;
  try {
    const records = await readStore("points");
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
      const photo = await readStore("photos", p.codigo);
      if (!photo) throw Error("Falta la foto de " + p.codigo);
      zip.file(p.archivo_foto, new Uint8Array(await photo.arrayBuffer()), { compression: "STORE" });
      const props = attributes(p);
      features.push({
        type: "Feature",
        id: p.codigo,
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
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(blob);
    exportName = "Turia_Campo_" + new Date().toISOString().replace(/[:.]/g, "-") + ".zip";
    if (draft || !["inventory", "tools", "export"].includes(activePanel)) {
      toast("ZIP preparado. Disponible en Herramientas.");
      return;
    }
    panel("export", "Inventario exportado");
    append(
      el("p", records.length + " puntos con foto · " + fmt(blob.size / 1048576, 2) + " MB"),
      el(
        "small",
        "Si Safari no abre la descarga automáticamente, pulsa el enlace y guarda el archivo en Archivos.",
      ),
    );
    const download = downloadLink();
    append(download);
    download.click();
  } catch (err) {
    toast(
      "Exportación interrumpida. " +
        (err.message || "Comprueba el espacio disponible.") +
        " Los puntos siguen guardados.",
    );
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
