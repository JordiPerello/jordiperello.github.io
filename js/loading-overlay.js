(function () {
  const OVERLAY_ID = "tourai-loading-overlay";
  let depth = 0;

  function getMessage(fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return (
      window.TourAiI18n?.tOr("loading.processing", locale, null, fallback) ?? fallback
    );
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "tourai-loading-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="tourai-loading-panel" role="status" aria-live="polite" aria-busy="true">
        <div class="tourai-loading-spinner" aria-hidden="true"></div>
        <p class="tourai-loading-message" data-default-text="Procesando...">Procesando...</p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function syncOverlay() {
    const overlay = ensureOverlay();
    const visible = depth > 0;
    overlay.classList.toggle("visible", visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
    document.body.classList.toggle("tourai-loading-active", visible);
  }

  window.TourAiLoading = {
    show(message) {
      const overlay = ensureOverlay();
      const messageEl = overlay.querySelector(".tourai-loading-message");
      if (messageEl) {
        const fallback = messageEl.getAttribute("data-default-text") ?? "Procesando...";
        messageEl.textContent = message ?? getMessage(fallback);
      }

      depth += 1;
      syncOverlay();
    },

    hide() {
      depth = Math.max(0, depth - 1);
      syncOverlay();
    },

    async run(task, message) {
      this.show(message);
      try {
        return await task();
      } finally {
        this.hide();
      }
    },

    isVisible() {
      return depth > 0;
    },
  };
})();
