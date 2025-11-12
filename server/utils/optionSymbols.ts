/**
 * Format option symbol in OCC format for Polygon/Tastytrade option data fetching
 * Format: .{TICKER}{YYMMDD}{C|P}{STRIKE (8 digits with 3 decimals)}
 * Example: .SPY251113C00680000 = SPY Call $680 expiring Nov 13, 2025
 */
export function formatOptionSymbol(
  ticker: string,
  expiry: string, // Format: "YYYY-MM-DD"
  optionType: 'call' | 'put',
  strikePrice: number
): string {
  try {
    // Parse expiry date
    const expiryDate = new Date(expiry);
    if (isNaN(expiryDate.getTime())) {
      throw new Error(`Invalid expiry date: ${expiry}`);
    }

    // Format date as YYMMDD
    const year = expiryDate.getFullYear().toString().slice(-2); // Last 2 digits
    const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
    const day = String(expiryDate.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    // Format option type (C or P)
    const typeChar = optionType.toLowerCase() === 'call' ? 'C' : 'P';

    // Format strike price (8 digits with 3 decimal places)
    // e.g., 680.00 → 00680000
    const strikeInt = Math.round(strikePrice * 1000); // Convert to integer (3 decimals)
    const strikeStr = strikeInt.toString().padStart(8, '0');

    // Combine into OCC format
    const optionSymbol = `.${ticker.toUpperCase()}${dateStr}${typeChar}${strikeStr}`;

    return optionSymbol;
  } catch (error: any) {
    console.error(`Error formatting option symbol for ${ticker}:`, error.message);
    return '';
  }
}

/**
 * Parse OCC option symbol to extract components
 * Format: .{TICKER}{YYMMDD}{C|P}{STRIKE}
 * Example: .SPY251113C00680000 → { ticker: 'SPY', expiry: '2025-11-13', type: 'call', strike: 680 }
 */
export function parseOptionSymbol(optionSymbol: string): {
  ticker: string;
  expiry: string;
  optionType: 'call' | 'put';
  strikePrice: number;
} | null {
  try {
    // Remove leading dot if present
    const symbol = optionSymbol.startsWith('.') ? optionSymbol.slice(1) : optionSymbol;

    // OCC format regex: {TICKER}{YYMMDD}{C|P}{8-digit strike}
    const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
    
    if (!match) {
      console.warn(`Invalid option symbol format: ${optionSymbol}`);
      return null;
    }

    const [, ticker, dateStr, typeChar, strikeStr] = match;

    // Parse date (YYMMDD)
    const year = 2000 + parseInt(dateStr.slice(0, 2), 10);
    const month = dateStr.slice(2, 4);
    const day = dateStr.slice(4, 6);
    const expiry = `${year}-${month}-${day}`;

    // Parse option type
    const optionType = typeChar === 'C' ? 'call' as const : 'put' as const;

    // Parse strike price (8 digits with 3 decimals)
    const strikePrice = parseInt(strikeStr, 10) / 1000;

    return {
      ticker,
      expiry,
      optionType,
      strikePrice
    };
  } catch (error: any) {
    console.error(`Error parsing option symbol ${optionSymbol}:`, error.message);
    return null;
  }
}

/**
 * Convert canonical OCC symbol to Polygon WebSocket subscription topic format
 * Canonical: `.SPY251113C00680000`
 * Polygon:   `O:SPY251113C00680000`
 * @param canonicalSymbol Canonical OCC format with leading dot
 * @returns Polygon topic format (O: prefix without dot)
 */
export function toPolygonSubscriptionTopic(canonicalSymbol: string): string {
  // Remove leading dot if present and add O: prefix
  const withoutDot = canonicalSymbol.startsWith('.') ? canonicalSymbol.slice(1) : canonicalSymbol;
  return `O:${withoutDot}`;
}

/**
 * Convert canonical OCC symbol to Tastytrade option symbol format
 * Both use the same format (dot-prefixed OCC), so this is essentially a passthrough
 * Canonical:  `.SPY251113C00680000`
 * Tastytrade: `.SPY251113C00680000`
 * @param canonicalSymbol Canonical OCC format with leading dot
 * @returns Tastytrade format (same as canonical)
 */
export function toTastytradeOptionSymbol(canonicalSymbol: string): string {
  // Ensure it has a leading dot (canonical format)
  return canonicalSymbol.startsWith('.') ? canonicalSymbol : `.${canonicalSymbol}`;
}

/**
 * Normalize any option symbol format to canonical OCC format
 * Accepts:
 * - Polygon format: `O:SPY251113C00680000` → `.SPY251113C00680000`
 * - Tastytrade format: `.SPY251113C00680000` → `.SPY251113C00680000`
 * - Raw OCC format: `SPY251113C00680000` → `.SPY251113C00680000`
 * @param serviceSymbol Symbol in any service-specific format
 * @returns Canonical OCC format with leading dot
 */
export function normalizeOptionSymbol(serviceSymbol: string): string {
  // Remove O: prefix if present (Polygon format)
  let normalized = serviceSymbol.startsWith('O:') ? serviceSymbol.slice(2) : serviceSymbol;
  
  // Ensure leading dot (canonical format)
  normalized = normalized.startsWith('.') ? normalized : `.${normalized}`;
  
  return normalized;
}
