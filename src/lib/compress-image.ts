/**
 * Resizes and re-compresses an image on the device before upload. Data
 * costs and weak signal are real constraints here — a driver on the road
 * shouldn't be stuck uploading a multi-megabyte photo straight from their
 * camera for a quick chat message.
 */
export async function compressImage(file: File, maxDimension = 1280, quality = 0.72): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;

    // Only use the compressed version if it's actually smaller — a tiny
    // already-optimized image shouldn't get re-encoded larger.
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file; // fall back to the original on any failure (e.g. unsupported format)
  }
}
