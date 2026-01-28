/**
 * Output truncation utilities to prevent large tool outputs from degrading performance.
 */

export const OUTPUT_TRUNCATION_LIMIT = 60 * 1024; // 60KB
export const TRUNCATION_MESSAGE = "[Output truncated - exceeds 60KB limit]";

export type TruncationResult = {
  content: string;
  truncated: boolean;
  originalSize: number;
};

/**
 * Truncate output that exceeds the size limit.
 * Finds a safe truncation point at a line boundary to avoid cutting mid-line.
 */
export function truncateOutput(output: string): TruncationResult {
  const bytes = new TextEncoder().encode(output).length;

  if (bytes <= OUTPUT_TRUNCATION_LIMIT) {
    return { content: output, truncated: false, originalSize: bytes };
  }

  // Find safe truncation point (avoid cutting mid-line)
  // We need to slice by character count, not bytes, but we want to stay under the byte limit
  // Use a conservative estimate: slice at roughly the byte limit position
  const truncated = output.slice(0, OUTPUT_TRUNCATION_LIMIT);
  const lastNewline = truncated.lastIndexOf("\n");
  const safeContent =
    lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;

  return {
    content: safeContent + "\n" + TRUNCATION_MESSAGE,
    truncated: true,
    originalSize: bytes,
  };
}

/**
 * Format bytes for display (e.g., "60KB", "1.2MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
