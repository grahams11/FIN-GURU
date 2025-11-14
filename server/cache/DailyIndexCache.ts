/**
 * Daily Index Price Cache
 * Stores open and close prices for market indices to calculate accurate changePercent
 */

interface IndexPriceData {
  openPrice: number;
  closePrice: number | null;
  tradingDate: string; // YYYY-MM-DD format
  capturedAt: Date;
}

class DailyIndexCache {
  private cache: Map<string, IndexPriceData> = new Map();

  /**
   * Set the open price for an index (called at market open or pre-market)
   */
  setOpenPrice(symbol: string, openPrice: number, tradingDate: string): void {
    const existing = this.cache.get(symbol);
    
    // If it's a new trading day, reset the cache entry
    if (!existing || existing.tradingDate !== tradingDate) {
      this.cache.set(symbol, {
        openPrice,
        closePrice: null,
        tradingDate,
        capturedAt: new Date()
      });
      console.log(`📊 ${symbol}: Set open price $${openPrice.toFixed(2)} for ${tradingDate}`);
    } else {
      // Update open price for same day (in case we got better data)
      existing.openPrice = openPrice;
      existing.capturedAt = new Date();
      console.log(`📊 ${symbol}: Updated open price $${openPrice.toFixed(2)} for ${tradingDate}`);
    }
  }

  /**
   * Set the close price for an index (called at market close)
   */
  setClosePrice(symbol: string, closePrice: number, tradingDate: string): void {
    const existing = this.cache.get(symbol);
    
    if (existing && existing.tradingDate === tradingDate) {
      existing.closePrice = closePrice;
      existing.capturedAt = new Date();
      console.log(`📊 ${symbol}: Set close price $${closePrice.toFixed(2)} for ${tradingDate}`);
    } else {
      console.warn(`⚠️ ${symbol}: Cannot set close price - no open price for ${tradingDate}`);
    }
  }

  /**
   * Get the cached price data for an index
   */
  get(symbol: string): IndexPriceData | null {
    return this.cache.get(symbol) || null;
  }

  /**
   * Calculate changePercent based on market status
   * During market hours: (currentPrice - openPrice) / openPrice * 100
   * After hours: (closePrice - openPrice) / openPrice * 100
   */
  calculateChangePercent(symbol: string, currentPrice: number, isMarketOpen: boolean): number | null {
    const data = this.cache.get(symbol);
    
    if (!data || !data.openPrice) {
      console.warn(`⚠️ ${symbol}: No open price cached - cannot calculate changePercent`);
      return null;
    }

    if (isMarketOpen) {
      // During market hours: compare current price to open
      const changePercent = ((currentPrice - data.openPrice) / data.openPrice) * 100;
      console.log(`📊 ${symbol}: changePercent ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% (current $${currentPrice.toFixed(2)} vs open $${data.openPrice.toFixed(2)})`);
      return changePercent;
    } else {
      // After hours: use close price if available, otherwise use current price
      const referencePrice = data.closePrice || currentPrice;
      const changePercent = ((referencePrice - data.openPrice) / data.openPrice) * 100;
      console.log(`📊 ${symbol}: changePercent ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% (close $${referencePrice.toFixed(2)} vs open $${data.openPrice.toFixed(2)})`);
      return changePercent;
    }
  }

  /**
   * Clear cache for a specific trading date (called at market open for new day)
   */
  clearOldData(currentTradingDate: string): void {
    const entries = Array.from(this.cache.entries());
    for (const [symbol, data] of entries) {
      if (data.tradingDate !== currentTradingDate) {
        console.log(`🗑️ ${symbol}: Clearing old cache data from ${data.tradingDate}`);
        this.cache.delete(symbol);
      }
    }
  }

  /**
   * Get all cached data (for debugging)
   */
  getAll(): Map<string, IndexPriceData> {
    return new Map(this.cache);
  }
}

// Export singleton instance
export const dailyIndexCache = new DailyIndexCache();
