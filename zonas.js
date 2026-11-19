"use strict";

const zonas = (() => {
  const primary =
    "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=GoogleMapsCompatible";
  const jobs = new Map();
  const messages = new Map();
  const maxTiles = 20000;
  const db = new Promise((resolve, reject) => {
    const r = indexedDB.open("turia-campo-zonas:" + new URL("./", document.baseURI).pathname, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("areas", { keyPath: "id" });
      r.result.createObjectStore("tiles", { keyPath: ["area", "key"] }).createIndex("key", "key");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.catch(() => {}); // El mapa en línea funciona también si IndexedDB está bloqueada.
  function urls(z, x, y) {
    return [
      primary + "&TILEMATRIX=" + z + "&TILEROW=" + y + "&TILECOL=" + x,
      "https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/" + z + "/" + x + "/" + (2 ** z - 1 - y) + ".jpeg",
    ];
  }
  function req(r) {
    return new Promise((ok, fail) => {
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  }
  function finished(tx) {
    return new Promise((ok, fail) => {
      tx.oncomplete = ok;
      tx.onabort = () => fail(tx.error || Error("Almacenamiento interrumpido"));
    });
  }
  async function list() {
    return req((await db).transaction("areas").objectStore("areas").getAll());
  }
  const keyOf = (z, x, y) => z + "/" + x + "/" + y;
  function ranges(bounds, max) {
    const [[south, west], [north, east]] = bounds,
      result = [];
    for (let z = 5; z <= max; z++) {
      const n = 2 ** z,
        cut = (v) => Math.max(0, Math.min(n - 1, v)),
        X = (l) => ((180 + l) * n) / 360,
        Y = (l) =>
          ((1 -
            Math.asinh(Math.tan((Math.max(-85.0511, Math.min(85.0511, l)) * Math.PI) / 180)) /
              Math.PI) *
            n) /
          2;
      result.push({
        z,
        x0: cut(Math.floor(X(west))),
        x1: cut(Math.ceil(X(east)) - 1),
        y0: cut(Math.floor(Y(north))),
        y1: cut(Math.ceil(Y(south)) - 1),
      });
    }
    return result;
  }
  function count(bounds, max) {
    return ranges(bounds, max).reduce((n, r) => n + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
  }
  async function create(name, bounds, max) {
    const total = count(bounds, max);
    if (total < 1 || total > maxTiles) throw Error("Acerca el mapa o reduce el nivel de detalle.");
    const a = { id: crypto.randomUUID(), name, bounds, max, total, done: 0, bytes: 0 };
    const tx = (await db).transaction("areas", "readwrite");
    tx.objectStore("areas").add(a);
    await finished(tx);
    return a;
  }
  function keysFor(id) {
    return IDBKeyRange.bound([id], [id, []]);
  }
  async function erase(id) {
    jobs.get(id)?.abort();
    const tx = (await db).transaction(["areas", "tiles"], "readwrite");
    tx.objectStore("tiles").delete(keysFor(id));
    tx.objectStore("areas").delete(id);
    await finished(tx);
    messages.delete(id);
  }
  async function download(z, x, y, signal) {
    for (const url of urls(z, x, y)) {
      if (signal.aborted) throw Error("Descarga en pausa");
      const c = new AbortController(),
        stop = () => c.abort(),
        timer = setTimeout(stop, 20000);
      signal.addEventListener("abort", stop, { once: true });
      try {
        const r = await fetch(url, { signal: c.signal, mode: "cors", credentials: "omit" });
        if (!r.ok) continue;
        const data = await r.arrayBuffer(),
          v = new Uint8Array(data);
        if (v.length > 4 && v[0] === 255 && v[1] === 216 && v.at(-2) === 255 && v.at(-1) === 217)
          return new Blob([data], { type: "image/jpeg" });
      } catch {
        /* Se intenta el segundo servidor del IGN. */
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
    }
    throw Error("No se ha recibido la ortofoto. Reanuda cuando haya conexión.");
  }
  async function storeTile(id, key, blob) {
    const tx = (await db).transaction(["areas", "tiles"], "readwrite");
    const areas = tx.objectStore("areas"),
      tiles = tx.objectStore("tiles");
    const a = areas.get(id);
    a.onsuccess = () => {
      if (!a.result) {
        tx.abort();
        return;
      }
      const old = tiles.getKey([id, key]);
      old.onsuccess = () => {
        if (old.result !== undefined) return;
        tiles.put({ area: id, key, blob });
        const record = a.result;
        record.done++;
        record.bytes += blob.size;
        areas.put(record);
      };
    };
    await finished(tx);
  }
  const event = () => window.dispatchEvent(new Event("zonaschange"));
  async function run(a) {
    if (jobs.has(a.id)) return;
    const controller = new AbortController(),
      signal = controller.signal;
    jobs.set(a.id, controller);
    messages.delete(a.id);
    event();
    try {
      const keys = await req(
        (await db).transaction("tiles").objectStore("tiles").getAllKeys(keysFor(a.id)),
      );
      const known = new Set(keys.map((k) => k[1])),
        pending = [];
      for (const r of ranges(a.bounds, a.max))
        for (let y = r.y0; y <= r.y1; y++)
          for (let x = r.x0; x <= r.x1; x++)
            if (!known.has(keyOf(r.z, x, y))) pending.push([r.z, x, y]);
      let next = 0;
      async function worker() {
        while (!signal.aborted && next < pending.length) {
          const coords = pending[next++];
          try {
            const blob = await download(...coords, signal);
            if (signal.aborted) return;
            await storeTile(a.id, keyOf(...coords), blob);
            event();
          } catch (e) {
            if (!signal.aborted) {
              messages.set(
                a.id,
                e.name === "QuotaExceededError" ? "Espacio insuficiente." : e.message,
              );
              controller.abort();
            }
          }
        }
      }
      await Promise.all([worker(), worker(), worker()]);
    } catch (e) {
      messages.set(a.id, e.message);
    } finally {
      jobs.delete(a.id);
      event();
    }
  }
  async function saved(z, x, y) {
    const database = await db;
    for (let level = z; level >= 5; level--) {
      const scale = 2 ** (z - level);
      const tile = await req(
        database
          .transaction("tiles")
          .objectStore("tiles")
          .index("key")
          .get(keyOf(level, Math.floor(x / scale), Math.floor(y / scale))),
      );
      if (tile) return { blob: tile.blob, scale, dx: x % scale, dy: y % scale };
    }
    return null;
  }
  function layer() {
    const retina = L.Browser.retina;
    const Grid = L.GridLayer.extend({
      createTile(c, done) {
        const box = document.createElement("div"),
          img = new Image();
        box.style.overflow = "hidden";
        img.alt = "";
        img.draggable = false;
        Object.assign(img.style, {
          width: "100%",
          height: "100%",
          maxWidth: "none",
          maxHeight: "none",
          transformOrigin: "0 0",
        });
        box.append(img);
        const z = c.z + (retina ? 1 : 0);
        function draw(src) {
          return new Promise((ok, fail) => {
            img.onload = ok;
            img.onerror = fail;
            img.src = src;
          });
        }
        async function load() {
          if (navigator.onLine)
            for (const url of urls(z, c.x, c.y)) {
              if (box.retired) return;
              try {
                await draw(url);
                return;
              } catch {
                /* Se recupera la zona local si falla el servicio. */
              }
            }
          const t = await saved(z, c.x, c.y);
          if (box.retired) return;
          if (!t) throw Error("Sin ortofoto guardada en esta zona");
          img.style.transform =
            "translate(" + -100 * t.dx + "%," + -100 * t.dy + "%) scale(" + t.scale + ")";
          const objectURL = URL.createObjectURL(t.blob);
          try {
            await draw(objectURL);
          } finally {
            URL.revokeObjectURL(objectURL);
          }
        }
        load().then(
          () => {
            if (!box.retired) done(null, box);
          },
          () => {
            if (!box.retired) done(Error("Ortofoto no disponible"), box);
          },
        );
        return box;
      },
    });
    return new Grid({
      attribution: "PNOA cedido por © IGN",
      tileSize: retina ? 128 : 256,
      maxNativeZoom: retina ? 19 : 20,
      maxZoom: 22,
      updateWhenIdle: true,
    }).on("tileunload", ({ tile }) => {
      tile.retired = true;
    });
  }
  return { maxTiles, layer, list, count, create, run, erase, jobs, messages };
})();
