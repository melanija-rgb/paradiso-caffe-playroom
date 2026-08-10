const header = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const aboutLines = document.querySelectorAll(".about__text p");

const setNavOpen = (open) => {
  if (!header || !navToggle) return;
  header.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("nav-open", open);
};

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const open = navToggle.getAttribute("aria-expanded") !== "true";
    setNavOpen(open);
  });

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavOpen(false);
  });
}

const onScroll = () => {
  if (!header || header.classList.contains("is-solid")) return;
  header.classList.toggle("is-scrolled", window.scrollY > 12);
};

onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

if ("IntersectionObserver" in window && aboutLines.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const paragraphs = [...aboutLines];
        paragraphs.forEach((p, index) => {
          p.style.animationDelay = `${index * 90}ms`;
          p.classList.add("is-visible");
        });
        observer.disconnect();
      });
    },
    { threshold: 0.25 }
  );

  const aboutSection = document.querySelector(".about");
  if (aboutSection) observer.observe(aboutSection);
} else {
  aboutLines.forEach((p) => p.classList.add("is-visible"));
}

/* —— Rezervacija —— */
const bookingForm = document.getElementById("booking-form");

if (bookingForm) {
  const monthNames = [
    "Januar",
    "Februar",
    "Mart",
    "April",
    "Maj",
    "Juni",
    "Juli",
    "August",
    "Septembar",
    "Oktobar",
    "Novembar",
    "Decembar",
  ];

  const calMonth = document.getElementById("cal-month");
  const calDays = document.getElementById("cal-days");
  const calPrev = document.getElementById("cal-prev");
  const calNext = document.getElementById("cal-next");
  const dateInput = document.getElementById("booking-date");
  const selectedLabel = document.getElementById("selected-date-label");
  const errorEl = document.getElementById("booking-error");
  const successEl = document.getElementById("booking-success");
  const successText = document.getElementById("booking-success-text");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selectedDate = null;

  const pad = (n) => String(n).padStart(2, "0");

  const formatISO = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const formatDisplay = (date) =>
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}.`;

  const renderCalendar = () => {
    calMonth.textContent = `${monthNames[viewMonth]} ${viewYear}`;
    calDays.innerHTML = "";

    const firstDay = new Date(viewYear, viewMonth, 1);
    let startWeekday = firstDay.getDay();
    startWeekday = startWeekday === 0 ? 6 : startWeekday - 1;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < startWeekday; i += 1) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "calendar__day is-empty";
      empty.tabIndex = -1;
      empty.disabled = true;
      calDays.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(viewYear, viewMonth, day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calendar__day";
      btn.textContent = String(day);
      btn.setAttribute("aria-label", formatDisplay(date));

      if (date.getTime() === today.getTime()) btn.classList.add("is-today");
      if (date < today) btn.disabled = true;

      if (selectedDate && formatISO(date) === formatISO(selectedDate)) {
        btn.classList.add("is-selected");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.setAttribute("aria-pressed", "false");
      }

      btn.addEventListener("click", () => {
        selectedDate = date;
        dateInput.value = formatISO(date);
        selectedLabel.textContent = `Odabrani datum: ${formatDisplay(date)}`;
        renderCalendar();
      });

      calDays.appendChild(btn);
    }
  };

  calPrev.addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderCalendar();
  });

  calNext.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderCalendar();
  });

  renderCalendar();

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const vrijeme = bookingForm.querySelector('input[name="vrijeme"]:checked');
    const paket = bookingForm.querySelector('input[name="paket"]:checked');
    const ime = document.getElementById("booking-name").value.trim();
    const telefon = document.getElementById("booking-phone").value.trim();

    if (!dateInput.value) {
      errorEl.textContent = "Odaberite datum u kalendaru.";
      errorEl.hidden = false;
      return;
    }
    if (!vrijeme) {
      errorEl.textContent = "Odaberite termin.";
      errorEl.hidden = false;
      return;
    }
    if (!paket) {
      errorEl.textContent = "Odaberite paket.";
      errorEl.hidden = false;
      return;
    }
    if (!ime) {
      errorEl.textContent = "Unesite ime i prezime.";
      errorEl.hidden = false;
      return;
    }
    if (!telefon) {
      errorEl.textContent = "Unesite broj telefona.";
      errorEl.hidden = false;
      return;
    }

    if (!window.ParadisoStore) {
      errorEl.textContent = "Greška pri čuvanju rezervacije. Osvježite stranicu i pokušajte ponovo.";
      errorEl.hidden = false;
      return;
    }

    const submitBtn = bookingForm.querySelector(".booking__submit");
    if (submitBtn) submitBtn.disabled = true;

    try {
      await ParadisoStore.addReservation({
        datum: dateInput.value,
        vrijeme: vrijeme.value,
        paket: paket.value,
        ime,
        telefon,
        source: "web",
      });

      bookingForm.hidden = true;
      successEl.hidden = false;
      successText.textContent = `Vaša rezervacija je zaprimljena za ${formatDisplay(
        selectedDate
      )} u terminu ${vrijeme.value}, ${paket.value}. Javićemo se na broj ${telefon}.`;
    } catch (error) {
      errorEl.textContent =
        error.message || "Rezervacija nije sačuvana. Pokušajte ponovo.";
      errorEl.hidden = false;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
