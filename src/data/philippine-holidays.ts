export type PhilippineHolidayType = 'Regular holiday' | 'Special non-working day'

export type PhilippineHoliday = {
  date: string
  name: string
  type: PhilippineHolidayType
}

export const philippineHolidays2026: readonly PhilippineHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day", type: 'Regular holiday' },
  { date: '2026-02-17', name: 'Chinese New Year', type: 'Special non-working day' },
  { date: '2026-03-20', name: "Eid'l Fitr", type: 'Regular holiday' },
  { date: '2026-04-02', name: 'Maundy Thursday', type: 'Regular holiday' },
  { date: '2026-04-03', name: 'Good Friday', type: 'Regular holiday' },
  { date: '2026-04-04', name: 'Black Saturday', type: 'Special non-working day' },
  { date: '2026-04-09', name: 'Araw ng Kagitingan', type: 'Regular holiday' },
  { date: '2026-05-01', name: 'Labor Day', type: 'Regular holiday' },
  { date: '2026-05-27', name: "Eid'l Adha", type: 'Regular holiday' },
  { date: '2026-06-12', name: 'Independence Day', type: 'Regular holiday' },
  { date: '2026-08-21', name: 'Ninoy Aquino Day', type: 'Special non-working day' },
  { date: '2026-08-31', name: 'National Heroes Day', type: 'Regular holiday' },
  { date: '2026-11-01', name: "All Saints' Day", type: 'Special non-working day' },
  { date: '2026-11-02', name: 'Additional special non-working day', type: 'Special non-working day' },
  { date: '2026-11-30', name: 'Bonifacio Day', type: 'Regular holiday' },
  { date: '2026-12-08', name: 'Feast of the Immaculate Conception', type: 'Special non-working day' },
  { date: '2026-12-24', name: 'Additional special non-working day', type: 'Special non-working day' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'Regular holiday' },
  { date: '2026-12-30', name: 'Rizal Day', type: 'Regular holiday' },
  { date: '2026-12-31', name: "Last Day of the Year", type: 'Special non-working day' },
]

const holidaysByDate = new Map(philippineHolidays2026.map((holiday) => [holiday.date, holiday]))

export function getPhilippineHoliday(date: string) {
  return holidaysByDate.get(date) ?? null
}
