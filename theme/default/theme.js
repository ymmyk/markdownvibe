const themeStorageKey = "markdownvibe-theme";
const themeChoices = ["auto", "day", "night"];

function normalizeThemePreference(value) {
  return themeChoices.includes(value) ? value : "auto";
}

function resolveTheme(preference) {
  if (preference !== "auto") {
    return preference;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

function applyTheme(preference, { persist = false } = {}) {
  const normalizedPreference = normalizeThemePreference(preference);
  const resolvedTheme = resolveTheme(normalizedPreference);
  const root = document.documentElement;

  root.dataset.themePreference = normalizedPreference;
  root.dataset.resolvedTheme = resolvedTheme;

  for (const button of document.querySelectorAll("[data-theme-choice]")) {
    const isActive = button.dataset.themeChoice === normalizedPreference;
    button.setAttribute("aria-pressed", String(isActive));
    button.classList.toggle("is-active", isActive);
  }

  if (persist) {
    window.localStorage.setItem(themeStorageKey, normalizedPreference);
  }
}

function initTheme() {
  const buttons = Array.from(document.querySelectorAll("[data-theme-choice]"));
  if (buttons.length === 0) {
    return;
  }

  const storedPreference = normalizeThemePreference(
    document.documentElement.dataset.themePreference ?? window.localStorage.getItem(themeStorageKey),
  );
  applyTheme(storedPreference);

  for (const button of buttons) {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeChoice, { persist: true });
      button.closest("[data-mobile-menu]")?.removeAttribute("open");
    });
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const syncAutoTheme = () => {
    if (normalizeThemePreference(document.documentElement.dataset.themePreference) === "auto") {
      applyTheme("auto");
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", syncAutoTheme);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(syncAutoTheme);
  }
}

function initToc() {
  const toggle = document.querySelector("[data-toc-toggle]");
  const closeButton = document.querySelector("[data-toc-close]");
  const panel = document.querySelector("[data-toc-panel]");
  const scrim = document.querySelector("[data-toc-scrim]");
  const tocLinks = Array.from(document.querySelectorAll("[data-toc-link]"));
  const headings = tocLinks
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  if (!toggle || !panel || !scrim) {
    return;
  }

  function setOpenState(isOpen) {
    panel.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    scrim.hidden = !isOpen;
    document.body.style.overflow = isOpen ? "hidden" : "";
    document.documentElement.dataset.tocOpen = String(isOpen);
  }

  document.documentElement.dataset.markdownvibeReady = "true";

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") !== "true";
    setOpenState(isOpen);
  });

  closeButton?.addEventListener("click", () => setOpenState(false));
  scrim.addEventListener("click", () => setOpenState(false));

  for (const link of tocLinks) {
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 959px)").matches) {
        setOpenState(false);
      }
    });
  }

  if (headings.length === 0) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);

      if (visible.length === 0) {
        return;
      }

      const activeId = visible[0].target.id;
      for (const link of tocLinks) {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${activeId}`);
      }
    },
    {
      rootMargin: "-20% 0px -65% 0px",
      threshold: [0, 1],
    },
  );

  for (const heading of headings) {
    observer.observe(heading);
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initTheme();
      initToc();
    },
    { once: true },
  );
} else {
  initTheme();
  initToc();
}
