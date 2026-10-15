export type StaffNavigationView = 'tasks' | 'payroll'

const staffNavigationStoragePrefix = 'sagact:staff-navigation:v1:'

function staffNavigationStorageKey(userId: string) {
  return `${staffNavigationStoragePrefix}${userId}`
}

export function readStaffNavigation(
  storage: Pick<Storage, 'getItem'>,
  userId: string,
  canManagePayroll: boolean,
): StaffNavigationView {
  try {
    return canManagePayroll && storage.getItem(staffNavigationStorageKey(userId)) === 'payroll'
      ? 'payroll'
      : 'tasks'
  } catch (error) {
    console.warn('Could not restore the saved staff page.', error)
    return 'tasks'
  }
}

export function saveStaffNavigation(
  storage: Pick<Storage, 'setItem'>,
  userId: string,
  view: StaffNavigationView,
) {
  try {
    storage.setItem(staffNavigationStorageKey(userId), view)
  } catch (error) {
    console.warn('Could not save the current staff page.', error)
  }
}

export function clearSavedStaffNavigation(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>) {
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(staffNavigationStoragePrefix)) storage.removeItem(key)
    }
  } catch (error) {
    console.warn('Could not clear the saved staff page.', error)
  }
}
