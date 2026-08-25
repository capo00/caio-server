jest.mock("passport", () => ({
  use: jest.fn(),
  serializeUser: jest.fn(),
  deserializeUser: jest.fn(),
}));

jest.mock("../../src/caio-server-auth/abl/identity", () => ({
  loginWithProvider: jest.fn(),
  get: jest.fn(),
}));

import passport from "passport";
import Passport from "../../src/caio-server-auth/helpers/passport.js";
import DefaultIdentity from "../../src/caio-server-auth/abl/identity.js";

describe("Passport.init", () => {
  const saved = { ...process.env };
  let log;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[key];
    log = jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    log.mockRestore();
  });

  afterAll(() => {
    process.env = saved;
  });

  it("should register no strategy without credentials, and say so", () => {
    // new GoogleStrategy({ clientID: "" }) throws, which used to keep an app with no
    // Google credentials from starting at all.
    Passport.init("/auth");

    expect(passport.use).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toMatch(/google sign-in is off.*GOOGLE_CLIENT_ID/);
  });

  it("should register the strategy once credentials are there", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";

    Passport.init("/auth");

    expect(passport.use).toHaveBeenCalledTimes(1);
    const [name, strategy] = passport.use.mock.calls[0];
    expect(name).toBe("google");
    expect(strategy._callbackURL ?? strategy._oauth2?._callbackURL ?? strategy).toBeDefined();
  });

  it("should hand the profile to Identity.loginWithProvider", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    DefaultIdentity.loginWithProvider.mockResolvedValue({ identity: "1-1-1" });

    Passport.init("/auth");

    // passport-google-oauth20 keeps the verify callback it was constructed with.
    const strategy = passport.use.mock.calls[0][1];
    const verify = strategy._verify;
    const done = jest.fn();
    await verify("access", "refresh", { id: "g-1", emails: [{ value: "j@d.com" }], _json: { email_verified: true } }, done);

    expect(DefaultIdentity.loginWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", providerId: "g-1", email: "j@d.com", emailVerified: true }),
    );
    expect(done).toHaveBeenCalledWith(null, { identity: "1-1-1" });
  });

  it("should report a failure through done, not throw", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const failure = new Error("refused");
    DefaultIdentity.loginWithProvider.mockRejectedValue(failure);
    const error = jest.spyOn(console, "error").mockImplementation();

    Passport.init("/auth");
    const done = jest.fn();
    await passport.use.mock.calls[0][1]._verify("access", "refresh", { id: "g-1" }, done);

    expect(done).toHaveBeenCalledWith(failure, null);
    error.mockRestore();
  });

  describe("strategyName", () => {
    it("should keep the plain name for a single-tenant setup", () => {
      expect(Passport.strategyName("google", "google")).toBe("google");
      expect(Passport.strategyName("facebook", "google")).toBe("facebook");
    });

    it("should carry the collection suffix over to every provider", () => {
      expect(Passport.strategyName("google", "google-tenant1")).toBe("google-tenant1");
      expect(Passport.strategyName("facebook", "google-tenant1")).toBe("facebook-tenant1");
    });
  });
});
