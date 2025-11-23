/**
 * Converts circle bullets (○) to HTML unordered lists with checkmarks
 * Handles multiple bullets on the same line
 */
export function convertCircleBulletsToHtml(text: string | null | undefined): string {
  if (!text || !text.includes('○')) {
    return text || '';
  }

  const lines = text.split('\n');
  const result: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if line contains circle bullets
    if (trimmed.includes('○')) {
      // Split by ○ to handle multiple bullets on the same line
      const segments = trimmed.split('○').filter(s => s.trim());
      
      for (const segment of segments) {
        const content = segment.trim();
        
        if (!inList) {
          result.push('<ul>');
          inList = true;
        }
        
        result.push(`<li>${content}</li>`);
      }
    } else {
      // Not a bullet point
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(line);
    }
  }

  // Close list if still open
  if (inList) {
    result.push('</ul>');
  }

  return result.join('\n');
}
