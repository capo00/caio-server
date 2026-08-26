describe("BinaryStore isConfigured", () => {
  const originalEnv = process.env.GCS_BUCKET_NAME;

  afterEach(() => {
    process.env.GCS_BUCKET_NAME = originalEnv;
    jest.resetModules();
  });

  it("is false when GCS_BUCKET_NAME is not set", async () => {
    delete process.env.GCS_BUCKET_NAME;
    jest.resetModules();
    const { isConfigured } = await import("../../src/caio-server-binarystore/helpers/config.js");
    expect(isConfigured()).toBe(false);
  });

  it("is true when GCS_BUCKET_NAME is set", async () => {
    process.env.GCS_BUCKET_NAME = "my-bucket";
    jest.resetModules();
    const { isConfigured } = await import("../../src/caio-server-binarystore/helpers/config.js");
    expect(isConfigured()).toBe(true);
  });
});
