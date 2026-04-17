const themeStorageKey = "markdownvibe-theme";
const themeChoices = ["auto", "day", "night"];
const templateChoices = ["parchment", "blueprint", "moss", "ember", "harbor"];
const templateStoragePrefix = "markdownvibe-template";
const taskToggleEndpoint = "/__markdownvibe/tasks/toggle";
const fallbackStorage = new Map();

function normalizeThemePreference(value) {
  return themeChoices.includes(value) ? value : "auto";
}

function normalizeTemplateProfile(value) {
  return templateChoices.includes(value) ? value : "parchment";
}

function getStorageScope() {
  return window.location.origin && window.location.origin !== "null"
    ? window.location.origin
    : window.location.href;
}

function getTemplateStorageKey() {
  return `${templateStoragePrefix}:${getStorageScope()}`;
}

function readStoredValue(key) {
  try {
    return window.localStorage.getItem(key) ?? fallbackStorage.get(key) ?? null;
  } catch {
    return fallbackStorage.get(key) ?? null;
  }
}

function writeStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    fallbackStorage.set(key, value);
  }
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
    writeStoredValue(themeStorageKey, normalizedPreference);
  }
}

function initTheme() {
  const buttons = Array.from(document.querySelectorAll("[data-theme-choice]"));
  if (buttons.length === 0) {
    return;
  }

  const storedPreference = normalizeThemePreference(
    document.documentElement.dataset.themePreference ?? readStoredValue(themeStorageKey),
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

function getServerOriginLabel() {
  const origin = window.location.origin;
  if (origin && origin !== "null") {
    return origin;
  }

  return window.location.host ? `${window.location.protocol}//${window.location.host}` : "local file";
}

function getServerOriginHref() {
  return window.location.origin && window.location.origin !== "null"
    ? `${window.location.origin}/`
    : window.location.href;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildBreadcrumbHref(segments, count) {
  return count <= 0 ? "/" : `/${segments.slice(0, count).join("/")}`;
}

function isMarkdownSourcePath(value) {
  return typeof value === "string" && value.toLowerCase().endsWith(".md");
}

function initLocationTrail() {
  const serverChip = document.querySelector("[data-server-origin]");
  const serverOriginValue = document.querySelector("[data-server-origin-value]");
  const pathbar = document.querySelector("[data-pathbar]");
  const breadcrumbs = document.querySelector("[data-path-breadcrumbs]");
  const rawDownload = document.querySelector("[data-raw-download]");
  const rawDownloadPath = rawDownload?.dataset.rawDownloadPath ?? "";
  const currentOrigin = getServerOriginLabel();
  const currentOriginHref = getServerOriginHref();

  if (serverChip) {
    serverChip.dataset.serverOrigin = currentOrigin;
    serverChip.title = currentOrigin;
  }

  if (serverOriginValue) {
    serverOriginValue.textContent = currentOrigin;
    serverOriginValue.href = currentOriginHref;
    serverOriginValue.title = currentOrigin;
  }

  const rawSegments = window.location.pathname.split("/").filter(Boolean);
  if (!pathbar || !breadcrumbs) {
    if (rawDownload && isMarkdownSourcePath(rawDownloadPath)) {
      rawDownload.href = rawDownloadPath;
      rawDownload.download = decodePathSegment(
        rawDownloadPath.split("/").pop() ?? "document.md",
      );
      rawDownload.hidden = false;
    }
    return;
  }

  breadcrumbs.textContent = "";

  for (const [index, segment] of rawSegments.entries()) {
    const item = document.createElement("li");
    item.className = "path-item";

    const label = decodePathSegment(segment);
    const isCurrent = index === rawSegments.length - 1;

    if (isCurrent) {
      const current = document.createElement("span");
      current.className = "path-current";
      current.textContent = label;
      current.title = label;
      item.append(current);
    } else {
      const link = document.createElement("a");
      link.className = "path-link";
      link.href = buildBreadcrumbHref(rawSegments, index + 1);
      link.textContent = label;
      link.title = label;
      item.append(link);
    }

    breadcrumbs.append(item);
  }

  const hasPath = rawSegments.length > 0;
  const hasRawDownload = isMarkdownSourcePath(rawDownloadPath);

  if (rawDownload) {
    if (hasRawDownload) {
      rawDownload.href = rawDownloadPath;
      rawDownload.download = decodePathSegment(
        rawDownloadPath.split("/").pop() ?? "document.md",
      );
      rawDownload.hidden = false;
    } else {
      rawDownload.hidden = true;
      rawDownload.removeAttribute("href");
      rawDownload.removeAttribute("download");
    }
  }

  pathbar.hidden = !hasPath && !hasRawDownload;
}

function applyTemplate(profile, { persist = false } = {}) {
  const normalizedProfile = normalizeTemplateProfile(profile);
  const root = document.documentElement;

  root.dataset.templateProfile = normalizedProfile;

  for (const select of document.querySelectorAll("[data-template-select]")) {
    select.value = normalizedProfile;
  }

  if (persist) {
    writeStoredValue(getTemplateStorageKey(), normalizedProfile);
  }
}

function initTemplatePicker() {
  const selects = Array.from(document.querySelectorAll("[data-template-select]"));
  const storedTemplate = normalizeTemplateProfile(
    document.documentElement.dataset.templateProfile ?? readStoredValue(getTemplateStorageKey()),
  );
  applyTemplate(storedTemplate);

  for (const select of selects) {
    select.addEventListener("change", () => {
      applyTemplate(select.value, { persist: true });
      select.closest("[data-mobile-menu]")?.removeAttribute("open");
    });
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

function initTaskCheckboxes() {
  const article = document.querySelector(".prose[data-source-path]");
  const checkboxes = Array.from(article?.querySelectorAll("[data-task-checkbox]") ?? []);
  if (!article || checkboxes.length === 0) {
    return;
  }

  const sourcePath = article.dataset.sourcePath;
  const markdownHashTag = document.querySelector('meta[name="markdown-hash"]');
  let markdownHash = markdownHashTag?.getAttribute("content") ?? "";
  let isBusy = false;

  const setBusyState = (nextBusy) => {
    isBusy = nextBusy;
    for (const checkbox of checkboxes) {
      checkbox.disabled = nextBusy;
    }
  };

  for (const checkbox of checkboxes) {
    checkbox.addEventListener("change", async () => {
      if (isBusy || !sourcePath) {
        return;
      }

      const previousChecked = !checkbox.checked;
      const taskIndex = Number(checkbox.dataset.taskIndex);
      if (!Number.isInteger(taskIndex)) {
        checkbox.checked = previousChecked;
        return;
      }

      setBusyState(true);

      try {
        const response = await fetch(taskToggleEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourcePath,
            taskIndex,
            checked: checkbox.checked,
            markdownHash,
          }),
        });

        if (response.status === 409) {
          window.location.reload();
          return;
        }

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = await response.json();
        if (typeof payload.markdownHash === "string" && payload.markdownHash.length > 0) {
          markdownHash = payload.markdownHash;
          markdownHashTag?.setAttribute("content", markdownHash);
        }
      } catch (error) {
        checkbox.checked = previousChecked;
        console.error("Unable to update checklist item.", error);
      } finally {
        setBusyState(false);
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initTheme();
      initLocationTrail();
      initTemplatePicker();
      initToc();
      initTaskCheckboxes();
    },
    { once: true },
  );
} else {
  initTheme();
  initLocationTrail();
  initTemplatePicker();
  initToc();
  initTaskCheckboxes();
}
