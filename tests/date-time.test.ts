import assert from 'node:assert/strict'
import test from 'node:test'
import { dateKeyInTimezone, dateTimeInputToIso, dateTimeInputValue, yearMonthInTimezone } from '../lib/date-time.ts'

test('converts scheduled local time to UTC in the selected timezone', () => {
  assert.equal(dateTimeInputToIso('2026-09-25T09:30', 'America/Tegucigalpa'), '2026-09-25T15:30:00.000Z')
  assert.equal(dateTimeInputToIso('2026-01-15T09:30', 'America/New_York'), '2026-01-15T14:30:00.000Z')
  assert.equal(dateTimeInputToIso('2026-07-15T09:30', 'America/New_York'), '2026-07-15T13:30:00.000Z')
})

test('rejects invalid calendar values and nonexistent daylight-saving times', () => {
  assert.equal(dateTimeInputToIso('2026-02-30T09:30', 'America/Tegucigalpa'), null)
  assert.equal(dateTimeInputToIso('2026-03-08T02:30', 'America/New_York'), null)
  assert.equal(dateTimeInputToIso('2026-09-25T09:30', 'Not/A_Timezone'), null)
})

test('formats dates and groups calendar entries in the account timezone', () => {
  const scheduled = '2026-09-25T02:00:00.000Z'
  assert.equal(dateTimeInputValue(scheduled, 'America/Tegucigalpa'), '2026-09-24T20:00')
  assert.equal(dateKeyInTimezone(new Date(scheduled), 'America/Tegucigalpa'), '2026-09-24')
  assert.deepEqual(yearMonthInTimezone(new Date(scheduled), 'America/Tegucigalpa'), { year: 2026, month: 9 })
})
