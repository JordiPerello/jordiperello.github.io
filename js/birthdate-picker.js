/*
 * Birth-date picker powered by Air Datepicker (month → year views, TourAI theme).
 * Keeps ISO yyyy-MM-dd in #editBirthDate for form save compatibility.
 */
(function (global) {
  const LOCALE_ES = {
    days: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
    daysShort: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
    daysMin: ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"],
    months: [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ],
    monthsShort: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    today: "Hoy",
    clear: "Limpiar",
    dateFormat: "dd/MM/yyyy",
    timeFormat: "HH:mm",
    firstDay: 1,
  };

  const LOCALE_EN = {
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    daysMin: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    today: "Today",
    clear: "Clear",
    dateFormat: "MM/dd/yyyy",
    timeFormat: "HH:mm",
    firstDay: 1,
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toIso(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseIso(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function resolveLocale() {
    const tag = global.TourAiI18n?.getLocale?.() || "es-ES";
    if (tag === "en-GB" || tag === "en") {
      return LOCALE_EN;
    }
    return LOCALE_ES;
  }

  function isEnglishLocale() {
    const tag = global.TourAiI18n?.getLocale?.() || "es-ES";
    return tag === "en-GB" || tag === "en";
  }

  /** Display format by site language; storage stays ISO yyyy-MM-dd. */
  function formatDisplayDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }
    const day = pad2(date.getDate());
    const month = pad2(date.getMonth() + 1);
    const year = String(date.getFullYear());
    // ES: dd/MM/yyyy — EN: MM/dd/yyyy
    return isEnglishLocale() ? month + "/" + day + "/" + year : day + "/" + month + "/" + year;
  }

  function getAirDatepicker() {
    const exported = global.AirDatepicker;
    if (typeof exported === "function") {
      return exported;
    }
    if (exported && typeof exported.default === "function") {
      return exported.default;
    }
    return null;
  }

  function createPicker(options) {
    const input = options.input;
    const visible = options.visible || options.input;
    const AirDatepicker = getAirDatepicker();
    if (!input || !visible || !AirDatepicker) {
      console.warn("[TourAI] Air Datepicker is not available.");
      return null;
    }

    const t =
      options.t ||
      function (_key, fallback) {
        return fallback;
      };

    const minDate = new Date(1900, 0, 1);
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);

    let instance = null;
    let open = false;

    function syncPlaceholderClass() {
      if (!input.value) {
        visible.classList.add("is-placeholder");
      } else {
        visible.classList.remove("is-placeholder");
      }
    }

    function destroy() {
      if (instance) {
        try {
          instance.destroy();
        } catch (err) {
          console.warn("[TourAI] birthdate destroy failed", err);
        }
        instance = null;
      }
      open = false;
      options.root?.classList.remove("is-open");
      visible.setAttribute("aria-expanded", "false");
    }

    function build() {
      destroy();
      const initial = parseIso(input.value);
      const start =
        initial || new Date(maxDate.getFullYear() - 25, maxDate.getMonth(), 1);
      const isNarrow =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 640px)").matches;

      // Air Datepicker can fail if the field stays disabled during init.
      const wasDisabled = !!visible.disabled;
      if (wasDisabled) {
        visible.disabled = false;
      }

      try {
        instance = new AirDatepicker(visible, {
          locale: resolveLocale(),
          selectedDates: initial ? [initial] : [],
          startDate: start,
          minDate: minDate,
          maxDate: maxDate,
          autoClose: true,
          dateFormat: function (date) {
            const value = Array.isArray(date) ? date[0] : date;
            return formatDisplayDate(value);
          },
          firstDay: 1,
          isMobile: isNarrow,
          buttons: ["clear"],
          keyboardNav: true,
          container: document.body,
          zIndex: 30000,
          onSelect: function () {
            const selected = instance?.selectedDates?.[0] || null;
            input.value = selected ? toIso(selected) : "";
            visible.value = selected ? formatDisplayDate(selected) : "";
            input.dispatchEvent(new Event("change", { bubbles: true }));
            syncPlaceholderClass();
          },
          onShow: function (isFinished) {
            if (isFinished === false) {
              return;
            }
            open = true;
            visible.setAttribute("aria-expanded", "true");
            options.root?.classList.add("is-open");
          },
          onHide: function (isFinished) {
            if (isFinished === false) {
              return;
            }
            open = false;
            visible.setAttribute("aria-expanded", "false");
            options.root?.classList.remove("is-open");
          },
        });
      } catch (err) {
        console.error("[TourAI] birthdate picker init failed", err);
        instance = null;
      } finally {
        if (wasDisabled) {
          visible.disabled = true;
        }
      }

      visible.placeholder = t(
        "account.edit.birthDate.placeholder",
        "Seleccionar fecha"
      );
      if (!input.value) {
        visible.value = "";
      }
      syncPlaceholderClass();
    }

    build();
    if (!instance) {
      return null;
    }

    return {
      setEnabled: function (enabled) {
        input.disabled = !enabled;
        visible.disabled = !enabled;
        visible.readOnly = true;
        if (!enabled) {
          this.close();
        }
      },
      setValue: function (iso) {
        const date = parseIso(iso);
        input.value = date ? toIso(date) : "";
        if (!instance) {
          return;
        }
        try {
          if (date) {
            instance.selectDate(date);
            instance.setViewDate(date);
            visible.value = formatDisplayDate(date);
          } else {
            instance.clear();
            visible.value = "";
            visible.placeholder = t(
              "account.edit.birthDate.placeholder",
              "Seleccionar fecha"
            );
          }
        } catch (err) {
          console.warn("[TourAI] birthdate setValue failed", err);
          if (date) {
            visible.value = formatDisplayDate(date);
          }
        }
        syncPlaceholderClass();
      },
      getValue: function () {
        return input.value || "";
      },
      refresh: function () {
        const current = input.value;
        const enabled = !visible.disabled;
        build();
        if (!instance) {
          return;
        }
        if (current) {
          this.setValue(current);
        }
        this.setEnabled(enabled);
      },
      close: function () {
        try {
          instance?.hide?.();
        } catch (_) {
          /* ignore */
        }
      },
      isOpen: function () {
        return open;
      },
      destroy: destroy,
    };
  }

  global.TourAiBirthdatePicker = {
    create: createPicker,
    parseIso: parseIso,
    formatDisplayDate: formatDisplayDate,
  };
})(window);
