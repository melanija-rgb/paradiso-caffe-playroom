/* Shared data store: reservations via Netlify API, gallery in localStorage */
window.ParadisoStore = (() => {
  const KEYS = {
    gallery: "paradiso_gallery",
    session: "paradiso_admin_session_v3",
    adminToken: "paradiso_admin_token_v3",
  };

  const API_RESERVATIONS = "/api/reservations";
  const API_ADMIN_LOGIN = "/api/admin-login";

  const DEFAULT_GALLERY = [
    { id: "ig-01", section: "igraonica", src: "images/galerija/igraonica/01-igraonica.png", alt: "Igraonica Paradiso — sto za stoni fudbal i prostor za igru" },
    { id: "ig-05", section: "igraonica", src: "images/galerija/igraonica/05-igraonica.png", alt: "Igraonica Paradiso — kućica, tobogan i bazen s lopticama" },
    { id: "ig-07", section: "igraonica", src: "images/galerija/igraonica/07-igraonica.png", alt: "Igraonica Paradiso — igračke i avanture" },
    { id: "dek-08", section: "dekoracije", src: "images/galerija/igraonica/08-dekoracije.png", alt: "Naše rođendanske dekoracije u igraonici Paradiso" },
    { id: "dek-09", section: "dekoracije", src: "images/galerija/igraonica/09-dekoracije.png", alt: "Roza rođendanska dekoracija s balonom broj 9" },
    { id: "dek-10", section: "dekoracije", src: "images/galerija/igraonica/10-dekoracije.png", alt: "Rođendanski sto dekorisan po želji slavljenika" },
    { id: "dek-11", section: "dekoracije", src: "images/galerija/igraonica/11-dekoracije.png", alt: "Vesela rođendanska dekoracija u igraonici Paradiso" },
    { id: "ka-02", section: "kafic", src: "images/galerija/kafic/02-kafic.png", alt: "Ulaz u Paradiso Caffe & Playroom" },
    { id: "ka-09", section: "kafic", src: "images/galerija/kafic/09-kafic.png", alt: "Ambijent i detalji Paradiso kafića" },
    { id: "ka-13", section: "kafic", src: "images/galerija/kafic/13-kafic.png", alt: "Svečani ambijent Paradiso kafića sa dugim stolom" },
    { id: "ka-14", section: "kafic", src: "images/galerija/kafic/14-kafic.png", alt: "Dugački sto spreman za proslavu u Paradiso kafiću" },
    { id: "ka-04", section: "kafic", src: "images/galerija/kafic/04-kafic.png", alt: "Desert u Paradiso kafiću" },
    { id: "pi-01", section: "pica", src: "images/galerija/kafic/01-kafic.png", alt: "Kafa i desert u Paradiso kafiću" },
    { id: "pi-06", section: "pica", src: "images/galerija/kafic/06-kafic.png", alt: "Ledena kafa i donut na terasi" },
    { id: "pi-12", section: "pica", src: "images/galerija/kafic/12-kafic.png", alt: "Osveženje na terasi Paradiso" },
    { id: "pi-08", section: "pica", src: "images/galerija/kafic/08-kafic.png", alt: "Kokteli Mojito, Aperol i Hugo" },
    { id: "pi-11", section: "pica", src: "images/galerija/kafic/11-kafic.png", alt: "Bezalkoholno piće sa jagodama" },
    { id: "pi-10", section: "pica", src: "images/galerija/kafic/10-kafic.png", alt: "Kafa na terasi Paradiso" },
    { id: "pi-05", section: "pica", src: "images/galerija/kafic/05-kafic.png", alt: "Točeno LAV pivo u Paradiso kafiću" },
  ];

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function adminHeaders(extra = {}) {
    const token = sessionStorage.getItem(KEYS.adminToken) || "";
    return token ? { ...extra, "X-Admin-Token": token } : { ...extra };
  }

  async function readBody(res) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  function errorFromResponse(res, data) {
    const error = new Error((data && data.error) || `Greška (${res.status})`);
    error.status = res.status;
    if (data && data.code) error.code = data.code;
    return error;
  }

  async function getAvailability() {
    const res = await fetch(`${API_RESERVATIONS}?availability=1`, {
      cache: "no-store",
    });
    const data = await readBody(res);
    if (!res.ok) throw errorFromResponse(res, data);
    if (!Array.isArray(data.taken)) return [];
    return data.taken
      .filter((item) => item && item.datum && item.vrijeme)
      .map((item) => ({ datum: item.datum, vrijeme: item.vrijeme }));
  }

  async function getReservations() {
    const res = await fetch(API_RESERVATIONS, {
      headers: adminHeaders(),
      cache: "no-store",
    });
    const data = await readBody(res);
    if (!res.ok) throw errorFromResponse(res, data);
    return Array.isArray(data.items) ? data.items : [];
  }

  async function addReservation(data) {
    const payload = {
      datum: data.datum,
      vrijeme: data.vrijeme,
      paket: data.paket,
      ime: data.ime,
      telefon: data.telefon,
      source: data.source || "web",
    };
    const res = await fetch(API_RESERVATIONS, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const result = await readBody(res);
    if (!res.ok) throw errorFromResponse(res, result);
    return result.item;
  }

  async function deleteReservation(id) {
    const res = await fetch(
      `${API_RESERVATIONS}?id=${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: adminHeaders(),
      }
    );
    const data = await readBody(res);
    if (!res.ok) throw errorFromResponse(res, data);
  }

  function getGalleryState() {
    return readJSON(KEYS.gallery, { deleted: [], added: [] });
  }

  function saveGalleryState(state) {
    writeJSON(KEYS.gallery, state);
  }

  function getGalleryImages() {
    const state = getGalleryState();
    const deleted = new Set(state.deleted || []);
    const base = DEFAULT_GALLERY.filter((img) => !deleted.has(img.id));
    const added = (state.added || []).filter((img) => !deleted.has(img.id));
    return [...base, ...added];
  }

  function getGalleryBySection(section) {
    return getGalleryImages().filter((img) => img.section === section);
  }

  function deleteGalleryImage(id) {
    const state = getGalleryState();
    if (!state.deleted.includes(id)) state.deleted.push(id);
    state.added = (state.added || []).filter((img) => img.id !== id);
    saveGalleryState(state);
  }

  function addGalleryImage({ section, src, alt }) {
    const state = getGalleryState();
    const item = {
      id: uid("img"),
      section,
      src,
      alt: alt || "Paradiso galerija",
      createdAt: new Date().toISOString(),
    };
    state.added = state.added || [];
    state.added.push(item);
    saveGalleryState(state);
    return item;
  }

  function readTokenPayload(token) {
    try {
      const body = String(token || "").split(".")[0];
      if (!body || !String(token).includes(".")) return null;
      const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  async function login(password) {
    let res;
    let data = {};
    try {
      res = await fetch(API_ADMIN_LOGIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      data = await readBody(res);
    } catch {
      return { ok: false, message: "Prijava nije uspjela. Pokušajte ponovo." };
    }

    if (data.code === "unconfigured" || res.status === 503) {
      return {
        ok: false,
        unconfigured: true,
        message: "Prijava trenutno nije podešena.",
      };
    }

    if (!res.ok || !data.token) {
      return { ok: false, message: "Pogrešna šifra." };
    }

    sessionStorage.setItem(KEYS.session, "1");
    sessionStorage.setItem(KEYS.adminToken, data.token);
    return { ok: true };
  }

  function logout() {
    sessionStorage.removeItem(KEYS.session);
    sessionStorage.removeItem(KEYS.adminToken);
  }

  function isLoggedIn() {
    const token = sessionStorage.getItem(KEYS.adminToken) || "";
    const payload = readTokenPayload(token);
    return (
      sessionStorage.getItem(KEYS.session) === "1" &&
      Boolean(payload) &&
      payload.sub === "admin" &&
      typeof payload.exp === "number" &&
      payload.exp > Date.now()
    );
  }

  return {
    DEFAULT_GALLERY,
    getAvailability,
    getReservations,
    addReservation,
    deleteReservation,
    getGalleryImages,
    getGalleryBySection,
    deleteGalleryImage,
    addGalleryImage,
    login,
    logout,
    isLoggedIn,
  };
})();
