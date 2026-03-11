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
      if (window.matchMedia("(max-width: 1099px)").matches) {
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
  document.addEventListener("DOMContentLoaded", initToc, { once: true });
} else {
  initToc();
}
