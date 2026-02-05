 // Special values that should not be parsed as dates
 const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];
 
/**
 * Parse a date string as local time to avoid timezone shifting.
 * 
 * When using `new Date("YYYY-MM-DD")`, JavaScript interprets this as midnight UTC,
 * which can cause the date to appear as the previous day in timezones behind UTC.
 * 
 * This function parses the date components manually and creates a Date object
 * using local time, ensuring the displayed date matches the intended date.
 * 
 * @param dateStr - A date string in ISO format (YYYY-MM-DD or with time component)
 * @returns A Date object in local time, or undefined if input is null/undefined
 */
export const parseLocalDate = (dateStr: string | null | undefined): Date | undefined => {
   if (!dateStr) return undefined;
   
   // Don't attempt to parse special marker values
   if (SPECIAL_DATE_VALUES.includes(dateStr)) return undefined;
   
  // Handle dates that might already include time component
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number);
   
   // Validate parsed components are valid numbers
   if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
   
  return new Date(year, month - 1, day);
};
