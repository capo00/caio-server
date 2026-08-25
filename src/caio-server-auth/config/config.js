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
  ERROR_PREFIX: "caio-server-auth/",
};

export default Config;
