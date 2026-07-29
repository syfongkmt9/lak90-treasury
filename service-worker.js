/**
 * Service Worker - ລະບົບບັນຊີຄັງເງິນໂຮງຮຽນ ມຕ ຫຼັກ90
 * Production Ready: Offline Cache + Runtime Cache + Auto Update + Cache Cleanup
 * ໃຊ້ນຳສະເພາະໂໝດ Firebase Hosting (ບໍ່ໃຊ້ໄດ້ຖ້າໜ້າເວັບຖືກເປີດຢູ່ໃນ Apps Script sandboxed iframe)
 *
 * ຍຸດທະສາດ Cache:
 *  - App Shell (HTML/CSS/JS ພາຍໃນ/Icons)  -> Cache First (ໂຫຼດໄວ ແລະ ໃຊ້ໄດ້ offline ເຕັມທີ່)
 *  - Runtime assets (Vue/Tailwind/FontAwesome/SheetJS ຈາກ CDN) -> Stale-While-Revalidate
 *    (ໃຊ້ cache ທັນທີໃຫ້ໄວ ພ້ອມອັບເດດ cache ຢູ່ຫຼັງບ້ານຈາກເນັດ ຖ້າມີ)
 *  - ການເອີ້ນ API ຫາ Google Apps Script (fetch APPS_SCRIPT_API_URL)
 *    -> Network First (ຕ້ອງໄດ້ຂໍ້ມູນລ່າສຸດສະເໝີ, ຖ້າບໍ່ມີເນັດຄ່ອຍແຈ້ງເຕືອນແທນ)
 *
 * Auto Update: ຕົວແປ SW_VERSION ຂ້າງລຸ່ມ - ປ່ຽນເລກນີ້ທຸກຄັ້ງທີ່ Deploy ເວີຊັນໃໝ່
 * ເພື່ອບັງຄັບໃຫ້ browser ດາວໂຫຼດ Service Worker ໃໝ່ ແລະ ລ້າງ cache ເກົ່າອັດຕະໂນມັດ (Cache Cleanup)
 */

const SW_VERSION = "v5";
const SHELL_CACHE = `lak90-treasury-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `lak90-treasury-runtime-${SW_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

// ໄຟລ໌ຫຼັກຂອງແອັບ (ຕ້ອງມີເພື່ອໃຫ້ເປີດແອັບໄດ້ offline)
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Third-party CDN assets ທີ່ index.html ໂຫຼດ - cache ໄວ້ລ່ວງໜ້າໃຫ້ໃຊ້ offline ໄດ້ນຳ
const RUNTIME_PRECACHE = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://unpkg.com/vue@3/dist/vue.global.js"
];

// ---------- INSTALL: ເກັບ App Shell + Runtime assets ລົງ Cache ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(APP_SHELL).catch((err) => {
        console.warn("Service Worker: ບາງໄຟລ໌ App Shell cache ບໍ່ໄດ້ (ບໍ່ເປັນຫຍັງ, ຈະຂ້າມໄປ)", err);
      });

      const runtimeCache = await caches.open(RUNTIME_CACHE);
      await Promise.all(
        RUNTIME_PRECACHE.map((url) =>
          fetch(url, { mode: "cors" })
            .then((res) => {
              if (res && (res.ok || res.type === "opaque")) return runtimeCache.put(url, res);
            })
            .catch(() => {
              /* ບໍ່ມີເນັດຕອນຕິດຕັ້ງ - ຈະລອງ cache ອີກຄັ້ງຕອນຜູ້ໃຊ້ອອນລາຍ */
            })
        )
      );
    })()
  );
  self.skipWaiting();
});

// ---------- ACTIVATE: Cache Cleanup - ລົບ cache ເວີຊັນເກົ່າທັງໝົດ ----------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("lak90-treasury-") && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// ---------- FETCH ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // ບໍ່ cache POST/PUT (ການບັນທຶກຂໍ້ມູນ)

  const url = new URL(req.url);

  // 0) ໜ້າ HTML ຫຼັກ -> Network First ສະເໝີ (ເຫັນການແກ້ໄຂໃໝ່ທັນທີ ບໍ່ຕ້ອງລ້າງ cache)
  if (req.mode === "navigate") {
    event.respondWith(networkFirstShell(req));
    return;
  }

  // 1) Google Apps Script API -> Network First (ຕ້ອງການຂໍ້ມູນສົດສະເໝີ)
  const isApiCall =
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("script.googleusercontent.com");
  if (isApiCall) {
    event.respondWith(networkFirstApi(req));
    return;
  }

  // 2) Third-party CDN runtime assets -> Stale-While-Revalidate
  const isRuntimeAsset =
    url.origin !== self.location.origin || RUNTIME_PRECACHE.some((u) => req.url.indexOf(u) === 0);
  if (isRuntimeAsset) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // 3) App Shell / ໄຟລ໌ຂອງເວັບເອງ -> Cache First (ອັບເດດ cache ຢູ່ຫຼັງບ້ານ)
  event.respondWith(cacheFirstShell(req));
});

// Network First: ໃຊ້ສຳລັບ API - ຕ້ອງພະຍາຍາມຫາເນັດກ່ອນສະເໝີ, ຄ່ອຍ fallback ຂໍ້ຄວາມ error ຖ້າບໍ່ມີເນັດ
async function networkFirstApi(req) {
  try {
    return await fetch(req);
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: "ບໍ່ມີການເຊື່ອມຕໍ່ອິນເຕີເນັດ - ກະລຸນາລອງໃໝ່ອີກຄັ້ງ" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}

// Network First: ໃຊ້ສຳລັບໜ້າ HTML ຫຼັກ - ຫາເນັດກ່ອນສະເໝີ ເພື່ອໃຫ້ເຫັນການແກ້ໄຂໃໝ່ທັນທີ,
// fallback ໄປຫາ cache ຖ້າບໍ່ມີເນັດ
async function networkFirstShell(req) {
  try {
    const response = await fetch(req);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(req);
    return cached || caches.match("./index.html");
  }
}

// Cache First: ໃຊ້ສຳລັບ App Shell - ຕອບຈາກ cache ທັນທີ (ໄວ ແລະ ໃຊ້ໄດ້ offline),
// ພ້ອມກັນນັ້ນຍິງ request ຫາເນັດຢູ່ຫຼັງບ້ານເພື່ອອັບເດດ cache ໃຫ້ທັນສະໄໝ (stale-while-revalidate ແບບງ່າຍ)
async function cacheFirstShell(req) {
  const cached = await caches.match(req);
  const networkFetch = fetch(req)
    .then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone));
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkFetch;
}

// Stale-While-Revalidate: ໃຊ້ສຳລັບ CDN assets - ຕອບຈາກ cache ທັນທີຖ້າມີ, ອັບເດດ cache ຢູ່ຫຼັງບ້ານ
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkFetch = fetch(req)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(req, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkFetch;
}

// ---------- ຮັບຂໍ້ຄວາມຈາກໜ້າເວັບ (ເຊັ່ນ: ສັ່ງ skipWaiting ຕອນມີເວີຊັນໃໝ່ - Auto Update) ----------
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
