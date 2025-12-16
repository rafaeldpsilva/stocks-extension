/**
 * Parse a CSV line handling quoted fields with commas
 * @param {string} line - CSV line to parse
 * @returns {string[]} Array of field values
 */
const parseCSVLine = (line) => {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

/**
 * Parse CSV text into array of row objects
 * @param {string} csvText - Full CSV file content
 * @returns {Object[]} Array of row objects with column headers as keys
 * @throws {Error} If CSV is invalid or empty
 */
export const parseCSV = (csvText) => {
  const lines = csvText.split('\n').filter(line => line.trim())

  if (lines.length < 2) {
    throw new Error('CSV must have header and at least one data row')
  }

  const header = parseCSVLine(lines[0])
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])

    if (values.length !== header.length) {
      console.warn(`[CSV Parser] Skipping malformed row ${i + 1}`)
      continue
    }

    const row = {}
    header.forEach((key, index) => {
      row[key] = values[index]
    })

    rows.push(row)
  }

  if (rows.length === 0) {
    throw new Error('No valid data rows found in CSV')
  }

  return rows
}

/**
 * Convert Yahoo Finance date format (YYYYMMDD) to ISO format
 * @param {string} dateString - Date in YYYYMMDD format (e.g., "20250804")
 * @returns {string|null} ISO format datetime string or null if invalid
 */
export const parseDateYYYYMMDD = (dateString) => {
  if (!dateString || dateString.length !== 8) {
    return null
  }

  const year = dateString.substring(0, 4)
  const month = dateString.substring(4, 6)
  const day = dateString.substring(6, 8)

  if (isNaN(parseInt(year)) || isNaN(parseInt(month)) || isNaN(parseInt(day))) {
    return null
  }

  const monthNum = parseInt(month)
  const dayNum = parseInt(day)

  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null
  }

  return `${year}-${month}-${day}T09:30:00.000`
}

/**
 * Validate a CSV row has required fields
 * @param {Object} row - CSV row object
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export const validateCSVRow = (row) => {
  const errors = []

  if (!row.Symbol || row.Symbol.trim() === '') {
    errors.push('Missing required field: Symbol')
  }

  const hasTransactionData = row['Trade Date'] || row['Purchase Price'] || row['Quantity']

  if (hasTransactionData) {
    if (!row['Trade Date']) {
      errors.push('Trade Date is required when transaction data is present')
    } else if (parseDateYYYYMMDD(row['Trade Date']) === null) {
      errors.push('Invalid Trade Date format (expected YYYYMMDD)')
    }

    if (!row['Purchase Price']) {
      errors.push('Purchase Price is required when transaction data is present')
    } else {
      const price = parseFloat(row['Purchase Price'])
      if (isNaN(price) || price <= 0) {
        errors.push('Invalid Purchase Price (must be positive number)')
      }
    }

    if (!row['Quantity']) {
      errors.push('Quantity is required when transaction data is present')
    } else {
      const quantity = parseFloat(row['Quantity'])
      if (isNaN(quantity) || quantity <= 0) {
        errors.push('Invalid Quantity (must be positive number)')
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Check if CSV row has transaction data
 * @param {Object} row - CSV row object
 * @returns {boolean} True if row has complete transaction data
 */
export const hasTransactionData = (row) => {
  return !!(
    row['Trade Date'] &&
    row['Purchase Price'] &&
    row['Quantity'] &&
    parseDateYYYYMMDD(row['Trade Date']) !== null &&
    !isNaN(parseFloat(row['Purchase Price'])) &&
    parseFloat(row['Purchase Price']) > 0 &&
    !isNaN(parseFloat(row['Quantity'])) &&
    parseFloat(row['Quantity']) > 0
  )
}
