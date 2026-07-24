/*
 * Shared account/dashboard Firestore helpers (lazy section loads).
 */
(function (global) {
  const cache = {
    profile: null,
    plans: null,
    payments: null,
    uid: null,
  };

  function authApi() {
    return global.TourAiAuth;
  }

  function t(key, fallback) {
    return authApi()?.t?.(key, fallback) ?? fallback;
  }

  function resetCacheIfNeeded(uid) {
    if (cache.uid !== uid) {
      cache.uid = uid;
      cache.profile = null;
      cache.plans = null;
      cache.payments = null;
    }
  }

  function toDate(value) {
    if (!value) {
      return null;
    }
    if (typeof value.toDate === "function") {
      return value.toDate();
    }
    if (typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDate(value) {
    const date = toDate(value);
    if (!date) {
      return "—";
    }
    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    return date.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatDateTime(value) {
    const date = toDate(value);
    if (!date) {
      return "—";
    }
    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    return date.toLocaleString(locale, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatMoney(amountCents, currency) {
    const cents = Number(amountCents) || 0;
    const code = (currency || "EUR").toUpperCase();
    const locale = global.TourAiI18n?.getLocale?.() || "es-ES";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${code}`;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function planState(plan) {
    const now = Date.now();
    const start = toDate(plan.StartDate);
    const end = toDate(plan.EndDate);
    const expiry = toDate(plan.ExpiryDate);
    const included = Number(plan.TokensIncluded) || 0;
    const consumed = Number(plan.TokensConsumed) || 0;
    const remaining = included - consumed;
    const consumedOut = included > 0 && remaining <= 0;

    if (!start && expiry && expiry.getTime() >= now) {
      return "pending";
    }
    if (start && end && now >= start.getTime() && now <= end.getTime() && !consumedOut) {
      return "active";
    }
    if (consumedOut) {
      return "consumed";
    }
    if (expiry && now >= expiry.getTime()) {
      return "expired";
    }
    if (end && now > end.getTime()) {
      return "expired";
    }
    return "other";
  }

  function stateLabel(state) {
    switch (state) {
      case "active":
        return t("account.plan.state.active", "En uso");
      case "pending":
        return t("account.plan.state.pending", "Pendiente de iniciar");
      case "consumed":
        return t("account.plan.state.consumed", "Consumido");
      case "expired":
        return t("account.plan.state.expired", "Caducado");
      case "freemium":
        return t("account.plan.state.freemium", "Plan gratuito");
      default:
        return t("account.plan.state.other", "Sin clasificar");
    }
  }

  function planStatusMeta(plan) {
    const accountType = String(plan.AccountType || "Premium");
    if (accountType === "Freemium") {
      return { state: "freemium", label: stateLabel("freemium") };
    }
    const state = planState(plan);
    return { state: state, label: stateLabel(state) };
  }

  function isBonusPlan(plan) {
    const type = plan.AcquisitionType;
    return type === "Bonus" || type === 1 || type === "1";
  }

  function acquisitionLabel(plan) {
    return isBonusPlan(plan)
      ? t("account.plan.acquisition.bonus", "Bono")
      : t("account.plan.acquisition.purchase", "Compra");
  }

  function paymentStatusLabel(status) {
    switch ((status || "").toString()) {
      case "Paid":
        return t("account.payment.status.paid", "Pagado");
      case "Pending":
        return t("account.payment.status.pending", "Pendiente");
      case "Failed":
        return t("account.payment.status.failed", "Fallido");
      case "Free":
        return t("account.payment.status.free", "Gratis");
      default:
        return status || "—";
    }
  }

  function methodLabel(method) {
    switch ((method || "").toString()) {
      case "Stripe":
        return "Stripe";
      case "Google":
        return "Google Play";
      case "Apple":
        return "App Store";
      case "Windows":
        return "Microsoft Store";
      case "Promo":
        return t("account.payment.method.promo", "Promoción");
      default:
        return method || "—";
    }
  }

  async function fetchProfile(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.profile) {
      return cache.profile;
    }
    const db = await authApi().getFirestore();
    const snap = await db.collection("Users").doc(user.uid).get();
    cache.profile = {
      ...(snap.exists ? snap.data() : {}),
      AuthEmail: user.email || "",
    };
    return cache.profile;
  }

  async function fetchPlans(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.plans) {
      return cache.plans;
    }
    const db = await authApi().getFirestore();
    const snap = await db.collection("Users").doc(user.uid).collection("UserPlans").get();
    cache.plans = snap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));
    return cache.plans;
  }

  async function fetchPayments(user) {
    resetCacheIfNeeded(user.uid);
    if (cache.payments) {
      return cache.payments;
    }
    const db = await authApi().getFirestore();
    const snap = await db.collection("Users").doc(user.uid).collection("UserPayments").get();
    cache.payments = snap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));
    return cache.payments;
  }

  function renderActivePlanHtml(plans) {
    const active = plans.find((p) => planState(p) === "active");
    if (!active) {
      return `<p class="account-empty">${t(
        "account.plan.freemium",
        "Ahora mismo usas Freemium en la app. El cupo diario de uso gratuito se gestiona en el dispositivo (anuncios recompensados) y no aparece aquí."
      )}</p>`;
    }

    return `<div class="plan-list">${renderPlanCardHtml(active, { interactive: true })}</div>`;
  }

  function planSortKey(plan, state) {
    switch (state) {
      case "active":
      case "consumed":
        return toDate(plan.StartDate)?.getTime() || 0;
      case "pending":
      case "expired":
        return toDate(plan.ExpiryDate)?.getTime() || toDate(plan.EndDate)?.getTime() || 0;
      default:
        return toDate(plan.CreatedAt)?.getTime() || 0;
    }
  }

  function orderPlansLikeApp(plans) {
    // Same grouping as UserPlansHistoryView: InUse → Pending → Consumed → Expired → Other.
    const groups = {
      active: [],
      pending: [],
      consumed: [],
      expired: [],
      other: [],
    };

    plans.forEach(function (plan) {
      if (String(plan.AccountType || "") === "Freemium") {
        return;
      }
      const state = planState(plan);
      const bucket = groups[state] ? state : "other";
      groups[bucket].push(plan);
    });

    ["active", "pending", "consumed", "expired", "other"].forEach(function (state) {
      groups[state].sort(function (a, b) {
        return planSortKey(b, state) - planSortKey(a, state);
      });
    });

    return groups.active
      .concat(groups.pending)
      .concat(groups.consumed)
      .concat(groups.expired)
      .concat(groups.other);
  }

  function renderPlanCardHtml(plan, options) {
    const opts = options || {};
    const interactive = opts.interactive !== false;
    const status = planStatusMeta(plan);
    const planId = escapeHtml(plan.Id || "");
    const name = escapeHtml(plan.PlanName || plan.PlanId || "—");
    const description = String(plan.PlanDescription || "").trim();
    const accountType = escapeHtml(String(plan.AccountType || "Premium").toUpperCase());
    const acquisition = escapeHtml(acquisitionLabel(plan).toUpperCase());
    const start = formatDateTime(plan.StartDate);
    const end = formatDateTime(plan.EndDate || plan.ExpiryDate);
    const interactiveAttrs = interactive
      ? ` role="button" tabindex="0" data-plan-id="${planId}" aria-label="${escapeHtml(
          t("account.plan.openDetail", "Ver detalle del plan")
        )}: ${name}"`
      : "";

    return `<article class="plan-list-card${interactive ? " plan-list-card--interactive" : ""}" data-plan-state="${escapeHtml(
      status.state
    )}"${interactiveAttrs}>
      <div class="plan-list-card__header">
        <span class="plan-list-card__bullet" aria-hidden="true"></span>
        <div class="plan-list-card__titles">
          <h3 class="plan-list-card__title">${name}</h3>
          <p class="plan-list-card__status">${escapeHtml(status.label)}</p>
        </div>
      </div>
      ${
        description
          ? `<p class="plan-list-card__description">${escapeHtml(description)}</p>`
          : ""
      }
      <div class="plan-list-card__divider" aria-hidden="true"></div>
      <dl class="plan-list-card__metrics">
        <div>
          <dt>${t("account.plan.accountType", "Tipo de cuenta")}</dt>
          <dd class="plan-list-card__metric-accent">${accountType}</dd>
        </div>
        <div>
          <dt>${t("account.plan.acquisition", "Origen")}</dt>
          <dd class="plan-list-card__metric-accent">${acquisition}</dd>
        </div>
        <div>
          <dt>${t("account.plan.start", "Inicio")}</dt>
          <dd class="plan-list-card__metric-date">${escapeHtml(start)}</dd>
        </div>
        <div>
          <dt>${t("account.plan.end", "Fin")}</dt>
          <dd class="plan-list-card__metric-date">${escapeHtml(end)}</dd>
        </div>
      </dl>
    </article>`;
  }

  function renderPlansHtml(plans) {
    const ordered = orderPlansLikeApp(plans);
    if (!ordered.length) {
      return `<p class="account-empty">${t(
        "account.plan.empty",
        "Aún no tienes planes Premium guardados en la cuenta."
      )}</p>`;
    }

    const cards = ordered.map((plan) => renderPlanCardHtml(plan, { interactive: true })).join("");
    return `<div class="plan-list">${cards}</div>`;
  }

  function getPlanById(planId) {
    if (!cache.plans || !planId) {
      return null;
    }
    return cache.plans.find((p) => p.Id === planId) || null;
  }

  async function fetchTokenUsage(user, planId) {
    const db = await authApi().getFirestore();
    const snap = await db
      .collection("Users")
      .doc(user.uid)
      .collection("UserPlans")
      .doc(planId)
      .collection("TokensUsage")
      .orderBy("Date", "asc")
      .get();
    return snap.docs.map((doc) => ({ Id: doc.id, ...doc.data() }));
  }

  function renderTokenUsageRowsHtml(usages) {
    if (!usages.length) {
      return `<p class="account-empty">${t(
        "account.plan.usage.empty",
        "Todavía no hay actividad registrada en este plan."
      )}</p>`;
    }

    const rows = usages
      .map((usage) => {
        const query = escapeHtml(usage.QueryText || "—");
        const date = escapeHtml(formatDateTime(usage.Date));
        return `<div class="plan-usage-row">
          <div class="plan-usage-row__query">${query}</div>
          <div class="plan-usage-row__date">${date}</div>
        </div>`;
      })
      .join("");

    return `<div class="plan-usage-table" role="table" aria-label="${escapeHtml(
      t("account.plan.usage.title", "Actividad del plan")
    )}">
      <div class="plan-usage-table__head" role="row">
        <div class="plan-usage-table__query" role="columnheader">${t(
          "account.plan.usage.query",
          "Consulta"
        )}</div>
        <div class="plan-usage-table__date" role="columnheader">${t(
          "account.plan.usage.date",
          "Fecha"
        )}</div>
      </div>
      <div class="plan-usage-table__body">${rows}</div>
    </div>
    <p class="plan-usage-count">${t("account.plan.usage.loaded", "{loaded} / {total} registros cargados")
      .split("{loaded}")
      .join(String(usages.length))
      .split("{total}")
      .join(String(usages.length))}</p>`;
  }

  function renderPlanDetailHtml(plan, usages) {
    return `<div class="plan-detail">
      <div class="plan-detail__intro">
        <h2 class="plan-detail__title">${t("account.plan.detail.title", "Detalle del Plan")}</h2>
        <p class="plan-detail__subtitle">${t(
          "account.plan.detail.subtitle",
          "Detalle del plan y actividad registrada."
        )}</p>
      </div>
      ${renderPlanCardHtml(plan, { interactive: false })}
      ${renderTokenUsageRowsHtml(usages || [])}
      <div class="plan-detail__actions">
        <button type="button" class="btn-secondary" data-close-plan-detail>${t(
          "account.plan.detail.back",
          "Anterior"
        )}</button>
      </div>
    </div>`;
  }

  function renderPaymentsHtml(payments) {
    if (!payments.length) {
      return `<p class="account-empty">${t(
        "account.payment.empty",
        "Todavía no hay pagos registrados."
      )}</p>`;
    }

    const rows = payments
      .slice()
      .sort((a, b) => (toDate(b.CreatedAt)?.getTime() || 0) - (toDate(a.CreatedAt)?.getTime() || 0))
      .map((payment) => {
        const method = payment.PaymentMethod || payment.PaymentMethodStatus || "—";
        return `<tr>
          <td>${formatDate(payment.CreatedAt)}</td>
          <td>${formatMoney(payment.Amount, payment.Currency)}</td>
          <td>${escapeHtml(methodLabel(method))}</td>
          <td>${escapeHtml(paymentStatusLabel(payment.PaymentStatus))}</td>
        </tr>`;
      })
      .join("");

    return `
      <div class="account-table-wrap">
        <table class="account-table">
          <thead>
            <tr>
              <th>${t("account.payment.date", "Fecha")}</th>
              <th>${t("account.payment.amount", "Importe")}</th>
              <th>${t("account.payment.method", "Método")}</th>
              <th>${t("account.payment.status", "Estado")}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function clearCache() {
    cache.uid = null;
    cache.profile = null;
    cache.plans = null;
    cache.payments = null;
  }

  function getStorageBucket() {
    const cfg = global.TourAiSite?.config?.firebaseAuth;
    if (cfg?.storageBucket) {
      return String(cfg.storageBucket).trim();
    }
    if (cfg?.projectId) {
      return String(cfg.projectId).trim() + ".firebasestorage.app";
    }
    return "";
  }

  function profilePhotoUrls(profile, user) {
    const uid = user?.uid || profile?.Id || "";
    const urls = [];
    const seen = Object.create(null);
    function add(url) {
      const value = String(url || "").trim();
      if (!value || seen[value]) {
        return;
      }
      seen[value] = true;
      urls.push(value);
    }
    add(profile?.PhotoOriginalUrl);
    add(user?.photoURL);
    const bucket = getStorageBucket();
    if (bucket && uid) {
      add(
        "https://firebasestorage.googleapis.com/v0/b/" +
          encodeURIComponent(bucket) +
          "/o/" +
          encodeURIComponent("userPhotoOriginal_" + uid + ".jpg") +
          "?alt=media"
      );
    }
    return urls;
  }

  function profileInitials(name, email) {
    const n = String(name || "").trim();
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      }
      if (n.length >= 2) {
        return n.slice(0, 2).toUpperCase();
      }
      return (n.charAt(0) + n.charAt(0)).toUpperCase();
    }
    const local = String(email || "").split("@")[0];
    if (local.length >= 2) {
      return local.slice(0, 2).toUpperCase();
    }
    return "?";
  }

  function formatBirthDateInput(value) {
    const date = toDate(value);
    if (!date) {
      return "";
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function profilePhotoViewport() {
    return { size: 120, radius: 58 };
  }

  function normalizePhotoCrop(cropOrProfile) {
    const offsetX = Number(
      cropOrProfile?.offsetXNorm ?? cropOrProfile?.PhotoCropOffsetXNorm
    );
    const offsetY = Number(
      cropOrProfile?.offsetYNorm ?? cropOrProfile?.PhotoCropOffsetYNorm
    );
    const scaleRaw = Number(
      cropOrProfile?.userScale ?? cropOrProfile?.PhotoCropUserScale
    );
    return {
      offsetXNorm: Number.isFinite(offsetX) ? offsetX : 0,
      offsetYNorm: Number.isFinite(offsetY) ? offsetY : 0,
      userScale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1,
    };
  }

  function clampPhotoCrop(crop, naturalWidth, naturalHeight) {
    const viewport = profilePhotoViewport();
    const next = normalizePhotoCrop(crop);
    const width = Number(naturalWidth) || 0;
    const height = Number(naturalHeight) || 0;
    if (width <= 0 || height <= 0 || viewport.radius <= 0) {
      return next;
    }
    const halfW = (width * next.userScale) / 2;
    const halfH = (height * next.userScale) / 2;
    const maxX = Math.max(0, halfW - viewport.radius);
    const maxY = Math.max(0, halfH - viewport.radius);
    let offsetX = next.offsetXNorm * viewport.radius;
    let offsetY = next.offsetYNorm * viewport.radius;
    offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
    offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
    return {
      offsetXNorm: offsetX / viewport.radius,
      offsetYNorm: offsetY / viewport.radius,
      userScale: next.userScale,
    };
  }

  function profilePhotoCropStyle(cropOrProfile) {
    const viewport = profilePhotoViewport();
    const crop = normalizePhotoCrop(cropOrProfile);
    return (
      "transform: translate(calc(-50% + " +
      crop.offsetXNorm * viewport.radius +
      "px), calc(-50% + " +
      crop.offsetYNorm * viewport.radius +
      "px)) scale(" +
      crop.userScale +
      ");"
    );
  }

  function renderProfileCardHtml(profile, user) {
    const displayName =
      (profile.DisplayName && String(profile.DisplayName).trim()) ||
      t("account.profile.noName", "Sin nombre");
    const email = profile.Email || profile.AuthEmail || user?.email || "—";
    const accountType = profile.AccountType || "Freemium";
    const typeLabel =
      accountType === "Premium"
        ? t("account.profile.type.premium", "Premium")
        : t("account.profile.type.freemium", "Freemium");
    const birth = formatDate(profile.BirthDate);
    const initials = escapeHtml(profileInitials(displayName, email));
    const photoUrls = profilePhotoUrls(profile, user);
    const photoAttr = photoUrls.length
      ? ` data-photo-urls="${escapeHtml(photoUrls.join("|"))}" data-photo-crop="${escapeHtml(profilePhotoCropStyle(profile))}"`
      : "";

    return `<article class="profile-card">
      <div class="profile-card__identity">
        <div class="profile-card__avatar" aria-hidden="true"${photoAttr}>
          <span class="profile-card__initials">${initials}</span>
        </div>
        <div class="profile-card__titles">
          <h2 class="profile-card__name">${escapeHtml(displayName)}</h2>
          <p class="profile-card__email">${escapeHtml(email)}</p>
        </div>
      </div>
      <div class="profile-card__divider" aria-hidden="true"></div>
      <dl class="profile-card__metrics">
        <div>
          <dt>${t("account.profile.type", "Tipo de cuenta")}</dt>
          <dd class="profile-card__metric-accent">${escapeHtml(typeLabel.toUpperCase())}</dd>
        </div>
        <div>
          <dt>${t("account.profile.birthDate", "Fecha de nacimiento (opcional)")}</dt>
          <dd class="profile-card__metric-date">${escapeHtml(birth)}</dd>
        </div>
      </dl>
      <div class="profile-card__actions">
        <button type="button" class="btn-primary" id="accountEditOpen" data-i18n="account.edit">Editar cuenta</button>
      </div>
    </article>`;
  }

  async function uploadProfilePhoto(user, jpegBlob) {
    if (!user?.uid) {
      throw new Error("NO_USER");
    }
    if (!jpegBlob || !jpegBlob.size) {
      throw new Error("PHOTO_REQUIRED");
    }
    if (jpegBlob.size >= 5 * 1024 * 1024) {
      throw new Error("PHOTO_TOO_LARGE");
    }

    const bucket = getStorageBucket();
    if (!bucket) {
      throw new Error("STORAGE_BUCKET_MISSING");
    }

    const token = await user.getIdToken();
    const objectName = "userPhotoOriginal_" + user.uid + ".jpg";
    const uploadUrl =
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(bucket) +
      "/o?uploadType=media&name=" +
      encodeURIComponent(objectName);

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "image/jpeg",
      },
      body: jpegBlob,
    });
    const responseText = await response.text();
    if (!response.ok) {
      const err = new Error("PHOTO_UPLOAD_FAILED");
      err.details = responseText;
      throw err;
    }

    let downloadToken = "";
    try {
      const parsed = JSON.parse(responseText);
      downloadToken = parsed.downloadTokens || "";
    } catch {
      downloadToken = "";
    }

    if (downloadToken) {
      return (
        "https://firebasestorage.googleapis.com/v0/b/" +
        encodeURIComponent(bucket) +
        "/o/" +
        encodeURIComponent(objectName) +
        "?alt=media&token=" +
        encodeURIComponent(downloadToken)
      );
    }

    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(bucket) +
      "/o/" +
      encodeURIComponent(objectName) +
      "?alt=media"
    );
  }

  function fileToJpegBlob(file, maxEdge) {
    const edge = maxEdge || 2048;
    return new Promise(function (resolve, reject) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        reject(new Error("PHOTO_INVALID"));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          if (!width || !height) {
            reject(new Error("PHOTO_INVALID"));
            return;
          }
          const scale = Math.min(1, edge / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            function (blob) {
              URL.revokeObjectURL(objectUrl);
              if (!blob) {
                reject(new Error("PHOTO_INVALID"));
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            0.9
          );
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("PHOTO_INVALID"));
      };
      img.src = objectUrl;
    });
  }

  async function saveProfile(user, fields) {
    const db = await authApi().getFirestore();
    const payload = {};
    const displayName = String(fields.displayName || "").trim();
    if (!displayName) {
      throw new Error("DISPLAY_NAME_REQUIRED");
    }
    payload.DisplayName = displayName;

    if (fields.birthDateEnabled && fields.birthDate) {
      const date = toDate(fields.birthDate);
      if (!date) {
        throw new Error("BIRTHDATE_INVALID");
      }
      payload.BirthDate = global.firebase.firestore.Timestamp.fromDate(date);
    } else {
      payload.BirthDate = global.firebase.firestore.FieldValue.delete();
    }

    if (fields.photoBlob) {
      const photoUrl = await uploadProfilePhoto(user, fields.photoBlob);
      payload.PhotoOriginalUrl = photoUrl;
    }

    if (fields.photoCrop) {
      const crop = clampPhotoCrop(
        fields.photoCrop,
        fields.photoNaturalWidth,
        fields.photoNaturalHeight
      );
      payload.PhotoCropOffsetXNorm = crop.offsetXNorm;
      payload.PhotoCropOffsetYNorm = crop.offsetYNorm;
      payload.PhotoCropUserScale = crop.userScale;
    } else if (fields.photoBlob) {
      payload.PhotoCropOffsetXNorm = 0;
      payload.PhotoCropOffsetYNorm = 0;
      payload.PhotoCropUserScale = 1;
    }

    await db.collection("Users").doc(user.uid).update(payload);
    await authApi().updateProfile(displayName);

    cache.profile = null;
    return fetchProfile(user);
  }

  global.TourAiAccountData = {
    t,
    fetchProfile,
    fetchPlans,
    fetchPayments,
    fetchTokenUsage,
    getPlanById,
    saveProfile,
    fileToJpegBlob,
    formatBirthDateInput,
    profilePhotoUrls,
    profilePhotoCropStyle,
    normalizePhotoCrop,
    clampPhotoCrop,
    profilePhotoViewport,
    profileInitials,
    renderProfileCardHtml,
    renderActivePlanHtml,
    renderPlansHtml,
    renderPlanDetailHtml,
    renderPaymentsHtml,
    clearCache,
  };
})(window);
