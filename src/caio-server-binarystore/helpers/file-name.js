import path from "path";

/**
 * The object in the bucket is a UUID, so nothing about the original file survives in the URL on
 * its own. These helpers derive the name and the extension that the browser should see, and the
 * Content-Disposition header that carries them (docs/binary.md, R8).
 */

// Only the types this stack actually produces or accepts often enough that guessing beats the
// uploaded file name. Anything outside the map falls back to the original name's extension,
// which is why this does not need to be exhaustive.
//
// The first entry is the canonical extension; the rest are spellings that are just as correct
// for that type, so that a file already named ".jpeg" is not "corrected" to ".jpeg.jpg".
const EXTENSIONS_BY_MIME_TYPE = {
  "image/webp": [".webp"],
  "image/jpeg": [".jpg", ".jpeg", ".jfif"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/svg+xml": [".svg"],
  "image/avif": [".avif"],
  "image/tiff": [".tif", ".tiff"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "text/calendar": [".ics"],
  "application/json": [".json"],
  "application/zip": [".zip"],
};

/**
 * The mime type wins over the original file name because it describes the bytes that were
 * actually uploaded: the client resizes and re-encodes images to webp before submitting them
 * (caio-ui's BinaryCrud#onPreSubmit), and a file whose name still ends in .jpg while its content
 * is webp would otherwise be stored -- and downloaded -- under a lying extension.
 */
export function getExtension(file) {
  const byMimeType = EXTENSIONS_BY_MIME_TYPE[file?.mimetype];
  if (byMimeType) return byMimeType[0];

  const byName = path.extname(file?.originalname ?? "");
  return byName ? byName.toLowerCase() : "";
}

/**
 * The stored name: what the caller asked for, or the uploaded file's own name. Either way it is
 * forced to carry the right extension, so the name in the table and the name the browser saves
 * are the same string.
 *
 * A name whose extension does not fit the content gets the right one appended rather than
 * swapped in -- "verze1.2" would lose its last character to anything that tried to be clever
 * about replacing what looks like an extension.
 */
export function resolveName(name, file) {
  const requested = typeof name === "string" && name.trim() ? name.trim() : file?.originalname;
  if (!requested) return undefined;

  const extension = getExtension(file);
  if (!extension) return requested;

  const accepted = EXTENSIONS_BY_MIME_TYPE[file?.mimetype] ?? [extension];
  const current = path.extname(requested).toLowerCase();

  return accepted.includes(current) ? requested : requested + extension;
}

/**
 * RFC 5987 / RFC 6266. `filename` alone is latin-1 only, so a Czech name would arrive mangled or
 * get dropped -- `filename*` carries the UTF-8 version and every current browser prefers it. The
 * plain `filename` stays as the ASCII-only fallback.
 *
 * `attachment` on purpose: the point is that clicking the link in the table saves the file under
 * its real name. It does not stop an <img>/<video> from rendering the same URI, because browsers
 * only honour Content-Disposition for top-level navigation, not for subresources.
 */
export function buildContentDisposition(name) {
  if (!name) return undefined;

  const asciiFallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
