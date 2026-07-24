(function () {
  const auth = window.TourAiAuth;
  const data = window.TourAiAccountData;
  const statusEl = document.getElementById("accountStatus");
  const signedInPanel = document.getElementById("accountSignedIn");
  const loadingPanel = document.getElementById("accountLoading");
  const profileMount = document.getElementById("accountProfileMount");
  const logoutBtn = document.getElementById("accountLogout");
  const editModal = document.getElementById("accountEditModal");
  const editForm = document.getElementById("accountEditForm");
  const editEmail = document.getElementById("editEmail");
  const editDisplayName = document.getElementById("editDisplayName");
  const editDisplayNameError = document.getElementById("editDisplayNameError");
  const editBirthDateEnabled = document.getElementById("editBirthDateEnabled");
  const editBirthDate = document.getElementById("editBirthDate");
  const editBirthDateError = document.getElementById("editBirthDateError");
  const editBirthDateField = document.getElementById("editBirthDateField");
  const editBirthDateVisible = document.getElementById("editBirthDateVisible");
  const editStatusEl = document.getElementById("accountEditStatus");
  const editSaveBtn = document.getElementById("accountEditSave");
  const editPhotoPreview = document.getElementById("editPhotoPreview");
  const editPhotoInitials = document.getElementById("editPhotoInitials");
  const editPhotoPick = document.getElementById("editPhotoPick");
  const editPhotoClear = document.getElementById("editPhotoClear");
  const editPhotoFile = document.getElementById("editPhotoFile");
  const editPhotoError = document.getElementById("editPhotoError");
  const passwordModal = document.getElementById("accountPasswordModal");
  const passwordForm = document.getElementById("accountPasswordForm");
  const pwdCurrent = document.getElementById("pwdCurrent");
  const pwdNew = document.getElementById("pwdNew");
  const pwdConfirm = document.getElementById("pwdConfirm");
  const pwdCurrentError = document.getElementById("pwdCurrentError");
  const pwdNewError = document.getElementById("pwdNewError");
  const pwdStrength = document.getElementById("pwdStrength");
  const pwdStrengthLabel = document.getElementById("pwdStrengthLabel");
  const passwordStatusEl = document.getElementById("accountPasswordStatus");
  const passwordSaveBtn = document.getElementById("accountPasswordSave");

  let currentUser = null;
  let currentProfile = null;
  let saveBusy = false;
  let passwordBusy = false;
  let pendingPhotoBlob = null;
  let pendingPhotoObjectUrl = null;
  let editPhotoCrop = { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 };
  let editPhotoCropDirty = false;
  let editPhotoNatural = { width: 0, height: 0 };
  let photoPan = null;
  const PHOTO_PAN_SLOP_PX = 8;

  if (!auth || !data) {
    return;
  }

  function t(key, fallback) {
    return data.t(key, fallback);
  }

  let birthDatePicker = null;
  let birthDatePickerLocale = null;

  function ensureBirthDatePicker() {
    const locale = window.TourAiI18n?.getLocale?.() || "es-ES";
    if (birthDatePicker && birthDatePickerLocale === locale) {
      return birthDatePicker;
    }
    if (birthDatePicker) {
      try {
        birthDatePicker.destroy?.();
      } catch (_) {
        /* ignore */
      }
      birthDatePicker = null;
    }
    if (!window.TourAiBirthdatePicker?.create) {
      return null;
    }
    try {
      birthDatePicker =
        window.TourAiBirthdatePicker.create({
          root: editBirthDateField,
          input: editBirthDate,
          visible: editBirthDateVisible,
          t: t,
        }) || null;
      birthDatePickerLocale = birthDatePicker ? locale : null;
    } catch (err) {
      console.error("[TourAI] birthdate picker create failed", err);
      birthDatePicker = null;
      birthDatePickerLocale = null;
    }
    return birthDatePicker;
  }

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function setEditStatus(message, isError) {
    if (!editStatusEl) {
      return;
    }
    editStatusEl.textContent = message || "";
    editStatusEl.classList.toggle("error", !!isError);
  }

  function setPasswordStatus(message, isError) {
    if (!passwordStatusEl) {
      return;
    }
    passwordStatusEl.textContent = message || "";
    passwordStatusEl.classList.toggle("error", !!isError);
  }

  function showSignedIn() {
    if (loadingPanel) {
      loadingPanel.hidden = true;
    }
    if (signedInPanel) {
      signedInPanel.hidden = false;
    }
  }

  function redirectToLogin() {
    if (typeof auth.forceSignedOutNav === "function") {
      auth.forceSignedOutNav();
    } else if (typeof auth.clearNavProfileCache === "function") {
      auth.clearNavProfileCache();
    }
    const target = new URL("login.html", window.location.href);
    target.searchParams.set("next", "account.html");
    window.location.replace(target.toString());
  }

  function hydrateProfileAvatar(root) {
    const avatar = root?.querySelector?.(".profile-card__avatar[data-photo-urls]");
    if (!avatar) {
      return;
    }
    const urls = String(avatar.getAttribute("data-photo-urls") || "")
      .split("|")
      .map(function (u) {
        return u.trim();
      })
      .filter(Boolean);
    if (!urls.length) {
      return;
    }
    const cropStyle = avatar.getAttribute("data-photo-crop") || "";

    let index = 0;
    function tryNext() {
      if (index >= urls.length) {
        return;
      }
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      if (cropStyle) {
        img.setAttribute("style", cropStyle);
      }
      img.addEventListener("load", function () {
        avatar.textContent = "";
        avatar.appendChild(img);
      });
      img.addEventListener("error", function () {
        index += 1;
        tryNext();
      });
      img.src = urls[index];
    }
    tryNext();
  }

  function getEditPhotoImg() {
    return editPhotoPreview?.querySelector?.("img") || null;
  }

  function applyEditPhotoCropStyle() {
    const img = getEditPhotoImg();
    if (!img) {
      return;
    }
    editPhotoCrop = data.clampPhotoCrop(
      editPhotoCrop,
      editPhotoNatural.width,
      editPhotoNatural.height
    );
    img.setAttribute("style", data.profilePhotoCropStyle(editPhotoCrop));
  }

  function setEditPhotoHasPhoto(hasPhoto) {
    if (!editPhotoPreview) {
      return;
    }
    editPhotoPreview.classList.toggle("has-photo", !!hasPhoto);
    editPhotoPreview.classList.remove("is-panning");
  }

  function setEditPhotoPreview(url, initials, crop) {
    if (!editPhotoPreview) {
      return;
    }
    editPhotoPreview.textContent = "";
    photoPan = null;
    if (url) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.referrerPolicy = "no-referrer";
      img.src = url;
      editPhotoCrop = data.normalizePhotoCrop(
        crop || { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 }
      );
      img.addEventListener("load", function () {
        editPhotoNatural = {
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
        };
        applyEditPhotoCropStyle();
      });
      img.addEventListener("error", function () {
        editPhotoNatural = { width: 0, height: 0 };
        editPhotoPreview.textContent = "";
        setEditPhotoHasPhoto(false);
        const span = document.createElement("span");
        span.className = "account-edit-form__photo-initials";
        span.textContent = initials || "?";
        editPhotoPreview.appendChild(span);
      });
      editPhotoPreview.appendChild(img);
      setEditPhotoHasPhoto(true);
      if (img.complete && img.naturalWidth) {
        editPhotoNatural = {
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
        };
        applyEditPhotoCropStyle();
      }
      return;
    }
    editPhotoNatural = { width: 0, height: 0 };
    setEditPhotoHasPhoto(false);
    const span = document.createElement("span");
    span.className = "account-edit-form__photo-initials";
    span.id = "editPhotoInitials";
    span.textContent = initials || "?";
    editPhotoPreview.appendChild(span);
  }

  function loadCurrentPhotoIntoEditPreview() {
    const email = currentProfile?.Email || currentProfile?.AuthEmail || currentUser?.email || "";
    const name = currentProfile?.DisplayName || "";
    const initials = data.profileInitials(name, email);
    const urls = data.profilePhotoUrls(currentProfile || {}, currentUser);
    editPhotoCropDirty = false;
    if (!urls.length) {
      editPhotoCrop = { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 };
      setEditPhotoPreview("", initials);
      return;
    }
    editPhotoCrop = data.normalizePhotoCrop(currentProfile || {});
    setEditPhotoPreview(urls[0], initials, editPhotoCrop);
  }

  function openPhotoPicker() {
    editPhotoFile?.click();
  }

  function onPhotoPointerDown(event) {
    if (!editPhotoPreview || !getEditPhotoImg()) {
      return;
    }
    if (event.button != null && event.button !== 0) {
      return;
    }
    event.preventDefault();
    const viewport = data.profilePhotoViewport();
    photoPan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: editPhotoCrop.offsetXNorm * viewport.radius,
      startOffsetY: editPhotoCrop.offsetYNorm * viewport.radius,
      moved: false,
    };
    editPhotoPreview.classList.add("is-panning");
    try {
      editPhotoPreview.setPointerCapture(event.pointerId);
    } catch (_) {
      /* ignore */
    }
  }

  function onPhotoPointerMove(event) {
    if (!photoPan || photoPan.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - photoPan.startX;
    const dy = event.clientY - photoPan.startY;
    if (!photoPan.moved) {
      if (Math.hypot(dx, dy) < PHOTO_PAN_SLOP_PX) {
        return;
      }
      photoPan.moved = true;
    }
    event.preventDefault();
    const viewport = data.profilePhotoViewport();
    editPhotoCrop = data.clampPhotoCrop(
      {
        offsetXNorm: (photoPan.startOffsetX + dx) / viewport.radius,
        offsetYNorm: (photoPan.startOffsetY + dy) / viewport.radius,
        userScale: editPhotoCrop.userScale,
      },
      editPhotoNatural.width,
      editPhotoNatural.height
    );
    editPhotoCropDirty = true;
    applyEditPhotoCropStyle();
  }

  function onPhotoPointerUp(event) {
    if (!photoPan || photoPan.pointerId !== event.pointerId) {
      return;
    }
    const wasTap = !photoPan.moved;
    photoPan = null;
    editPhotoPreview?.classList.remove("is-panning");
    try {
      editPhotoPreview?.releasePointerCapture(event.pointerId);
    } catch (_) {
      /* ignore */
    }
    if (wasTap) {
      openPhotoPicker();
    }
  }

  function renderProfile() {
    if (!profileMount || !currentUser || !currentProfile) {
      return;
    }
    profileMount.innerHTML = data.renderProfileCardHtml(currentProfile, currentUser);
    hydrateProfileAvatar(profileMount);
    if (window.TourAiI18n?.applyTranslations && window.TourAiI18n?.getLocale) {
      window.TourAiI18n.applyTranslations(window.TourAiI18n.getLocale());
    }
  }

  function revokePendingPhotoPreview() {
    if (pendingPhotoObjectUrl) {
      URL.revokeObjectURL(pendingPhotoObjectUrl);
      pendingPhotoObjectUrl = null;
    }
  }

  function resetPendingPhoto() {
    pendingPhotoBlob = null;
    revokePendingPhotoPreview();
    photoPan = null;
    if (editPhotoFile) {
      editPhotoFile.value = "";
    }
    if (editPhotoClear) {
      editPhotoClear.hidden = true;
    }
    if (editPhotoError) {
      editPhotoError.hidden = true;
    }
  }

  function syncBirthDateEnabled() {
    if (!editBirthDate || !editBirthDateEnabled) {
      return;
    }
    const enabled = !!editBirthDateEnabled.checked;
    const birthBlock = editBirthDateEnabled.closest(".account-edit-form__birth");
    if (birthBlock) {
      birthBlock.classList.toggle("is-disabled", !enabled);
    }
    const picker = ensureBirthDatePicker();
    if (picker) {
      picker.setEnabled(enabled);
    } else {
      editBirthDate.disabled = !enabled;
      if (editBirthDateVisible) {
        editBirthDateVisible.disabled = !enabled;
      }
    }
    if (!enabled) {
      editBirthDateError.hidden = true;
    }
  }

  function updatePasswordStrengthUi() {
    const strength = window.TourAiPasswordStrength;
    if (!strength || !pwdNew || !pwdStrength || !pwdStrengthLabel) {
      return;
    }
    const password = pwdNew.value || "";
    const level = password ? strength.evaluate(password) : strength.Level.None;
    const strengthBars = pwdStrength.querySelectorAll(".auth-password-strength__bar");

    pwdStrength.hidden = level === strength.Level.None;
    strengthBars.forEach(function (bar) {
      bar.classList.remove("is-active", "is-weak", "is-medium", "is-strong");
    });
    pwdStrengthLabel.classList.remove("is-weak", "is-medium", "is-strong");

    if (level === strength.Level.Weak) {
      strengthBars[0]?.classList.add("is-active", "is-weak");
      pwdStrengthLabel.textContent = t("resetPassword.strength.weak", "Débil");
      pwdStrengthLabel.classList.add("is-weak");
    } else if (level === strength.Level.Medium) {
      strengthBars[0]?.classList.add("is-active", "is-medium");
      strengthBars[1]?.classList.add("is-active", "is-medium");
      pwdStrengthLabel.textContent = t("resetPassword.strength.medium", "Media");
      pwdStrengthLabel.classList.add("is-medium");
    } else if (level === strength.Level.Strong) {
      strengthBars[0]?.classList.add("is-active", "is-strong");
      strengthBars[1]?.classList.add("is-active", "is-strong");
      strengthBars[2]?.classList.add("is-active", "is-strong");
      pwdStrengthLabel.textContent = t("resetPassword.strength.strong", "Fuerte");
      pwdStrengthLabel.classList.add("is-strong");
    } else {
      pwdStrengthLabel.textContent = "";
    }
  }

  function openEditModal() {
    if (!editModal || !currentProfile || !currentUser) {
      return;
    }
    editEmail.value = currentProfile.Email || currentProfile.AuthEmail || currentUser.email || "";
    editDisplayName.value = currentProfile.DisplayName || "";
    editDisplayNameError.hidden = true;
    editBirthDateError.hidden = true;
    resetPendingPhoto();
    loadCurrentPhotoIntoEditPreview();

    editModal.hidden = false;
    editModal.classList.add("is-open");
    editModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    const birthValue = data.formatBirthDateInput(currentProfile.BirthDate);
    editBirthDateEnabled.checked = !!birthValue;
    try {
      const picker = ensureBirthDatePicker();
      if (picker) {
        picker.setValue(birthValue);
      } else if (editBirthDate) {
        editBirthDate.value = birthValue;
        if (editBirthDateVisible) {
          editBirthDateVisible.value = birthValue || "";
        }
      }
      syncBirthDateEnabled();
    } catch (err) {
      console.error("[TourAI] birthdate setup failed", err);
      if (editBirthDate) {
        editBirthDate.value = birthValue;
        editBirthDate.disabled = !editBirthDateEnabled.checked;
      }
      if (editBirthDateVisible) {
        editBirthDateVisible.value = birthValue || "";
        editBirthDateVisible.disabled = !editBirthDateEnabled.checked;
      }
    }

    setEditStatus("", false);
    editDisplayName.focus();
  }

  function closeEditModal() {
    if (!editModal) {
      return;
    }
    birthDatePicker?.close?.();
    closePasswordModal();
    resetPendingPhoto();
    editModal.classList.remove("is-open");
    editModal.hidden = true;
    editModal.setAttribute("aria-hidden", "true");
    if (!passwordModal?.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
  }

  function resetPasswordForm() {
    if (pwdCurrent) {
      pwdCurrent.value = "";
    }
    if (pwdNew) {
      pwdNew.value = "";
    }
    if (pwdConfirm) {
      pwdConfirm.value = "";
    }
    if (pwdCurrentError) {
      pwdCurrentError.hidden = true;
    }
    if (pwdNewError) {
      pwdNewError.hidden = true;
    }
    setPasswordStatus("", false);
    updatePasswordStrengthUi();
  }

  function openPasswordModal() {
    if (!passwordModal || !currentUser) {
      return;
    }
    resetPasswordForm();
    passwordModal.hidden = false;
    passwordModal.classList.add("is-open");
    passwordModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    pwdCurrent?.focus();
  }

  function closePasswordModal() {
    if (!passwordModal) {
      return;
    }
    resetPasswordForm();
    passwordModal.classList.remove("is-open");
    passwordModal.hidden = true;
    passwordModal.setAttribute("aria-hidden", "true");
    if (!editModal?.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
  }

  function validateEditForm() {
    let ok = true;
    const name = (editDisplayName.value || "").trim();
    if (!name) {
      editDisplayNameError.textContent = t(
        "account.edit.error.displayName",
        "El nombre es obligatorio."
      );
      editDisplayNameError.hidden = false;
      ok = false;
    } else {
      editDisplayNameError.hidden = true;
    }

    if (editBirthDateEnabled.checked) {
      if (!editBirthDate.value) {
        editBirthDateError.textContent = t(
          "account.edit.error.birthDate",
          "Indica una fecha de nacimiento válida."
        );
        editBirthDateError.hidden = false;
        ok = false;
      } else {
        editBirthDateError.hidden = true;
      }
    } else {
      editBirthDateError.hidden = true;
    }

    return ok;
  }

  function validatePasswordForm() {
    let ok = true;
    const currentPassword = pwdCurrent?.value || "";
    const password = pwdNew?.value || "";
    const confirm = pwdConfirm?.value || "";

    if (pwdCurrentError) {
      pwdCurrentError.hidden = true;
    }
    if (pwdNewError) {
      pwdNewError.hidden = true;
    }

    if (!currentPassword) {
      if (pwdCurrentError) {
        pwdCurrentError.textContent = t(
          "account.passwordChange.error.currentRequired",
          "Introduce tu contraseña actual para verificar el cambio."
        );
        pwdCurrentError.hidden = false;
      }
      ok = false;
    }

    const strengthApi = window.TourAiPasswordStrength;
    const level = strengthApi ? strengthApi.evaluate(password) : 0;
    if (!password || !strengthApi || level < strengthApi.Level.Medium) {
      if (pwdNewError) {
        pwdNewError.textContent = t(
          "account.passwordChange.error.weak",
          "La contraseña debe ser al menos de nivel medio."
        );
        pwdNewError.hidden = false;
      }
      ok = false;
    } else if (password !== confirm) {
      if (pwdNewError) {
        pwdNewError.textContent = t(
          "account.passwordChange.error.mismatch",
          "Las contraseñas no coinciden."
        );
        pwdNewError.hidden = false;
      }
      ok = false;
    } else if (currentPassword && password === currentPassword) {
      if (pwdNewError) {
        pwdNewError.textContent = t(
          "account.passwordChange.error.same",
          "La nueva contraseña debe ser distinta de la actual."
        );
        pwdNewError.hidden = false;
      }
      ok = false;
    }

    return ok;
  }

  async function loadProfile(user) {
    currentProfile = await data.fetchProfile(user);
    renderProfile();
  }

  auth
    .onAuthStateChanged(async function (user) {
      if (!user) {
        redirectToLogin();
        return;
      }

      currentUser = user;
      showSignedIn();
      setStatus(t("account.loadingData", "Cargando tu perfil..."), false);
      try {
        await loadProfile(user);
        setStatus("", false);
      } catch (err) {
        console.error(err);
        setStatus(
          auth.mapAuthError(err) ||
            t("account.error.load", "No se pudieron cargar los datos de la cuenta."),
          true
        );
      }
    })
    .catch(function (err) {
      console.error(err);
      redirectToLogin();
    });

  logoutBtn?.addEventListener("click", async function () {
    setStatus(t("account.status.signingOut", "Cerrando sesión..."), false);
    try {
      data.clearCache();
      await auth.signOut();
      window.location.replace("login.html");
    } catch (err) {
      setStatus(auth.mapAuthError(err), true);
    }
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest("#accountEditOpen")) {
      openEditModal();
      return;
    }
    if (event.target.closest("#accountPasswordOpen")) {
      openPasswordModal();
      return;
    }
    if (event.target.closest("[data-close-account-password]") || event.target === passwordModal) {
      closePasswordModal();
      return;
    }
    if (event.target.closest("[data-close-account-edit]") || event.target === editModal) {
      closeEditModal();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
      return;
    }
    if (birthDatePicker?.isOpen?.()) {
      birthDatePicker.close();
      return;
    }
    if (passwordModal?.classList.contains("is-open")) {
      closePasswordModal();
      return;
    }
    if (editModal?.classList.contains("is-open")) {
      closeEditModal();
    }
  });

  editBirthDateEnabled?.addEventListener("change", syncBirthDateEnabled);
  pwdNew?.addEventListener("input", updatePasswordStrengthUi);

  editPhotoPick?.addEventListener("click", openPhotoPicker);

  editPhotoPreview?.addEventListener("pointerdown", onPhotoPointerDown);
  editPhotoPreview?.addEventListener("pointermove", onPhotoPointerMove);
  editPhotoPreview?.addEventListener("pointerup", onPhotoPointerUp);
  editPhotoPreview?.addEventListener("pointercancel", onPhotoPointerUp);
  editPhotoPreview?.addEventListener("click", function (event) {
    if (getEditPhotoImg()) {
      // Tap-to-pick is handled in pointerup; avoid double-open.
      event.preventDefault();
      return;
    }
    openPhotoPicker();
  });
  editPhotoPreview?.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPhotoPicker();
    }
  });

  editPhotoClear?.addEventListener("click", function () {
    resetPendingPhoto();
    loadCurrentPhotoIntoEditPreview();
  });

  editPhotoFile?.addEventListener("change", async function () {
    const file = editPhotoFile.files && editPhotoFile.files[0];
    if (!file) {
      return;
    }
    if (editPhotoError) {
      editPhotoError.hidden = true;
    }
    try {
      if (file.size >= 5 * 1024 * 1024) {
        throw new Error("PHOTO_TOO_LARGE");
      }
      const jpegBlob = await data.fileToJpegBlob(file, 2048);
      if (jpegBlob.size >= 5 * 1024 * 1024) {
        throw new Error("PHOTO_TOO_LARGE");
      }
      revokePendingPhotoPreview();
      pendingPhotoBlob = jpegBlob;
      pendingPhotoObjectUrl = URL.createObjectURL(jpegBlob);
      editPhotoCrop = { offsetXNorm: 0, offsetYNorm: 0, userScale: 1 };
      editPhotoCropDirty = true;
      setEditPhotoPreview(pendingPhotoObjectUrl, "?", editPhotoCrop);
      if (editPhotoClear) {
        editPhotoClear.hidden = false;
      }
    } catch (err) {
      console.error(err);
      resetPendingPhoto();
      loadCurrentPhotoIntoEditPreview();
      if (editPhotoError) {
        editPhotoError.textContent =
          err?.message === "PHOTO_TOO_LARGE"
            ? t("account.edit.photo.error.tooLarge", "La imagen supera 5 MB.")
            : t("account.edit.photo.error.invalid", "No se pudo leer la imagen seleccionada.");
        editPhotoError.hidden = false;
      }
    }
  });

  editForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (saveBusy || !currentUser) {
      return;
    }
    if (!validateEditForm()) {
      return;
    }

    saveBusy = true;
    if (editSaveBtn) {
      editSaveBtn.disabled = true;
    }
    setEditStatus(t("account.edit.saving", "Guardando cambios..."), false);

    try {
      const shouldSaveCrop = !!(pendingPhotoBlob || editPhotoCropDirty);
      currentProfile = await data.saveProfile(currentUser, {
        displayName: editDisplayName.value,
        birthDateEnabled: !!editBirthDateEnabled.checked,
        birthDate: editBirthDateEnabled.checked ? editBirthDate.value : null,
        photoBlob: pendingPhotoBlob || null,
        photoCrop: shouldSaveCrop ? editPhotoCrop : null,
        photoNaturalWidth: editPhotoNatural.width,
        photoNaturalHeight: editPhotoNatural.height,
      });
      resetPendingPhoto();
      editPhotoCropDirty = false;
      renderProfile();
      if (typeof auth.enrichNavProfile === "function") {
        try {
          await auth.enrichNavProfile(currentUser);
        } catch (navErr) {
          console.warn("[TourAI account] nav enrich failed", navErr);
        }
      }
      setEditStatus(t("account.edit.saved", "Cambios guardados."), false);
      setStatus(t("account.edit.saved", "Cambios guardados."), false);
      setTimeout(closeEditModal, 600);
    } catch (err) {
      console.error(err);
      let message = auth.mapAuthError(err);
      if (err?.message === "DISPLAY_NAME_REQUIRED") {
        message = t("account.edit.error.displayName", "El nombre es obligatorio.");
      } else if (err?.message === "BIRTHDATE_INVALID") {
        message = t("account.edit.error.birthDate", "Indica una fecha de nacimiento válida.");
      } else if (err?.message === "PHOTO_TOO_LARGE") {
        message = t("account.edit.photo.error.tooLarge", "La imagen supera 5 MB.");
      } else if (err?.message === "PHOTO_INVALID") {
        message = t("account.edit.photo.error.invalid", "No se pudo leer la imagen seleccionada.");
      } else if (err?.message === "PHOTO_UPLOAD_FAILED" || err?.message === "STORAGE_BUCKET_MISSING") {
        message = t(
          "account.edit.photo.error.upload",
          "No se pudo subir la foto de perfil. Inténtalo de nuevo."
        );
      }
      setEditStatus(
        message || t("account.edit.error.save", "No se pudieron guardar los cambios."),
        true
      );
    } finally {
      saveBusy = false;
      if (editSaveBtn) {
        editSaveBtn.disabled = false;
      }
    }
  });

  passwordForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (passwordBusy || !currentUser) {
      return;
    }
    if (!validatePasswordForm()) {
      return;
    }

    passwordBusy = true;
    if (passwordSaveBtn) {
      passwordSaveBtn.disabled = true;
    }
    setPasswordStatus(t("account.passwordChange.saving", "Actualizando contraseña..."), false);

    const currentPassword = (pwdCurrent?.value || "").trim();
    const newPassword = (pwdNew?.value || "").trim();

    try {
      await auth.changePassword(currentPassword, newPassword);
      setPasswordStatus(t("account.passwordChange.saved", "Contraseña actualizada."), false);
      setStatus(t("account.passwordChange.saved", "Contraseña actualizada."), false);
      setTimeout(closePasswordModal, 600);
    } catch (err) {
      console.error(err);
      let message = auth.mapAuthError(err);
      if (err?.code === "auth/wrong-password" || err?.code === "auth/invalid-credential") {
        message = t(
          "account.passwordChange.error.currentWrong",
          "La contraseña actual no es correcta."
        );
        if (pwdCurrentError) {
          pwdCurrentError.textContent = message;
          pwdCurrentError.hidden = false;
        }
      } else if (err?.code === "auth/requires-recent-login") {
        message = t(
          "account.passwordChange.error.recentLogin",
          "Por seguridad, vuelve a iniciar sesión para cambiar la contraseña."
        );
      } else if (err?.code === "auth/weak-password") {
        message = t(
          "account.passwordChange.error.weak",
          "La contraseña debe ser al menos de nivel medio."
        );
        if (pwdNewError) {
          pwdNewError.textContent = message;
          pwdNewError.hidden = false;
        }
      }
      setPasswordStatus(
        message || t("account.passwordChange.error.save", "No se pudo actualizar la contraseña."),
        true
      );
    } finally {
      passwordBusy = false;
      if (passwordSaveBtn) {
        passwordSaveBtn.disabled = false;
      }
    }
  });
})();
