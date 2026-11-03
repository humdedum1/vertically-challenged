/** Copies `url` and returns the status line to show. */
export async function copyLink(url: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(url);
    return 'Link copied.';
  } catch {
    return 'Could not copy the link.';
  }
}
