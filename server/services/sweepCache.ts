import type { SweepAlert } from './ghostSweepDetector';

/**
 * Sweep Alerts Cache
 * Stores real-time institutional sweeps for instant dashboard access
 */

export class SweepCache {
  private static sweepAlerts: SweepAlert[] = [];
  private static lastUpdated: Date | null = null;

  /**
   * Get all sweep alerts
   */
  static get(): { sweeps: SweepAlert[]; lastUpdated: Date | null } {
    return {
      sweeps: this.sweepAlerts,
      lastUpdated: this.lastUpdated
    };
  }

  /**
   * Update sweep alerts cache
   */
  static set(sweeps: SweepAlert[]): void {
    this.sweepAlerts = sweeps;
    this.lastUpdated = new Date();
    console.log(`✅ Sweep cache updated: ${sweeps.length} alerts at ${this.lastUpdated.toLocaleTimeString()}`);
  }

  /**
   * Add a single sweep alert
   */
  static add(sweep: SweepAlert): void {
    this.sweepAlerts.unshift(sweep); // Add to beginning
    this.lastUpdated = new Date();
    
    // Keep only last 50 alerts
    if (this.sweepAlerts.length > 50) {
      this.sweepAlerts = this.sweepAlerts.slice(0, 50);
    }
    
    console.log(`✅ Added sweep alert: ${sweep.ticker} ${sweep.side} - Score ${sweep.phase4Score?.totalScore}/100`);
  }

  /**
   * Clear all sweep alerts
   */
  static clear(): void {
    this.sweepAlerts = [];
    this.lastUpdated = null;
  }

  /**
   * Get sweep count
   */
  static count(): number {
    return this.sweepAlerts.length;
  }

  /**
   * Get top N sweeps by score
   */
  static getTopN(n: number): SweepAlert[] {
    return this.sweepAlerts
      .filter(s => s.phase4Score)
      .sort((a, b) => (b.phase4Score?.totalScore || 0) - (a.phase4Score?.totalScore || 0))
      .slice(0, n);
  }
}
