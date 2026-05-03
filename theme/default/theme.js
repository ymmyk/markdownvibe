const themeStorageKey = "markdownvibe-theme";
const themeChoices = ["auto", "day", "night"];
const templateChoices = ["parchment", "blueprint", "moss", "ember", "harbor"];
const templateStoragePrefix = "markdownvibe-template";
const taskToggleEndpoint = "/__markdownvibe/tasks/toggle";
const mermaidScriptSrc = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
const fallbackStorage = new Map();
let mermaidLoader = null;
let mermaidRenderPass = 0;
let mermaidSvgCounter = 0;

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

function applyTheme(preference, { persist = false, refreshMermaid = false } = {}) {
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

  if (refreshMermaid) {
    renderMermaidDiagrams({ force: true });
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
      applyTheme(button.dataset.themeChoice, { persist: true, refreshMermaid: true });
      button.closest("[data-mobile-menu]")?.removeAttribute("open");
    });
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const syncAutoTheme = () => {
    if (normalizeThemePreference(document.documentElement.dataset.themePreference) === "auto") {
      applyTheme("auto", { refreshMermaid: true });
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

function applyTemplate(profile, { persist = false, refreshMermaid = false } = {}) {
  const normalizedProfile = normalizeTemplateProfile(profile);
  const root = document.documentElement;

  root.dataset.templateProfile = normalizedProfile;

  for (const select of document.querySelectorAll("[data-template-select]")) {
    select.value = normalizedProfile;
  }

  if (persist) {
    writeStoredValue(getTemplateStorageKey(), normalizedProfile);
  }

  if (refreshMermaid) {
    renderMermaidDiagrams({ force: true });
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
      applyTemplate(select.value, { persist: true, refreshMermaid: true });
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

function loadMermaidLibrary() {
  if (window.mermaid) {
    return Promise.resolve(window.mermaid);
  }

  if (mermaidLoader) {
    return mermaidLoader;
  }

  mermaidLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = mermaidScriptSrc;
    script.async = true;
    script.onload = () => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }

      mermaidLoader = null;
      reject(new Error("Mermaid loaded without exposing a global renderer."));
    };
    script.onerror = () => {
      mermaidLoader = null;
      reject(new Error("Unable to load Mermaid."));
    };
    document.head.append(script);
  });

  return mermaidLoader;
}

function readCssVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getMermaidConfig() {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: readCssVariable("--surface-strong"),
      mainBkg: readCssVariable("--surface-overlay"),
      primaryColor: readCssVariable("--surface-panel"),
      primaryTextColor: readCssVariable("--ink-strong"),
      primaryBorderColor: readCssVariable("--line-strong"),
      secondaryColor: readCssVariable("--accent-soft"),
      tertiaryColor: readCssVariable("--code-bg"),
      lineColor: readCssVariable("--muted"),
      fontFamily: readCssVariable("--font-sans"),
    },
  };
}

function setMermaidStatus(viewer, message) {
  const status = viewer.querySelector("[data-mermaid-status]");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.hidden = !message;
}

async function renderMermaidDiagrams({ force = false } = {}) {
  const viewers = Array.from(document.querySelectorAll("[data-mermaid-viewer]"));
  if (viewers.length === 0) {
    return;
  }

  const renderPass = ++mermaidRenderPass;

  let mermaid;
  try {
    mermaid = await loadMermaidLibrary();
  } catch (error) {
    for (const viewer of viewers) {
      viewer.classList.remove("is-loading");
      viewer.classList.add("has-error");
      setMermaidStatus(viewer, "Unable to load Mermaid.");
    }
    console.error("Unable to load Mermaid.", error);
    return;
  }

  if (renderPass !== mermaidRenderPass) {
    return;
  }

  try {
    mermaid.initialize(getMermaidConfig());
  } catch (error) {
    for (const viewer of viewers) {
      viewer.classList.remove("is-loading");
      viewer.classList.add("has-error");
      setMermaidStatus(viewer, "Unable to configure Mermaid.");
    }
    console.error("Unable to configure Mermaid.", error);
    return;
  }

  for (const viewer of viewers) {
    const diagram = viewer.querySelector("[data-mermaid-diagram]");
    const sourceCode = viewer.querySelector("[data-mermaid-source-code]");
    const source = sourceCode?.textContent ?? diagram?.textContent ?? "";

    if (!diagram || !source.trim()) {
      continue;
    }

    if (!force && diagram.dataset.mermaidRendered === "true") {
      continue;
    }

    viewer.classList.add("is-loading");
    viewer.classList.remove("has-error");
    diagram.classList.remove("is-rendered");
    setMermaidStatus(viewer, "Rendering diagram.");

    try {
      mermaidSvgCounter += 1;
      const result = await mermaid.render(`markdownvibe-mermaid-${mermaidSvgCounter}`, source);
      if (renderPass !== mermaidRenderPass) {
        return;
      }

      diagram.innerHTML = result.svg;
      result.bindFunctions?.(diagram);
      diagram.dataset.mermaidRendered = "true";
      diagram.classList.add("is-rendered");
      setMermaidStatus(viewer, "");
    } catch (error) {
      diagram.textContent = source;
      delete diagram.dataset.mermaidRendered;
      viewer.classList.add("has-error");
      setMermaidStatus(viewer, "Unable to render Mermaid diagram.");
      console.error("Unable to render Mermaid diagram.", error);
    } finally {
      viewer.classList.remove("is-loading");
    }
  }
}

function setMermaidMode(viewer, mode) {
  const nextMode = mode === "source" ? "source" : "diagram";

  for (const panel of viewer.querySelectorAll("[data-mermaid-panel]")) {
    const isActive = panel.dataset.mermaidPanel === nextMode;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  }

  for (const tab of viewer.querySelectorAll("[data-mermaid-tab]")) {
    const isActive = tab.dataset.mermaidTab === nextMode;
    tab.setAttribute("aria-selected", String(isActive));
    tab.classList.toggle("is-active", isActive);
    tab.tabIndex = isActive ? 0 : -1;
  }
}

function initMermaidViewers() {
  const viewers = Array.from(document.querySelectorAll("[data-mermaid-viewer]"));
  if (viewers.length === 0) {
    return;
  }

  for (const viewer of viewers) {
    const tabs = Array.from(viewer.querySelectorAll("[data-mermaid-tab]"));
    setMermaidMode(viewer, "diagram");

    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        setMermaidMode(viewer, tab.dataset.mermaidTab);
      });

      tab.addEventListener("keydown", (event) => {
        const currentIndex = tabs.indexOf(tab);
        const lastIndex = tabs.length - 1;
        let nextIndex = currentIndex;

        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = lastIndex;
        } else {
          return;
        }

        event.preventDefault();
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
      });
    }
  }

  renderMermaidDiagrams();
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
      initMermaidViewers();
    },
    { once: true },
  );
} else {
  initTheme();
  initLocationTrail();
  initTemplatePicker();
  initToc();
  initTaskCheckboxes();
  initMermaidViewers();
}
