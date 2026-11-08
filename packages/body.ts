export class InvalidBody extends Error {}
export async function limitedText(response: Pick<Response, 'body'>, limit = 32768): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { void reader.cancel(); throw new InvalidBody('Sample response exceeded the limit'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new InvalidBody('Sample response was not UTF-8'); }
}
