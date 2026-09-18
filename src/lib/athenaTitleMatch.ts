// Athena derives a submitted document's `title` from the uploaded file's
// name, and filenames may only contain [a-z0-9-_ ] (see the import dialog's
// upload step). So punctuation in a real topic title — dashes, apostrophes,
// question marks, etc. — never survives the round trip: "Ohm's Law" becomes
// "Ohms Law" on Athena, "Ecosystem – What Are Its Components?" becomes
// "Ecosystem  What Are Its Components" (confirmed against live data).
//
// The filename builder and the "which topic is this document" matcher must
// apply the exact same stripping, or matching silently breaks for any title
// with punctuation — which is what was happening before this file existed.

export function sanitizeTitleForFilename(title: string): string {
  return title.replace(/[^a-z0-9\-_ ]/gi, "").trim();
}

// Collapse whitespace too — stripping punctuation can leave doubled spaces
// (e.g. the en-dash case above), and Athena doesn't collapse those either.
export function normalizeTitleForMatch(title: string): string {
  return sanitizeTitleForFilename(title).toLowerCase().replace(/\s+/g, " ").trim();
}
