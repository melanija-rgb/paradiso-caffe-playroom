const loginView = document.getElementById("admin-login");
const panelView = document.getElementById("admin-panel");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("admin-logout");
const reservationForm = document.getElementById("admin-reservation-form");
const reservationsBody = document.querySelector("#reservations-table tbody");
const reservationsEmpty = document.getElementById("reservations-empty");
const galleryForm = document.getElementById("admin-gallery-form");
const galleryGrid = document.getElementById("admin-gallery-grid");

const sectionLabels = {
  igraonica: "Igraonica",
  dekoracije: "Dekoracije",
  kafic: "Kafić",
  pica: "Pića",
};

let galleryFilter = "all";

function showPanel(loggedIn) {
  loginView.hidden = loggedIn;
  panelView.hidden = !loggedIn;
  document.body.classList.toggle("is-admin-authed", loggedIn);
}

function requireAuth() {
  if (ParadisoStore.isLoggedIn()) return true;
  showPanel(false);
  return false;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}.`;
}

function renderReservations() {
  if (!requireAuth()) return;
  const list = ParadisoStore.getReservations();
  reservationsBody.innerHTML = "";
  reservationsEmpty.hidden = list.length > 0;

  list.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(item.datum)}</td>
      <td>${item.vrijeme}</td>
      <td>${item.paket}</td>
      <td>${item.ime}</td>
      <td><a href="tel:${item.telefon.replace(/\s/g, "")}">${item.telefon}</a></td>
      <td><button type="button" class="admin-delete" data-id="${item.id}">Obriši</button></td>
    `;
    reservationsBody.appendChild(tr);
  });
}

function renderGallery() {
  if (!requireAuth()) return;
  const images = ParadisoStore.getGalleryImages().filter(
    (img) => galleryFilter === "all" || img.section === galleryFilter
  );
  galleryGrid.innerHTML = "";

  if (!images.length) {
    galleryGrid.innerHTML = `<p class="admin__empty">Nema slika u ovom odjeljku.</p>`;
    return;
  }

  images.forEach((img) => {
    const card = document.createElement("article");
    card.className = "admin-gallery-card";
    card.innerHTML = `
      <img src="${img.src}" alt="${img.alt}" />
      <div class="admin-gallery-card__meta">
        <span>${sectionLabels[img.section] || img.section}</span>
        <button type="button" class="admin-delete" data-gallery-id="${img.id}">Obriši</button>
      </div>
    `;
    galleryGrid.appendChild(card);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const password = document.getElementById("admin-password").value;
  const ok = await ParadisoStore.login(password);
  if (!ok) {
    loginError.hidden = false;
    return;
  }
  showPanel(true);
  renderReservations();
  renderGallery();
});

logoutBtn.addEventListener("click", () => {
  ParadisoStore.logout();
  showPanel(false);
  loginForm.reset();
});

document.querySelectorAll(".admin-tabs__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tabs__btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    const tab = btn.dataset.tab;
    document.getElementById("tab-rezervacije").hidden = tab !== "rezervacije";
    document.getElementById("tab-galerija").hidden = tab !== "galerija";
  });
});

reservationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireAuth()) return;
  const data = new FormData(reservationForm);
  ParadisoStore.addReservation({
    datum: data.get("datum"),
    vrijeme: data.get("vrijeme"),
    paket: data.get("paket"),
    ime: String(data.get("ime") || "").trim(),
    telefon: String(data.get("telefon") || "").trim(),
    source: "admin",
  });
  reservationForm.reset();
  renderReservations();
});

reservationsBody.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-id]");
  if (!btn || !requireAuth()) return;
  if (!confirm("Obrisati ovu rezervaciju?")) return;
  ParadisoStore.deleteReservation(btn.dataset.id);
  renderReservations();
});

document.querySelectorAll(".admin-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-filter").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    galleryFilter = btn.dataset.section;
    renderGallery();
  });
});

galleryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAuth()) return;
  const data = new FormData(galleryForm);
  const file = data.get("image");
  if (!(file instanceof File) || !file.size) return;

  if (file.size > 2.5 * 1024 * 1024) {
    alert("Slika je prevelika. Izaberite sliku manju od 2.5 MB.");
    return;
  }

  const src = await readFileAsDataURL(file);
  ParadisoStore.addGalleryImage({
    section: data.get("section"),
    src,
    alt: String(data.get("alt") || "").trim() || "Paradiso galerija",
  });
  galleryForm.reset();
  renderGallery();
});

galleryGrid.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-gallery-id]");
  if (!btn || !requireAuth()) return;
  if (!confirm("Obrisati ovu sliku iz galerije?")) return;
  ParadisoStore.deleteGalleryImage(btn.dataset.galleryId);
  renderGallery();
});

if (ParadisoStore.isLoggedIn()) {
  showPanel(true);
  renderReservations();
  renderGallery();
} else {
  showPanel(false);
}
