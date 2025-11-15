/**
 * Overnight Data Fetcher
 * 
 * Fetches real market data during overnight hours (3:01 PM - 8:29 AM CST):
 * - Polygon 1-min aggregates (3:00 PM - 7:00 PM CST extended hours)
 * - Real options chain snapshots
 * 
 * NO SIMULATION - Only real market data
 */

import { polygonService } from './polygonService';
import { eodCacheService, EODSnapshot } from './eodCache';
import { TimeUtils } from './timeUtils';
import { historicalDataCache } from './historicalDataCache';

export interface OvernightBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OvernightData {
  symbol: string;
  eodSnapshot: EODSnapshot;
  overnightBars: OvernightBar[];
  overnightHigh: number;
  overnightLow: number;
  overnightVolume: number;
  breakoutDetected: boolean; // true if overnight high > EOD high
  timestamp: number;
}

export interface OvernightOptionsChain {
  symbol: string;
  calls: OvernightOption[];
  puts: OvernightOption[];
  timestamp: number;
}

export interface OvernightOption {
  strike: number;
  expiry: string;
  dte: number;
  premium: number; // Mid-price
  bid: number;
  ask: number;
  lastPrice: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  volume: number;
  openInterest: number;
}

export class OvernightDataFetcher {
  private static instance: OvernightDataFetcher | null = null;
  
  private constructor() {}
  
  static getInstance(): OvernightDataFetcher {
    if (!OvernightDataFetcher.instance) {
      OvernightDataFetcher.instance = new OvernightDataFetcher();
    }
    return OvernightDataFetcher.instance;
  }
  
  /**
   * Check if we're currently in overnight hours (3:01 PM - 8:29 AM CST)
   * Delegates to TimeUtils for consistent timezone handling
   */
  isOvernightHours(): boolean {
    return TimeUtils.isOvernightHours();
  }
  
  /**
   * Get overnight aggregates for a symbol (3:00 PM - 7:00 PM CST)
   * Returns real 1-minute bars from Polygon
   */
  async getOvernightAggregates(symbol: string): Promise<OvernightData | null> {
    try {
      // PRIORITY 1: Use Historical Cache (PRIMARY SOURCE - always fresh, 30 days of data)
      let eodSnapshot: EODSnapshot | null = null;
      const historicalData = historicalDataCache.getHistoricalData(symbol);
      
      if (historicalData && historicalData.bars.length > 0) {
        // Get most recent bar from historical cache as EOD snapshot
        const mostRecentBar = historicalData.bars[historicalData.bars.length - 1];
        eodSnapshot = {
          symbol,
          date: new Date(mostRecentBar.timestamp).toISOString().split('T')[0],
          high: mostRecentBar.high,
          low: mostRecentBar.low,
          close: mostRecentBar.close,
          volume: mostRecentBar.volume,
          timestamp: mostRecentBar.timestamp
        };
        console.log(`✅ ${symbol}: Using historical cache (${new Date(mostRecentBar.timestamp).toISOString().split('T')[0]}, ${historicalData.bars.length} bars available)`);
      } else {
        // PRIORITY 2: Fallback to EOD cache (only if historical cache has no data)
        eodSnapshot = eodCacheService.getEODSnapshot(symbol);
        if (eodSnapshot) {
          console.log(`⚠️ ${symbol}: Fallback to EOD cache (${eodSnapshot.date}) - historical cache empty`);
        } else {
          console.warn(`⚠️ ${symbol}: No historical data or EOD snapshot available - skipping`);
          return null;
        }
      }
      
      // At this point, eodSnapshot is guaranteed to be non-null
      if (!eodSnapshot) {
        return null;
      }
      
      // Use the EOD snapshot date for overnight window
      // This ensures we always query the correct trading day, even after weekends/holidays
      const dateStr = eodSnapshot.date; // Already in YYYY-MM-DD format
      
      // Fetch 1-min bars from 3:00 PM - 7:00 PM CST (extended hours)
      const fromTime = `${dateStr} 15:00:00`;
      const toTime = `${dateStr} 19:00:00`;
      
      const bars = await polygonService.getMinuteAggregates(
        symbol,
        fromTime,
        toTime,
        true // unlimited mode for overnight scanning
      );
      
      if (!bars || bars.length === 0) {
        console.log(`📊 No overnight bars for ${symbol} (market may not have traded)`);
        return {
          symbol,
          eodSnapshot,
          overnightBars: [],
          overnightHigh: eodSnapshot.close,
          overnightLow: eodSnapshot.close,
          overnightVolume: 0,
          breakoutDetected: false,
          timestamp: Date.now()
        };
      }
      
      // Calculate overnight metrics (bars use {t, o, h, l, c, v} format from Polygon)
      const overnightHigh = Math.max(...bars.map((b: any) => b.h));
      const overnightLow = Math.min(...bars.map((b: any) => b.l));
      const overnightVolume = bars.reduce((sum: number, b: any) => sum + b.v, 0);
      
      // Detect breakout: overnight high > EOD high by 1%
      const breakoutDetected = overnightHigh > eodSnapshot.high * 1.01;
      
      return {
        symbol,
        eodSnapshot,
        overnightBars: bars.map((b: any) => ({
          timestamp: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v
        })),
        overnightHigh,
        overnightLow,
        overnightVolume,
        breakoutDetected,
        timestamp: Date.now()
      };
    } catch (error: any) {
      console.error(`Failed to fetch overnight bars for ${symbol}:`, error.message);
      
      // Fallback to historical daily bars for indicator calculation
      const eodSnapshot = eodCacheService.getEODSnapshot(symbol);
      if (!eodSnapshot) {
        console.warn(`⚠️ No EOD snapshot for ${symbol} - cannot provide fallback`);
        return null;
      }
      
      // OPTIMIZED: Use cached historical data (eliminates 99% of API calls)
      const cachedBars = historicalDataCache.getHistoricalBars(symbol);
      
      if (cachedBars && cachedBars.length >= 20) {
        console.log(`✅ ${symbol}: Using ${cachedBars.length} cached historical bars for indicators`);
        
        // Use cached bars directly (already in correct format)
        return {
          symbol,
          eodSnapshot,
          overnightBars: cachedBars,
          overnightHigh: eodSnapshot.high,
          overnightLow: eodSnapshot.low,
          overnightVolume: eodSnapshot.volume,
          breakoutDetected: false,
          timestamp: Date.now()
        };
      }
      
      // Only fetch live data if cache miss (rare case)
      try {
        console.log(`⚠️ ${symbol}: Cache miss - fetching historical daily bars from API...`);
        
        const endDate = new Date(eodSnapshot.date);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 30);
        
        const historicalBars = await polygonService.getHistoricalBars(
          symbol,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          'day',
          1,
          true // unlimited mode
        );
        
        if (historicalBars && historicalBars.length >= 20) {
          console.log(`✅ ${symbol}: Using ${historicalBars.length} historical daily bars for indicators`);
          
          const convertedBars = historicalBars.map((b: any) => ({
            timestamp: b.t,
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v
          }));
          
          return {
            symbol,
            eodSnapshot,
            overnightBars: convertedBars,
            overnightHigh: eodSnapshot.high,
            overnightLow: eodSnapshot.low,
            overnightVolume: eodSnapshot.volume,
            breakoutDetected: false,
            timestamp: Date.now()
          };
        }
      } catch (histError: any) {
        console.error(`Failed to fetch historical bars for ${symbol}:`, histError.message);
      }
      
      // Final fallback: Return EOD-only (will be skipped by scanner)
      console.log(`⚠️ ${symbol}: No historical data available - EOD-only mode`);
      return {
        symbol,
        eodSnapshot,
        overnightBars: [],
        overnightHigh: eodSnapshot.close,
        overnightLow: eodSnapshot.close,
        overnightVolume: 0,
        breakoutDetected: false,
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Get real options chain snapshot from Polygon
   * Uses /v3/snapshot/options/{symbol} endpoint
   */
  async getOvernightOptionsChain(symbol: string): Promise<OvernightOptionsChain | null> {
    try {
      // Polygon snapshot endpoint for options
      const snapshot = await polygonService.getOptionsSnapshot(symbol);
      
      if (!snapshot) {
        console.warn(`⚠️ No options chain snapshot for ${symbol}`);
        return null;
      }
      
      return {
        symbol,
        calls: snapshot.calls || [],
        puts: snapshot.puts || [],
        timestamp: Date.now()
      };
    } catch (error: any) {
      console.error(`Failed to fetch overnight options chain for ${symbol}:`, error.message);
      return null;
    }
  }
  
  /**
   * Get overnight setup data for Elite Scanner
   * Combines EOD baseline + overnight aggregates + options chain
   * Returns partial data when overnight bars/chain unavailable (degrades gracefully)
   */
  async getOvernightSetup(symbol: string): Promise<{
    data: OvernightData;
    chain: OvernightOptionsChain | null;
  } | null> {
    try {
      const [data, chain] = await Promise.all([
        this.getOvernightAggregates(symbol),
        this.getOvernightOptionsChain(symbol)
      ]);
      
      // Only require EOD snapshot - overnight bars and chain are optional
      if (!data) {
        return null;
      }
      
      return { data, chain };
    } catch (error: any) {
      console.error(`Failed to fetch overnight setup for ${symbol}:`, error.message);
      return null;
    }
  }
}

// Export singleton instance
export const overnightDataFetcher = OvernightDataFetcher.getInstance();
