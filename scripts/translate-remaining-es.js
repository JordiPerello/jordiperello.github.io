/**
 * Translate remaining es-ES keys that still equal en-GB (UI / forms).
 * Brand labels left identical on purpose (Instagram, Facebook, Premium, …).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");

function loadMessages(file, globalName) {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  globalThis.window = globalThis;
  return Function(`${code}; return window.${globalName};`)();
}

function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function serializeMessages(obj) {
  const keys = Object.keys(obj).sort();
  const lines = keys.map((key) => {
    const val = obj[key];
    if (typeof val === "string" && (val.includes("\n") || val.includes("'") || val.includes('"'))) {
      return `  ${JSON.stringify(key)}: \`${escapeJsString(val)}\`,`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(val)},`;
  });
  return (
    "/**\n * Spanish (es-ES) UI strings for TourAI web.\n * Keep in parity with js/locales/en-GB.js.\n */\n" +
    "window.TourAiEsESMessages = {\n" +
    lines.join("\n") +
    "\n};\n"
  );
}

// Pull Spanish from last committed HTML (before strip).
function extractFromGitHtml() {
  const map = {};
  const files = execSync("git ls-files *.html", { cwd: root, encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (const file of files) {
    let html = "";
    try {
      html = execSync(`git show HEAD:${file}`, {
        cwd: root,
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024,
      });
      // try utf8 then latin1
      let text = html.toString("utf8");
      if (text.includes("�") || /selecci.n|contrase.a/.test(text)) {
        text = html.toString("latin1");
      }
      html = text;
    } catch {
      continue;
    }
    const patterns = [
      /data-i18n="([^"]+)"[^>]*>([^<]*)</gi,
      /data-i18n="([^"]+)"[^>]*>\s*([^<]+?)\s*</gi,
      /<(?:label|span|p|h1|h2|h3|h4|button|a|option|title)[^>]*data-i18n="([^"]+)"[^>]*>([\s\S]*?)<\//gi,
      /data-i18n-placeholder="([^"]+)"[^>]*placeholder="([^"]*)"/gi,
      /placeholder="([^"]*)"[^>]*data-i18n-placeholder="([^"]+)"/gi,
      /data-i18n-doc-title="([^"]+)"[^>]*>([^<]*)</gi,
      /<title[^>]*data-i18n-doc-title="([^"]+)"[^>]*>([^<]*)<\/title>/gi,
      /data-i18n-meta="([^"]+)"[^>]*content="([^"]*)"/gi,
      /content="([^"]*)"[^>]*data-i18n-meta="([^"]+)"/gi,
    ];
    // Simple data-i18n text
    let m;
    const reText =
      /<([a-z0-9]+)([^>]*\bdata-i18n="([^"]+)"[^>]*)>([^<]*)<\/\1>/gi;
    while ((m = reText.exec(html))) {
      const key = m[3];
      const val = m[4].replace(/\s+/g, " ").trim();
      if (val) map[key] = val;
    }
    const rePh =
      /data-i18n-placeholder="([^"]+)"[^>]*\bplaceholder="([^"]*)"|placeholder="([^"]*)"[^>]*\bdata-i18n-placeholder="([^"]+)"/gi;
    while ((m = rePh.exec(html))) {
      const key = m[1] || m[4];
      const val = m[2] || m[3] || "";
      if (key && val) map[key] = val;
    }
    const reTitle =
      /<title[^>]*data-i18n-doc-title="([^"]+)"[^>]*>([^<]*)<\/title>/gi;
    while ((m = reTitle.exec(html))) {
      if (m[2].trim()) map[m[1]] = m[2].trim();
    }
    const reMeta =
      /<meta[^>]*data-i18n-meta="([^"]+)"[^>]*\bcontent="([^"]*)"|<meta[^>]*\bcontent="([^"]*)"[^>]*data-i18n-meta="([^"]+)"/gi;
    while ((m = reMeta.exec(html))) {
      const key = m[1] || m[4];
      const val = m[2] || m[3] || "";
      if (key && val) map[key] = val;
    }
    // data-i18n-html blocks
    const reHtml =
      /<([a-z0-9]+)([^>]*\bdata-i18n-html="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
    while ((m = reHtml.exec(html))) {
      const key = m[3];
      const val = m[4].trim();
      if (val) map[key] = val;
    }
  }
  return map;
}

const translations = {
  "reviews.pending.title": "Pendiente de moderación",
  "reviews.pending.empty": "No hay reseñas pendientes.",
  "reviews.approve": "Aprobar",
  "reviews.reject": "Rechazar",
  "reviews.approving": "Aprobando…",
  "reviews.rejecting": "Rechazando…",
  "reviews.approved": "Reseña aprobada.",
  "reviews.rejected": "Reseña rechazada.",
  "reviews.target.web": "Web",
  "reviews.target.app": "App",
  "community.cat.ideas": "Ideas",
  "community.blurb.news": "Novedades y anuncios de TourAI.",
  "community.blurb.ideas": "Comparte propuestas para mejorar el producto.",
  "community.blurb.travel": "Consejos y experiencias de viaje.",
  "community.loading": "Cargando…",
  "community.rte.size.normal": "Normal",
  "community.replies": "Respuestas",
  "community.replyTo.label": "Responder a",
  "community.confirm.forbidden.title": "Acción no permitida",
  "community.confirm.forbidden.body":
    "No tienes permiso para realizar esta acción.",
  "community.confirm.forbidden.continue": "Entendido",
  "account.profile.title": "Tu perfil",
  "account.profile.intro": "Datos de tu cuenta TourAI.",
  "account.profile.uid": "ID de usuario",
  "account.comingSoon": "Próximamente",
  "account.edit": "Editar",
  "account.edit.photo.panHint": "Arrastra para centrar la foto",
  "account.edit.birthDate.placeholder": "Fecha de nacimiento",
  "account.edit.birthDate.month": "Mes",
  "account.edit.birthDate.year": "Año",
  "account.edit.birthDate.calendar": "Calendario",
  "account.profile.type.premium": "Premium",
  "account.profile.type.freemium": "Freemium",
  "dashboard.section.loading": "Cargando…",
  "account.plan.name": "Plan",
  "account.plan.allowance": "Cupo de uso",
  "account.plan.period": "Periodo",
  "account.plan.status": "Estado",
  "account.plan.freemium":
    "Ahora mismo usas Freemium en la app. El cupo diario de uso gratuito se gestiona en el dispositivo (anuncios recompensados) y no aparece aquí.",
  "site.freemiumPromo.railLabel": "Premium",
  "site.promo.guest.railLabel": "App",
  "site.promo.freemium.railLabel": "Premium",
  "footer.legal": "Legal",
  "footer.cookies": "Cookies",
  "footer.instagram": "Instagram",
  "footer.facebook": "Facebook",
  "deleteAccount.verify.prompt": "Te enviaremos un código a tu correo para confirmar.",
  "deleteAccount.verify.button": "Enviar código",
  "deleteAccount.verify.title": "Verifica tu correo",
  "deleteAccount.verify.intro":
    "Introduce el código de 6 dígitos que te hemos enviado.",
  "deleteAccount.verify.code": "Código de verificación",
  "deleteAccount.verify.code.placeholder": "123456",
  "deleteAccount.verify.submit": "Verificar y eliminar",
  "deleteAccount.verify.resend": "Reenviar código",
  "deleteAccount.verify.close": "Cerrar",
  "deleteAccount.verify.spamHint":
    "Si no lo ves, revisa la carpeta de spam o correo no deseado.",
  "deleteAccount.verify.successTitle": "Código verificado",
  "deleteAccount.verify.successNext": "Continuamos con la eliminación de la cuenta.",
  "deleteAccount.verify.sending": "Enviando código…",
  "deleteAccount.verify.sent": "Código enviado.",
  "deleteAccount.verify.resent": "Código reenviado.",
  "deleteAccount.verify.verifying": "Verificando…",
  "deleteAccount.verify.invalidCode": "Código incorrecto.",
  "deleteAccount.verify.expired": "El código ha caducado. Solicita uno nuevo.",
  "deleteAccount.verify.rateLimited":
    "Demasiados intentos. Espera unos minutos.",
  "deleteAccount.verify.sendError": "No se pudo enviar el código.",
  "deleteAccount.deleting": "Eliminando cuenta…",
  "deleteAccount.finalConfirm":
    "Esta acción es permanente. ¿Confirmas eliminar tu cuenta?",
  "deleteAccount.success": "Tu cuenta se ha eliminado.",
  "deleteAccount.error.notFound": "No encontramos esa cuenta.",
  "deleteAccount.error.notVerified": "Debes verificar el correo antes de eliminar.",
  "deleteAccount.error.failed": "No se pudo eliminar la cuenta.",
  "index.download.title": "Descarga",
  "index.modal.text":
    "Déjanos tu correo para avisarte cuando TourAI esté en {platform}.",
  "unsubscribe.title": "Cancelar avisos de lanzamiento",
  "unsubscribe.intro":
    "Indica el correo y las tiendas de las que quieres darte de baja.",
  "unsubscribe.viewSubscriptions": "Ver o gestionar avisos",
  "unsubscribe.selectStores": "Elige las tiendas",
  "unsubscribe.store.ios": "App Store (iOS)",
  "unsubscribe.store.android": "Google Play (Android)",
  "unsubscribe.submit": "Cancelar avisos",
  "unsubscribe.error": "No se pudo completar la baja.",
  "unsubscribe.verifyUnregistered":
    "Ese correo no tiene avisos activos o no está verificado.",
  "index.modal.error": "No se pudo enviar la solicitud.",
  "contact.submitting": "Enviando…",
  "contact.success": "Mensaje enviado. Te responderemos pronto.",
  "contact.error": "No se pudo enviar el mensaje.",
  "contact.verify.intro": "Verifica tu correo para enviar el mensaje.",
  "contact.verify.code": "Código",
  "contact.verify.code.placeholder": "123456",
  "contact.verify.verifying": "Verificando…",
  "contact.verify.sending": "Enviando código…",
  "contact.verify.sent": "Código enviado.",
  "contact.verify.required": "Debes verificar el correo.",
  "contact.verify.prompt": "Te enviaremos un código de verificación.",
  "contact.verify.checkingEmail": "Comprobando correo…",
  "contact.verify.button": "Enviar código",
  "contact.verify.expired": "El código ha caducado.",
  "contact.verify.rateLimited": "Demasiados intentos. Espera unos minutos.",
  "contact.verify.rateLimitedGeneric": "Has alcanzado el límite. Inténtalo más tarde.",
  "contact.verify.sendError": "No se pudo enviar el código.",
  "feedback.error.title": "No se pudo enviar",
  "contact.success.title": "Mensaje enviado",
  "lang.en": "English",
};

const fromGitHtml = extractFromGitHtml();
const en = loadMessages("js/locales/en-GB.js", "TourAiEnGBMessages");
const es = loadMessages("js/locales/es-ES.js", "TourAiEsESMessages");

let updated = 0;
for (const [k, v] of Object.entries(fromGitHtml)) {
  if (!es[k] || es[k] === en[k]) {
    es[k] = v;
    updated += 1;
  }
}
for (const [k, v] of Object.entries(translations)) {
  es[k] = v;
  updated += 1;
}

// Ensure all en keys exist in es
for (const k of Object.keys(en)) {
  if (es[k] == null) es[k] = en[k];
}

fs.writeFileSync(path.join(root, "js/locales/es-ES.js"), serializeMessages(es), "utf8");

const still = Object.keys(en).filter((k) => es[k] === en[k]);
fs.writeFileSync(
  path.join(root, "scripts/es-ES-still-english.json"),
  JSON.stringify(still, null, 2),
  "utf8"
);
console.log("Updated entries:", updated);
console.log("Still identical to EN:", still.length);
console.log(still.join("\n"));
