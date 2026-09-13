// Target configuration
const SPREADSHEET_NAME = properties.getProperty('SPREADSHEET_NAME');
 
// Layout configuration
const START_ROW = 2;       // Data rows start on Row 2
const KEY_COL = 2;         // Column B (Keys)
const VALUE_COL = 3;       // Column C (Values)
const CONFIG_CELL = "F1";  // Cell storing table capacity
const POINTER_CELL = "E1"; // Cell storing fill pointer
 
/**
 * Fetches a sheet by name from the target spreadsheet.
 * `tableName` is now passed explicitly by callers instead of being
 * stashed in PropertiesService, so concurrent/queued calls can't
 * clobber each other's target table.
 */
function getTargetSheet(tableName) {
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  let ss = null;
 
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
 
  const sheet = ss.getSheetByName(tableName);
  if (!sheet) {
    throw new Error(`Sheet "${tableName}" not found in "${SPREADSHEET_NAME}".`);
  }
  return sheet;
}
 
function getHashAddress(key, capacity) {
  if (!key) return 0;
  let hash = 0;
  const keyStr = key.toString();
  for (let i = 0; i < keyStr.length; i++) {
    hash += keyStr.charCodeAt(i);
  }
  return hash % capacity;
}
 
/**
 * Linear-probes from a key's hashed address to find its row.
 * mode "insert": returns the first empty slot, or the slot already
 *                holding this key (so re-inserting the same key updates it).
 * mode "lookup": returns the slot holding this exact key, or null.
 * This resolves hash collisions instead of silently overwriting a
 * different key that happens to land on the same address.
 */
function probeForRow(sheet, key, capacity, mode) {
  const startAddress = getHashAddress(key, capacity);
  for (let i = 0; i < capacity; i++) {
    const address = (startAddress + i) % capacity;
    const row = START_ROW + address;
    const storedKey = sheet.getRange(row, KEY_COL).getValue();
 
    if (mode === "lookup" && storedKey === key) return row;
    if (mode === "insert" && (storedKey === "" || storedKey === key)) return row;
  }
  return null;
}
 
/**
 * Inserts or updates a key/value pair in the given table.
 */
function insertData(data) {
  try {
    const key = data.name;
    const value = JSON.stringify(data.value);
    const table = data.table;
    const sheet = getTargetSheet(table);
 
    const capacity = sheet.getRange(CONFIG_CELL).getValue() || 10;
    const leftPointer = sheet.getRange(POINTER_CELL).getValue() || 0;
 
    if (capacity <= leftPointer) {
      rehashTable(table);
    }
 
    const currentCapacity = sheet.getRange(CONFIG_CELL).getValue() || 10;
    const targetRow = probeForRow(sheet, key, currentCapacity, "insert");
 
    if (targetRow === null) {
      return { success: false, error: "Table is full and rehash did not free a slot" };
    }
 
    sheet.getRange(targetRow, KEY_COL).setValue(key);
    sheet.getRange(targetRow, VALUE_COL).setValue(value);
    sheet.getRange(POINTER_CELL).setValue(leftPointer + 1);
 
    return {
      success: true,
      data: `Insertion successful — table: ${table}, key: ${key}`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
 
/**
 * Looks up a key's value in the given table.
 */
function lookupData(data) {
  try {
    const key = data.name;
    const table = data.table;
    const sheet = getTargetSheet(table);
    const capacity = sheet.getRange(CONFIG_CELL).getValue() || 10;
    const row = probeForRow(sheet, key, capacity, "lookup");

    if (row === null) {
      return { success: false, error: `No value found for key "${key}" in table "${table}"` };
    }
 
    return {
      success: true,
      data: JSON.parse(sheet.getRange(row, VALUE_COL).getValue())
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
 
/**
 * Doubles a table's capacity and re-inserts all existing entries
 * using the new capacity (and collision-safe probing).
 */
function rehashTable(table) {
  const sheet = getTargetSheet(table);
  const oldCapacity = sheet.getRange(CONFIG_CELL).getValue() || 10;
  const newCapacity = oldCapacity * 2;
 
  const oldRange = sheet.getRange(START_ROW, KEY_COL, oldCapacity, 2);
  const oldData = oldRange.getValues();
 
  oldRange.clearContent();
  sheet.getRange(START_ROW, 1, oldCapacity, 1).clearContent();
 
  sheet.getRange(CONFIG_CELL).setValue(newCapacity);
 
  const newAddresses = [];
  for (let i = 0; i < newCapacity; i++) newAddresses.push([i]);
  sheet.getRange(START_ROW, 1, newCapacity, 1).setValues(newAddresses);
 
  oldData.forEach(([key, value]) => {
    if (key !== "") {
      const row = probeForRow(sheet, key, newCapacity, "insert");
      sheet.getRange(row, KEY_COL).setValue(key);
      sheet.getRange(row, VALUE_COL).setValue(value);
    }
  });
}
 
/**
 * Run once per table to format/reset it.
 */
function setupTable(tableName) {
  const sheet = getTargetSheet(tableName);
  sheet.clear();
 
  sheet.getRange("A1:C1").setValues([["Address Index", "Key", "Value"]]);
  sheet.getRange(CONFIG_CELL).setValue(10);
  sheet.getRange(POINTER_CELL).setValue(0);
 
  const initialAddresses = [];
  for (let i = 0; i < 10; i++) initialAddresses.push([i]);
  sheet.getRange(START_ROW, 1, 10, 1).setValues(initialAddresses);
}
