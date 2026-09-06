const Config = {
  mongodbUri: process.env.MONGODB_URI,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUc: "google/callback"
  },
  token: {
    jwtSecret: process.env.JWT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    jwtLifetime: process.env.JWT_LIFETIME || "1d",
  },
  password: {
    minLength: 10,
    // bcrypt hashes only the first 72 bytes and drops the rest without a word, so a
    // longer password is misleading rather than stronger. Bytes, not characters:
    // accented letters take two in UTF-8.
    maxBytes: 72,
    // At least one lower-case letter, one upper-case letter and one digit. A special
    // character is not required: at this length it buys forgotten passwords rather
    // than security. Kept as a source string so the login page can be handed the
    // same rule instead of repeating it.
    patternSource: "(?=.*\\p{Ll})(?=.*\\p{Lu})(?=.*\\d)",
    patternFlags: "u",
  },
  // Deliberately loose: the address is proven by using it, not by a regular
  // expression, and an over-strict pattern rejects valid addresses.
  emailPatternSource: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$",

  passwordReset: {
    // Short on purpose: the link is a bearer credential sent over e-mail, and the
    // person asking for it is by definition sitting at the keyboard right now.
    tokenLifetimeMs: 30 * 60 * 1000,
    // 32 random bytes, stored only as a sha-256 hash -- a leaked database must not
    // hand over working reset links.
    tokenBytes: 32,
  },

  // Outgoing mail. Only used for password resets today, so the whole feature switches
  // off with it (see helpers/mailer.js) instead of failing at the moment somebody
  // asks for a link.
  //
  // Read on each call, not at import: env files are loaded by the app after this module
  // is imported, and tests set variables as they go. Same reason as
  // helpers/providers.js `credentials()`.
  mail: () => ({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM,
    // Public address of the app, used to build the reset link. Without it the link
    // would point nowhere, so it counts as part of the mail configuration.
    appUrl: process.env.APP_URL,
  }),

  // Which providers a deployment can actually use is decided by helpers/providers.js,
  // next to the strategies themselves.
  ERROR_PREFIX: "caio-server-auth/",
};

export default Config;
