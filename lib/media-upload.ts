export const maxMediaBytes = 25 * 1024 * 1024

export const mediaExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
}

export function detectMediaType(bytes: Uint8Array): keyof typeof mediaExtensions | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(ascii(8, 12))) return 'video/mp4'
  return null
}

export async function inspectMediaFile(file: File) {
  if (file.size <= 0 || file.size > maxMediaBytes) throw new Error(`${file.name}: el límite es 25 MB.`)
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const mimeType = detectMediaType(header)
  if (!mimeType || file.type !== mimeType) throw new Error(`${file.name}: el formato real no coincide con el archivo.`)
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
  return { mimeType, extension: mediaExtensions[mimeType], hash }
}
