/**
 * Market Status Service
 * 
 * Centralized service to detect if the US stock market is currently open.
 * Caches status and refreshes periodically to avoid redundant calculations.
 * 
 * Market Hours: 9:30 AM - 4:00 PM ET (Mon-Fri)
 */

export interface MarketStatus {
  isOpen: boolean;
  currentTime: Date;
  marketOpenTime: string; // "09:30"
  marketCloseTime: string; // "16:00"
  nextOpenTime?: Date;
  nextCloseTime?: Date;
}

export class MarketStatusService {
  private static instance: MarketStatusService | null = null;
  private cachedStatus: MarketStatus | null = null;
  private lastCheckTime: number = 0;
  private readonly CACHE_DURATION_MS = 60_000; // 60 seconds
  
  private readonly MARKET_OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM = 570 minutes
  private readonly MARKET_CLOSE_MINUTES = 16 * 60; // 4:00 PM = 960 minutes
  
  private constructor() {
    // Start auto-refresh
    this.startAutoRefresh();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): MarketStatusService {
    if (!MarketStatusService.instance) {
      MarketStatusService.instance = new MarketStatusService();
    }
    return MarketStatusService.instance;
  }
  
  /**
   * Check if market is currently open
   * Returns cached value if check was recent (<60s ago)
   */
  isMarketOpen(): boolean {
    const now = Date.now();
    
    // Use cached value if still fresh
    if (this.cachedStatus && (now - this.lastCheckTime) < this.CACHE_DURATION_MS) {
      return this.cachedStatus.isOpen;
    }
    
    // Refresh cache
    this.refreshStatus();
    return this.cachedStatus?.isOpen ?? false;
  }
  
  /**
   * Get full market status with timing details
   */
  getMarketStatus(): MarketStatus {
    const now = Date.now();
    
    // Use cached value if still fresh
    if (this.cachedStatus && (now - this.lastCheckTime) < this.CACHE_DURATION_MS) {
      return this.cachedStatus;
    }
    
    // Refresh cache
    this.refreshStatus();
    return this.cachedStatus!;
  }
  
  /**
   * Force refresh of market status (bypasses cache)
   */
  refreshStatus(): void {
    const now = new Date();
    
    // Get current time in ET timezone using a single formatter for consistency
    const etTimeString = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Parse "HH:MM" format
    const [hourStr, minuteStr] = etTimeString.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    const timeInMinutes = hour * 60 + minute;
    
    // Check if it's a weekday in ET timezone
    const dayOfWeek = now.toLocaleDateString('en-US', { 
      timeZone: 'America/New_York', 
      weekday: 'short' 
    });
    const isWeekday = !['Sat', 'Sun'].includes(dayOfWeek);
    
    // Market is open if: weekday AND between 9:30 AM - 4:00 PM ET
    const isOpen = isWeekday && 
                   timeInMinutes >= this.MARKET_OPEN_MINUTES && 
                   timeInMinutes < this.MARKET_CLOSE_MINUTES;
    
    this.cachedStatus = {
      isOpen,
      currentTime: now,
      marketOpenTime: '09:30',
      marketCloseTime: '16:00',
      nextOpenTime: this.calculateNextOpenTime(now),
      nextCloseTime: isOpen ? this.calculateNextCloseTime(now) : undefined
    };
    
    this.lastCheckTime = Date.now();
  }
  
  /**
   * Calculate next market open time
   */
  private calculateNextOpenTime(now: Date): Date {
    const nextOpen = new Date(now);
    nextOpen.setHours(9, 30, 0, 0);
    
    // If market already opened today, move to next weekday
    if (now.getHours() >= 16 || now.getDay() === 0 || now.getDay() === 6) {
      nextOpen.setDate(nextOpen.getDate() + 1);
      
      // Skip weekend
      while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 1);
      }
    }
    
    return nextOpen;
  }
  
  /**
   * Calculate next market close time (today at 4:00 PM ET)
   */
  private calculateNextCloseTime(now: Date): Date {
    const nextClose = new Date(now);
    nextClose.setHours(16, 0, 0, 0);
    return nextClose;
  }
  
  /**
   * Auto-refresh status every 60 seconds
   */
  private startAutoRefresh(): void {
    setInterval(() => {
      this.refreshStatus();
      
      // Log status changes
      if (this.cachedStatus) {
        const emoji = this.cachedStatus.isOpen ? '🟢' : '🔴';
        console.log(`${emoji} Market Status: ${this.cachedStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
      }
    }, this.CACHE_DURATION_MS);
  }
}

// Export singleton instance
export const marketStatusService = MarketStatusService.getInstance();
