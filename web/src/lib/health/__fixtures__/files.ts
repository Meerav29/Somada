import type { ChunkableFile } from '../fileToChunks'

/** A File-like object whose stream() yields `bytes` in `chunkSize`-byte pieces. */
export function chunkedFile(name: string, bytes: Uint8Array, chunkSize: number): ChunkableFile {
  return {
    name,
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.length; i += chunkSize) {
            controller.enqueue(bytes.slice(i, i + chunkSize))
          }
          controller.close()
        },
      }),
  }
}
