export type CopyVariant = {
  angle: string
  headline: string
  body: string
  callToAction: string
}

export function parseCopyVariants(value: unknown): CopyVariant[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('invalid_output')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('invalid_output')
    const candidate = item as Record<string, unknown>
    const fields = ['angle', 'headline', 'body', 'callToAction'] as const
    if (fields.some((field) => typeof candidate[field] !== 'string' || !candidate[field].trim())) throw new Error('invalid_output')
    const result = Object.fromEntries(fields.map((field) => [field, (candidate[field] as string).trim()])) as CopyVariant
    if (result.angle.length > 80 || result.headline.length > 120 || result.body.length > 3000 || result.callToAction.length > 120) throw new Error('invalid_output')
    return result
  })
}

export function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw new Error('invalid_output')
  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) throw new Error('invalid_output')
  const parts = output.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => part && typeof part === 'object' && (part as { type?: unknown }).type === 'output_text' && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : [])
  })
  if (!parts.length) throw new Error('invalid_output')
  return parts.join('\n')
}
