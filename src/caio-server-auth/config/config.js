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
  ERROR_PREFIX: "caio-server-auth/",
};

export default Config;
