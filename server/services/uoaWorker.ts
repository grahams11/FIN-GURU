import { ghostSweepDetector, type SweepAlert } from './ghostSweepDetector';
import { SweepCache } from './sweepCache';

/**
 * UOA Background Worker - Real-Time Sweep Detection
 * 
 * Replaced sequential scanning with event-driven WebSocket monitoring
 * Listens for institutional sweeps from Ghost Sweep Detector
 * Updates cache instantly for sub-100ms dashboard responses
 * 
 * OLD: Scan 500 stocks sequentially every 2 minutes (20 min scan time)
 * NEW: Real-time sweep detection via WebSocket (instant alerts)
 */

export class UoaWorker {
  private static initialized = false;
  
  /**
   * Start background worker - initialize Ghost Sweep Detector
   */
  static async start(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ UOA Worker already initialized');
      return;
    }

    console.log('🔄 Starting Real-Time UOA Worker...');
    
    // Initialize Ghost Sweep Detector
    const success = await ghostSweepDetector.initialize();
    
    if (!success) {
      console.error('❌ Failed to initialize Ghost Sweep Detector');
      return;
    }

    // Listen for ghost alerts (score 94+)
    ghostSweepDetector.on('ghostAlert', (sweep: SweepAlert) => {
      console.log(`🚨 Ghost Alert: ${sweep.ticker} ${sweep.side} $${sweep.strike} | Score ${sweep.phase4Score?.totalScore}/100 | Premium $${sweep.premium.toLocaleString()}`);
      this.handleGhostAlert(sweep);
    });

    // Initialize cache with empty state
    SweepCache.clear();

    this.initialized = true;
    console.log('✅ Real-Time UOA Worker active - monitoring for institutional sweeps');
    console.log(`📊 Watching ${20} high-volume tickers for $2M+ sweeps`);
  }
  
  /**
   * Stop background worker
   */
  static stop(): void {
    if (ghostSweepDetector) {
      ghostSweepDetector.cleanup();
      this.initialized = false;
      console.log('🛑 Real-Time UOA Worker stopped');
    }
  }
  
  /**
   * Handle incoming ghost alert
   * Update cache instantly
   */
  private static handleGhostAlert(sweep: SweepAlert): void {
    try {
      // Add sweep to cache (automatically manages top 50)
      SweepCache.add(sweep);
      
      console.log(`✅ Sweep cache updated - ${SweepCache.count()} total alerts`);
    } catch (error: any) {
      console.error('❌ Error handling ghost alert:', error.message);
    }
  }
  
  /**
   * Get current sweep alerts (for API endpoints)
   */
  static getRecentAlerts(): { sweeps: SweepAlert[]; lastUpdated: Date | null } {
    return SweepCache.get();
  }
  
  /**
   * Get top N sweeps by score
   */
  static getTopSweeps(n: number = 10): SweepAlert[] {
    return SweepCache.getTopN(n);
  }
}
