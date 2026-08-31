import { getExtension, resolveName, buildContentDisposition } from "../../src/caio-server-binarystore/helpers/file-name.js";

describe("getExtension", () => {
  it("should prefer the mime type over the uploaded file name", () => {
    expect(getExtension({ mimetype: "image/webp", originalname: "photo.jpg" })).toBe(".webp");
  });

  it("should fall back to the file name for a mime type it does not know", () => {
    expect(getExtension({ mimetype: "application/octet-stream", originalname: "archive.tar.gz" })).toBe(".gz");
  });

  it("should lowercase an extension taken from the file name", () => {
    expect(getExtension({ mimetype: "application/octet-stream", originalname: "SCAN.PDF" })).toBe(".pdf");
  });

  it("should return an empty string when neither source says anything", () => {
    expect(getExtension({ mimetype: "application/octet-stream", originalname: "README" })).toBe("");
    expect(getExtension(undefined)).toBe("");
  });
});

describe("resolveName", () => {
  const file = { mimetype: "image/jpeg", originalname: "DSC_0001.jpeg" };

  it("should use the uploaded file name when no name is given", () => {
    expect(resolveName(undefined, file)).toBe("DSC_0001.jpeg");
  });

  it("should append the extension to a name given without one", () => {
    expect(resolveName("Dovolená", file)).toBe("Dovolená.jpg");
  });

  it("should leave a name that already ends with the extension alone", () => {
    expect(resolveName("Dovolená.jpg", file)).toBe("Dovolená.jpg");
  });

  it("should accept an alternative spelling of the same type", () => {
    expect(resolveName("Dovolená.jpeg", file)).toBe("Dovolená.jpeg");
  });

  it("should match the extension case-insensitively", () => {
    expect(resolveName("Dovolená.JPG", file)).toBe("Dovolená.JPG");
  });

  it("should append rather than replace when the extension does not fit the content", () => {
    expect(resolveName("Dovolená.png", file)).toBe("Dovolená.png.jpg");
  });

  it("should not mistake a trailing version number for an extension", () => {
    expect(resolveName("verze1.2", file)).toBe("verze1.2.jpg");
  });

  it("should trim the name and ignore one that is only whitespace", () => {
    expect(resolveName("  Dovolená  ", file)).toBe("Dovolená.jpg");
    expect(resolveName("   ", file)).toBe("DSC_0001.jpeg");
  });

  it("should return undefined when there is nothing to build a name from", () => {
    expect(resolveName(undefined, { mimetype: "image/jpeg" })).toBeUndefined();
  });
});

describe("buildContentDisposition", () => {
  it("should carry an ascii name in both parameters", () => {
    expect(buildContentDisposition("report.pdf")).toBe(
      "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf"
    );
  });

  it("should keep accents in filename* and strip them from the ascii fallback", () => {
    const result = buildContentDisposition("Dovolená.jpg");

    expect(result).toContain("filename=\"Dovolen_.jpg\"");
    expect(result).toContain("filename*=UTF-8''Dovolen%C3%A1.jpg");
  });

  it("should not let a quote in the name break out of the fallback parameter", () => {
    const result = buildContentDisposition('a"b.txt');

    expect(result).toContain('filename="a_b.txt"');
    expect(result).toContain("filename*=UTF-8''a%22b.txt");
  });

  it("should return undefined for a missing name", () => {
    expect(buildContentDisposition(undefined)).toBeUndefined();
  });
});
