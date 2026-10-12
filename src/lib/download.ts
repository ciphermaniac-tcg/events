/**
 * Handing a finished export to the person who made it.
 *
 * A download link is the desktop answer and the wrong one on a phone: an
 * in-app browser has nowhere to put a download and navigates to the file
 * instead, which reads as the page reloading. There the file goes to the share
 * sheet, where "Save Image" lives.
 * @module lib/download
 */

/** Hand a finished export to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can beat the download off the mark in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
