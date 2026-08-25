import { PROVIDERS, getProviderList, getProviderNames, isConfigured, getMissingEnvKeys } from "../../src/caio-server-auth/helpers/providers.js";

describe("providers", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[key];
  });

  afterAll(() => {
    process.env = saved;
  });

  it("should know google", () => {
    expect(getProviderNames()).toContain("google");
    expect(PROVIDERS.google.callbackUc).toBe("google/callback");
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
