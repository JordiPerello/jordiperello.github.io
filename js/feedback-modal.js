(function () {
  const MODAL_ID = "tourai-feedback-modal";
  let onCloseCallback = null;

  function tOr(key, fallback) {
    const locale = window.TourAiI18n?.getLocale?.() ?? "es-ES";
    return window.TourAiI18n?.tOr(key, locale, null, fallback) ?? fallback;
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "tourai-feedback-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="tourai-feedback-panel" role="dialog" aria-modal="true" aria-labelledby="touraiFeedbackTitle">
        <div class="tourai-feedback-icon" id="touraiFeedbackIcon" aria-hidden="true"></div>
        <h3 id="touraiFeedbackTitle" class="tourai-feedback-title"></h3>
        <p id="touraiFeedbackMessage" class="tourai-feedback-message"></p>
        <button type="button" id="touraiFeedbackCloseBtn" class="tourai-feedback-btn"></button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        window.TourAiFeedback.hide();
      }
    });

    modal.querySelector(".tourai-feedback-panel").addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.getElementById("touraiFeedbackCloseBtn").addEventListener("click", () => {
      window.TourAiFeedback.hide();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("visible")) {
        window.TourAiFeedback.hide();
      }
    });
  }

  window.TourAiFeedback = {
    show(options) {
      ensureModal();
      const type = options?.type ?? "info";
      const modal = document.getElementById(MODAL_ID);
      const icon = document.getElementById("touraiFeedbackIcon");
      const titleEl = document.getElementById("touraiFeedbackTitle");
      const messageEl = document.getElementById("touraiFeedbackMessage");
      const button = document.getElementById("touraiFeedbackCloseBtn");

      const defaultTitles = {
        success: tOr("feedback.success.title", "¡Listo!"),
        error: tOr("feedback.error.title", "No se pudo completar"),
        info: tOr("feedback.info.title", "Acción necesaria"),
      };

      icon.className = `tourai-feedback-icon tourai-feedback-icon--${type}`;
      titleEl.textContent = options?.title ?? defaultTitles[type] ?? defaultTitles.info;
      messageEl.textContent = options?.message ?? "";
      button.textContent = options?.buttonText ?? tOr("feedback.close", "Entendido");

      onCloseCallback = options?.onClose ?? null;

      modal.classList.add("visible");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("tourai-feedback-open");
      button.focus();
    },

    hide() {
      const modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.classList.remove("visible");
        modal.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("tourai-feedback-open");

      const callback = onCloseCallback;
      onCloseCallback = null;
      if (callback) {
        callback();
      }
    },
  };
})();
