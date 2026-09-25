function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

function partsOf(date: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(date)
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') }
}

export function dateTimeInputValue(value: string | null, timeZone: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const { year, month, day, hour, minute } = partsOf(date, timeZone)
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  } catch {
    return ''
  }
}

export function dateTimeInputToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match
  const target = { year: Number(yearValue), month: Number(monthValue), day: Number(dayValue), hour: Number(hourValue), minute: Number(minuteValue), second: 0 }
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute)
  if (target.month < 1 || target.month > 12 || target.hour > 23 || target.minute > 59) return null
  const calendarCheck = new Date(targetUtc)
  if (calendarCheck.getUTCFullYear() !== target.year || calendarCheck.getUTCMonth() + 1 !== target.month || calendarCheck.getUTCDate() !== target.day) return null

  try {
    const zoneFormatter = formatter(timeZone)
    let timestamp = targetUtc
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const represented = partsOf(new Date(timestamp), timeZone)
      const representedUtc = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute, represented.second)
      const difference = targetUtc - representedUtc
      if (!difference) break
      timestamp += difference
    }
    const actual = zoneFormatter.formatToParts(new Date(timestamp))
    const result = (type: string) => actual.find((item) => item.type === type)?.value
    if (Number(result('year')) !== target.year || Number(result('month')) !== target.month || Number(result('day')) !== target.day || Number(result('hour')) !== target.hour || Number(result('minute')) !== target.minute) return null
    return new Date(timestamp).toISOString()
  } catch {
    return null
  }
}

export function dateKeyInTimezone(date: Date, timeZone: string) {
  const { year, month, day } = partsOf(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function yearMonthInTimezone(date: Date, timeZone: string) {
  const { year, month } = partsOf(date, timeZone)
  return { year, month }
}
