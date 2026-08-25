import { PROVIDERS, getProviderList, getProviderNames, isConfigured, getMissingEnvKeys } from "../../src/caio-server-auth/helpers/providers.js";

describe("providers", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = saved;
  });

  it("should know google and facebook", () => {
    expect(getProviderNames()).toEqual(["google", "facebook"]);
    expect(PROVIDERS.google.callbackUc).toBe("google/callback");
    expect(PROVIDERS.facebook.callbackUc).toBe("facebook/callback");
  });

  it("should treat a provider without credentials as unavailable", () => {
    expect(isConfigured("google")).toBe(false);
    expect(getProviderList()).toEqual([]);
    expect(getMissingEnvKeys("google")).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  });

  it("should require every credential, not just one", () => {
    process.env.GOOGLE_CLIENT_ID = "id";

    expect(isConfigured("google")).toBe(false);
    expect(getMissingEnvKeys("google")).toEqual(["GOOGLE_CLIENT_SECRET"]);
  });

  it("should treat an empty value as missing", () => {
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";

    expect(isConfigured("google")).toBe(false);
  });

  it("should offer a provider once its credentials are there", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";

    expect(isConfigured("google")).toBe(true);
    expect(getProviderList()).toEqual(["google"]);
    expect(getMissingEnvKeys("google")).toEqual([]);
  });

  it("should not invent providers it does not know", () => {
    expect(isConfigured("twitter")).toBe(false);
    expect(getMissingEnvKeys("twitter")).toEqual([]);
  });

  it("should offer each provider on its own credentials", () => {
    process.env.FACEBOOK_APP_ID = "id";
    process.env.FACEBOOK_APP_SECRET = "secret";

    expect(getProviderList()).toEqual(["facebook"]);
    expect(getMissingEnvKeys("google")).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  });

  describe("facebook profile mapping", () => {
    it("should treat a returned e-mail as verified", () => {
      // Facebook only ever hands over an address the account has confirmed.
      const mapped = PROVIDERS.facebook.mapProfile({
        id: "f-1",
        displayName: "Jana Nová",
        name: { givenName: "Jana", familyName: "Nová" },
        emails: [{ value: "jana@test.cz" }],
        photos: [{ value: "photo-url" }],
      });

      expect(mapped).toEqual({
        providerId: "f-1",
        email: "jana@test.cz",
        emailVerified: true,
        data: { name: "Jana Nová", firstName: "Jana", surname: "Nová", photo: "photo-url" },
      });
    });

    it("should accept an account with no e-mail at all", () => {
      // A Facebook account registered by phone has none; Identity.create() seeds the
      // identity code off the provider id instead (docs/auth.md, R4).
      const mapped = PROVIDERS.facebook.mapProfile({ id: "f-2", displayName: "Bez Mailu" });

      expect(mapped.email).toBeUndefined();
      expect(mapped.emailVerified).toBe(false);
    });
  });

  describe("google profile mapping", () => {
    it("should map a profile onto what loginWithProvider expects", () => {
      const mapped = PROVIDERS.google.mapProfile({
        id: "g-1",
        displayName: "John Doe",
        name: { givenName: "John", familyName: "Doe" },
        emails: [{ value: "j@d.com" }],
        photos: [{ value: "photo-url" }],
        _json: { email_verified: true },
      });

      expect(mapped).toEqual({
        providerId: "g-1",
        email: "j@d.com",
        emailVerified: true,
        data: { name: "John Doe", firstName: "John", surname: "Doe", photo: "photo-url" },
      });
    });

    it("should default emailVerified to false rather than assuming it", () => {
      // An unverified e-mail must not be able to claim an existing identity.
      expect(PROVIDERS.google.mapProfile({ id: "g-1", emails: [{ value: "j@d.com" }] }).emailVerified).toBe(false);
    });

    it("should survive a profile with nothing but an id", () => {
      expect(PROVIDERS.google.mapProfile({ id: "g-1" })).toEqual({
        providerId: "g-1",
        email: undefined,
        emailVerified: false,
        data: { name: undefined, firstName: undefined, surname: undefined, photo: undefined },
      });
    });
  });
});
