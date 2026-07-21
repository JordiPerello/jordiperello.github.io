/*
 * Shared Firebase Auth + Firestore helpers for TourAI web account pages.
 * Requires site-config (+ secrets) and firebase-app/auth/firestore compat scripts.
 */
(function (global) {
  const TourAiAuth = {
    _ready: null,

    t(key, fallback) {
      const locale = global.TourAiI18n?.getLocale?.();
      return global.TourAiI18n?.tOr?.(key, locale, null, fallback) ?? fallback;
    },

    getFirebaseConfig() {
      const cfg = global.TourAiSite?.config?.firebaseAuth;
      if (!cfg?.apiKey || !cfg?.authDomain || !cfg?.projectId) {
        return null;
      }
      return {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
      };
    },

    ensureFirebase() {
      if (this._ready) {
        return this._ready;
      }

      this._ready = new Promise((resolve, reject) => {
        if (global.location?.protocol === "file:") {
          reject(new Error("FILE_PROTOCOL"));
          return;
        }
        const firebaseConfig = this.getFirebaseConfig();
        if (!firebaseConfig) {
          reject(new Error("CONFIG_MISSING"));
          return;
        }
        if (!global.firebase?.auth) {
          reject(new Error("FIREBASE_SDK_MISSING"));
          return;
        }
        if (!global.firebase.apps?.length) {
          global.firebase.initializeApp(firebaseConfig);
        }
        resolve(global.firebase.auth());
      }).catch((err) => {
        // Allow retry after fixing config / protocol (do not cache failures forever).
        this._ready = null;
        throw err;
      });

      return this._ready;
    },

    async getFirestore() {
      await this.ensureFirebase();
      if (!global.firebase?.firestore) {
        throw new Error("FIRESTORE_SDK_MISSING");
      }
      return global.firebase.firestore();
    },

    onAuthStateChanged(callback) {
      return this.ensureFirebase().then((auth) => {
        return auth.onAuthStateChanged(callback);
      });
    },

    currentUser() {
      return global.firebase?.auth?.()?.currentUser ?? null;
    },

    async signIn(email, password) {
      const auth = await this.ensureFirebase();
      return auth.signInWithEmailAndPassword(email, password);
    },

    async signUp(email, password) {
      const auth = await this.ensureFirebase();
      return auth.createUserWithEmailAndPassword(email, password);
    },

    async updateProfile(displayName) {
      const user = this.currentUser();
      if (!user) {
        throw new Error("NO_USER");
      }
      return user.updateProfile({ displayName: displayName || null });
    },

    async signOut() {
      const auth = await this.ensureFirebase();
      return auth.signOut();
    },

    async sendPasswordReset(email) {
      const auth = await this.ensureFirebase();
      return auth.sendPasswordResetEmail(email);
    },

    requireUser({ loginUrl = "login.html", next } = {}) {
      return this.onAuthStateChanged((user) => {
        if (!user) {
          const target = new URL(loginUrl, global.location.href);
          if (next) {
            target.searchParams.set("next", next);
          }
          global.location.replace(target.toString());
        }
      });
    },

    redirectIfSignedIn(url = "account.html") {
      return this.onAuthStateChanged((user) => {
        if (user) {
          global.location.replace(url);
        }
      });
    },

    mapAuthError(error) {
      const code = error?.code || error?.message || "";
      switch (code) {
        case "auth/email-already-in-use":
          return this.t("register.error.emailInUse", "Ya existe una cuenta con ese correo.");
        case "auth/weak-password":
          return this.t("register.error.weakPassword", "La contraseña es demasiado débil.");
        case "auth/operation-not-allowed":
          return this.t("register.error.notAllowed", "El registro por correo no está habilitado.");
        case "auth/invalid-email":
          return this.t("login.error.invalidEmail", "Introduce un correo válido.");
        case "auth/user-disabled":
          return this.t("login.error.disabled", "Esta cuenta está deshabilitada.");
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          return this.t("login.error.credentials", "Correo o contraseña incorrectos.");
        case "auth/too-many-requests":
          return this.t("login.error.rateLimited", "Demasiados intentos. Espera unos minutos.");
        case "auth/network-request-failed":
          return this.t("login.error.network", "Error de red. Comprueba tu conexión.");
        case "CONFIG_MISSING":
        case "FIREBASE_SDK_MISSING":
        case "FIRESTORE_SDK_MISSING":
          return this.t(
            "login.error.config",
            "Configuración de acceso no disponible. En local, copia js/site-config.secrets.js y sirve la web por http://localhost (no abras el HTML a pelo)."
          );
        case "FILE_PROTOCOL":
          return this.t(
            "login.error.fileProtocol",
            "Firebase Auth no funciona con file://. Abre la web con un servidor local (por ejemplo: npx serve) o en https://tourai.es tras desplegar."
          );
        case "auth/unauthorized-domain":
          return this.t(
            "login.error.unauthorizedDomain",
            "Este dominio no está autorizado en Firebase Authentication."
          );
        case "permission-denied":
          return this.t("account.error.permission", "No tienes permiso para leer estos datos.");
        default:
          if (String(code).includes("permission")) {
            return this.t("account.error.permission", "No tienes permiso para leer estos datos.");
          }
          return this.t("login.error.generic", "No se pudo iniciar sesión. Inténtalo de nuevo.");
      }
    },
  };

  global.TourAiAuth = TourAiAuth;
})(window);
