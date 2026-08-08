window.TourAiSite = window.TourAiSite || {};

window.TourAiSite.config = {
  contactFormUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/sendContactForm",
  contactSendVerificationUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/sendWebContactVerificationCode",
  contactVerifyCodeUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/verifyWebContactVerificationCode",
  subscribeFormUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/sendSubscribeNotificationsForm",
  checkStoreSubscriptionUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/checkWebStoreSubscription",
  unsubscribeStoreNotificationsUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/unsubscribeWebStoreNotifications",
  accountDeletionSendVerificationUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/sendAccountDeletionVerificationCode",
  accountDeletionVerifyCodeUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/verifyAccountDeletionVerificationCode",
  accountDeletionDeleteUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/deleteUserAccountWeb",
  createCheckoutSessionWebUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/createCheckoutSessionWeb",
  reconcileStripeCheckoutUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/reconcileStripeCheckout",
  cancelStripeCheckoutUrl:
    "https://europe-west1-tourai-production-7dabf.cloudfunctions.net/cancelStripeCheckout",
  defaultLocale: "es-ES",
  supportedLocales: ["es-ES", "en-GB"],
  storeBadges: {
    ios: {
      "es-ES": "img/store-badges/ios_es.svg",
      "en-GB": "img/store-badges/ios_en.svg",
    },
    android: {
      "es-ES": "img/store-badges/android_es.png",
      "en-GB": "img/store-badges/android_en.svg",
    },
  },
};
