/**
 * Shared quote snapshot type used by all data services
 * Ensures consistent interface across Polygon, Tastytrade, and WebScraper services
 */
export interface QuoteSnapshot {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  volume: number;
  timestamp: number;
  source: 'polygon' | 'tastytrade' | 'scraper';
}

/**
 * Quote freshness threshold in milliseconds
 * Quotes older than this are considered stale
 */
export const QUOTE_FRESHNESS_THRESHOLD_MS = 10000; // 10 seconds
