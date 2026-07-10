window.TourAiSite = window.TourAiSite || {};

window.TourAiSite.config = {

  contactFormUrl: "https://us-central1-tourai-production-7dabf.cloudfunctions.net/sendContactForm",

  contactSendVerificationUrl:

    "https://us-central1-tourai-production-7dabf.cloudfunctions.net/sendWebContactVerificationCode",

  contactVerifyCodeUrl:

    "https://us-central1-tourai-production-7dabf.cloudfunctions.net/verifyWebContactVerificationCode",

  subscribeFormUrl: "https://us-central1-tourai-production-7dabf.cloudfunctions.net/sendSubscribeNotificationsForm",

  checkStoreSubscriptionUrl:

    "https://us-central1-tourai-production-7dabf.cloudfunctions.net/checkWebStoreSubscription",

  unsubscribeStoreNotificationsUrl:

    "https://us-central1-tourai-production-7dabf.cloudfunctions.net/unsubscribeWebStoreNotifications",

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

