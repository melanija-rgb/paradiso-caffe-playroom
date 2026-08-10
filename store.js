/* Shared data store for reservations + gallery (localStorage) */
const ParadisoStore = (() => {
  const KEYS = {
    reservations: "paradiso_reservations",
    gallery: "paradiso_gallery",
    session: "paradiso_admin_session_v2",
  };

  const ADMIN_PASS_HASH =
    "3404217d72d0c7e6a1a21f95c3083eb2487ee55643f6482a5026e0bfe97d0e96";

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
    { id: "ka-13", section: "kafic", src: "images/galerija/kafic/13-kafic.png", alt: "Dugački sto spreman za druženje" },
    { id: "ka-14", section: "kafic", src: "images/galerija/kafic/14-kafic.png", alt: "Svečani ambijent u Paradiso kafiću" },
    { id: "ka-04", section: "kafic", src: "images/galerija/kafic/04-kafic.png", alt: "Desert u Paradiso kafiću" },
    { id: "pi-01", section: "pica", src: "images/galerija/kafic/01-kafic.png", alt: "Kafa i desert u Paradiso kafiću" },
    { id: "pi-05", section: "pica", src: "images/galerija/kafic/05-kafic.png", alt: "Kafa na terasi Paradiso" },
    { id: "pi-06", section: "pica", src: "images/galerija/kafic/06-kafic.png", alt: "Ledena kafa i donut na terasi" },
    { id: "pi-12", section: "pica", src: "images/galerija/kafic/12-kafic.png", alt: "Osveženje na terasi Paradiso" },
    { id: "pi-08", section: "pica", src: "images/galerija/kafic/08-kafic.png", alt: "Kokteli Mojito, Aperol i Hugo" },
    { id: "pi-11", section: "pica", src: "images/galerija/kafic/11-kafic.png", alt: "Bezalkoholno piće sa jagodama" },
    { id: "pi-10", section: "pica", src: "images/galerija/kafic/10-kafic.png", alt: "Točeno pivo u Paradiso kafiću" },
  ];

  async function hashPassword(value) {
    const data = new TextEncoder().encode(`paradiso::${value}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

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

  function getReservations() {
    return readJSON(KEYS.reservations, []);
  }

  function saveReservations(list) {
    writeJSON(KEYS.reservations, list);
  }

  function addReservation(data) {
    const list = getReservations();
    const item = {
      id: uid("rez"),
      datum: data.datum,
      vrijeme: data.vrijeme,
      paket: data.paket,
      ime: data.ime,
      telefon: data.telefon,
      createdAt: new Date().toISOString(),
      source: data.source || "web",
    };
    list.unshift(item);
    saveReservations(list);
    return item;
  }

  function deleteReservation(id) {
    saveReservations(getReservations().filter((r) => r.id !== id));
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

  async function login(password) {
    const hash = await hashPassword(password);
    if (hash !== ADMIN_PASS_HASH) return false;
    sessionStorage.setItem(KEYS.session, "1");
    return true;
  }

  function logout() {
    sessionStorage.removeItem(KEYS.session);
  }

  function isLoggedIn() {
    return sessionStorage.getItem(KEYS.session) === "1";
  }

  return {
    DEFAULT_GALLERY,
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
    hashPassword,
  };
})();
