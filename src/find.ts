/** Case-insensitive offsets of every non-overlapping occurrence of `query` in `text`. */
export function matchOffsets(text: string, query: string): number[] {
  if (!query) return [];
  const haystack = text.toLowerCase(), needle = query.toLowerCase();
  const offsets: number[] = [];
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) offsets.push(index);
  return offsets;
}

/** Ranges for each match inside the text nodes under `root`. Matches do not span element boundaries. */
export function findRanges(root: Node, query: string, limit = 1000): Range[] {
  const ranges: Range[] = [];
  if (!query) return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    for (const offset of matchOffsets(node.textContent ?? '', query)) {
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + query.length);
      ranges.push(range);
      if (ranges.length >= limit) break;
    }
  }
  return ranges;
}
