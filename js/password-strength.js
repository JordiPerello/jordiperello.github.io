/**
 * Password strength evaluation and secure password generation.
 * Mirrors TourAI.Core.Helpers.PasswordStrengthHelper (Weak / Medium / Strong).
 */
(function (global) {
  const MINIMUM_LENGTH = 8;
  const STRONG_LENGTH = 12;
  const GENERATED_LENGTH = 16;

  const LOWER = "abcdefghijkmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const DIGITS = "23456789";
  const SPECIAL = "!@#$%&*-_=+?";

  const Level = {
    None: 0,
    Weak: 1,
    Medium: 2,
    Strong: 3,
  };

  function evaluate(password) {
    if (!password) {
      return Level.None;
    }

    const length = password.length;
    let hasLower = false;
    let hasUpper = false;
    let hasDigit = false;
    let hasSpecial = false;

    for (let i = 0; i < length; i++) {
      const ch = password[i];
      if (ch >= "a" && ch <= "z") {
        hasLower = true;
      } else if (ch >= "A" && ch <= "Z") {
        hasUpper = true;
      } else if (ch >= "0" && ch <= "9") {
        hasDigit = true;
      } else if (ch.trim() !== "") {
        hasSpecial = true;
      }
    }

    const classCount =
      (hasLower ? 1 : 0) +
      (hasUpper ? 1 : 0) +
      (hasDigit ? 1 : 0) +
      (hasSpecial ? 1 : 0);

    let score = 0;
    if (length >= MINIMUM_LENGTH) {
      score++;
    }
    if (length >= STRONG_LENGTH) {
      score++;
    }
    score += classCount;

    if (score <= 2 || length < MINIMUM_LENGTH) {
      return Level.Weak;
    }
    if (score <= 4) {
      return Level.Medium;
    }
    return Level.Strong;
  }

  function meetsMinimum(password) {
    return evaluate(password) >= Level.Medium;
  }

  function nextIndex(exclusiveMax) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % exclusiveMax;
  }

  function pick(chars) {
    return chars[nextIndex(chars.length)];
  }

  function generateSecurePassword(length) {
    let size = typeof length === "number" ? length : GENERATED_LENGTH;
    if (size < STRONG_LENGTH) {
      size = STRONG_LENGTH;
    }

    const allChars = LOWER + UPPER + DIGITS + SPECIAL;
    const chars = new Array(size);

    chars[0] = pick(LOWER);
    chars[1] = pick(UPPER);
    chars[2] = pick(DIGITS);
    chars[3] = pick(SPECIAL);

    for (let i = 4; i < size; i++) {
      chars[i] = pick(allChars);
    }

    for (let i = size - 1; i > 0; i--) {
      const j = nextIndex(i + 1);
      const tmp = chars[i];
      chars[i] = chars[j];
      chars[j] = tmp;
    }

    return chars.join("");
  }

  global.TourAiPasswordStrength = {
    Level,
    MinimumLength: MINIMUM_LENGTH,
    StrongLength: STRONG_LENGTH,
    GeneratedLength: GENERATED_LENGTH,
    evaluate,
    meetsMinimum,
    generateSecurePassword,
  };
})(window);
