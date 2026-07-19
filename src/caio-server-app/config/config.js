module.exports = {
  port: process.env.PORT || 8080,
  mongodbUri: process.env.MONGODB_URI,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    oAuthUri: process.env.GOOGLE_OAUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    accessTokenUri: process.env.GOOGLE_ACCESS_TOKEN_URL || "https://oauth2.googleapis.com/token",
    tokenInfoUri: process.env.GOOGLE_TOKEN_INFO_URL || "https://oauth2.googleapis.com/tokeninfo",
    callbackUc: process.env.GOOGLE_CALLBACK_UC || "google/callback",
    oAuthScopes: [
      "https%3A//www.googleapis.com/auth/userinfo.email",
      "https%3A//www.googleapis.com/auth/userinfo.profile",
    ],
  },
  token: {
    jwtSecret: process.env.JWT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    jwtLifetime: process.env.JWT_LIFETIME || "1d",
  }
};
