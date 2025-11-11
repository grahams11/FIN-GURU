import { polygonService } from './polygonService';
import pLimit from 'p-limit';
import type { UoaTrade, InsertUoaTrade } from '@shared/schema';

/**
 * UOA (Unusual Options Activity) Scanner Service
 * 
 * Three-phase scanning approach:
 * Phase 1: Build curated 1K stock universe (S&P 500 + high-volume stocks)
 * Phase 2: Filter to 50-100 UOA candidates using Polygon snapshots
 * Phase 3: Score and rank top 5 winners (60% likelihood + 40% ROI)
 * 
 * Target: <30 seconds per scan with results cached for 20-30s
 */

interface StockCandidate {
  ticker: string;
  marketCap: number; // In billions
  avgDailyVolume: number;
}

interface UOACandidate extends StockCandidate {
  optionSymbol: string; // Polygon contract ID
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  stockPrice: number;
  premium: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  iv: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
  rsi: number;
  priceVolatility: number;
}

export class UoaScannerService {
  private static stockUniverse: StockCandidate[] = [];
  private static universeLastUpdated: number = 0;
  private static readonly UNIVERSE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly SCAN_CACHE_TTL = 25 * 1000; // 25 seconds
  
  // Concurrency limits to prevent API overload
  private static readonly PHASE2_CONCURRENCY = 10; // Max 10 parallel option chain requests
  
  /**
   * Phase 1: Build Curated Stock Universe
   * Fetches top 1000 stocks by market cap + volume
   * Caches for 24 hours
   */
  static async buildStockUniverse(): Promise<StockCandidate[]> {
    const now = Date.now();
    
    // Return cached universe if still valid
    if (this.stockUniverse.length > 0 && (now - this.universeLastUpdated) < this.UNIVERSE_CACHE_TTL) {
      console.log(`📚 Using cached stock universe (${this.stockUniverse.length} stocks)`);
      return this.stockUniverse;
    }
    
    console.log('🔄 Building fresh stock universe...');
    const startTime = Date.now();
    
    try {
      // Fetch from Polygon /v3/reference/tickers
      // Filter: market cap >$1B, avg daily volume >1M shares
      const tickers = await polygonService.getTopTickers({
        market: 'stocks',
        type: 'CS', // Common stock only
        limit: 1000,
        sort: 'market_cap',
        order: 'desc',
      });
      
      const candidates: StockCandidate[] = tickers
        .filter(t => t.market_cap && t.market_cap > 1_000_000_000) // >$1B market cap
        .map(t => ({
          ticker: t.ticker,
          marketCap: t.market_cap ? t.market_cap / 1_000_000_000 : 0, // Convert to billions
          avgDailyVolume: t.sip_volume || 0,
        }))
        .filter(c => c.avgDailyVolume > 1_000_000); // >1M daily volume
      
      this.stockUniverse = candidates;
      this.universeLastUpdated = now;
      
      const duration = Date.now() - startTime;
      console.log(`✅ Stock universe built: ${candidates.length} stocks in ${duration}ms`);
      
      return candidates;
    } catch (error) {
      console.error('❌ Error building stock universe:', error);
      
      // Fallback to curated list if API fails
      if (this.stockUniverse.length > 0) {
        console.log(`⚠️ Using stale universe (${this.stockUniverse.length} stocks)`);
        return this.stockUniverse;
      }
      
      // Hard-coded fallback for critical stocks
      return this.getFallbackUniverse();
    }
  }
  
  /**
   * Fallback universe if Polygon API fails
   * Returns curated list of liquid stocks
   */
  private static getFallbackUniverse(): StockCandidate[] {
    const fallbackTickers = [
      // Mega caps
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B',
      // Tech
      'NFLX', 'AMD', 'INTC', 'CRM', 'ORCL', 'ADBE', 'CSCO', 'QCOM',
      // Finance
      'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'SCHW',
      // Healthcare
      'UNH', 'JNJ', 'PFE', 'ABBV', 'TMO', 'MRK', 'LLY', 'ABT',
      // Consumer
      'WMT', 'PG', 'KO', 'PEP', 'COST', 'NKE', 'MCD', 'SBUX',
      // Energy
      'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO',
      // ETFs
      'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'EEM', 'GLD',
    ];
    
    return fallbackTickers.map(ticker => ({
      ticker,
      marketCap: 100, // Assume $100B+ for fallback
      avgDailyVolume: 10_000_000, // Assume 10M+ volume
    }));
  }
  
  /**
   * Phase 2: UOA Filtering
   * Scans option chains for unusual activity
   * Uses batched concurrency to prevent API overload
   */
  static async scanForUOA(universe: StockCandidate[]): Promise<UOACandidate[]> {
    console.log(`\n🔍 Phase 2: Scanning ${universe.length} stocks for UOA...`);
    const startTime = Date.now();
    
    const limit = pLimit(this.PHASE2_CONCURRENCY);
    const candidates: UOACandidate[] = [];
    
    // Process stocks in parallel with concurrency limit
    const promises = universe.map(stock => limit(async () => {
      try {
        return await this.analyzeStock(stock);
      } catch (error) {
        console.error(`Error analyzing ${stock.ticker}:`, error);
        return [];
      }
    }));
    
    const results = await Promise.all(promises);
    
    // Flatten and filter results
    for (const stockCandidates of results) {
      candidates.push(...stockCandidates);
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ Phase 2 complete: Found ${candidates.length} UOA candidates in ${(duration / 1000).toFixed(1)}s`);
    
    return candidates;
  }
  
  /**
   * Analyze a single stock for UOA signals
   * Returns array of option contracts meeting UOA criteria
   */
  private static async analyzeStock(stock: StockCandidate): Promise<UOACandidate[]> {
    try {
      // Get option chain snapshot from Polygon
      const snapshot = await polygonService.getOptionsSnapshot(stock.ticker);
      
      if (!snapshot || !snapshot.results || snapshot.results.length === 0) {
        return [];
      }
      
      const candidates: UOACandidate[] = [];
      const stockPrice = snapshot.underlying?.price || 0;
      
      // Filter options for UOA signals
      for (const contract of snapshot.results) {
        // Skip if missing critical data
        if (!contract.details || !contract.day || !contract.greeks) {
          continue;
        }
        
        const volume = contract.day.volume || 0;
        const openInterest = contract.open_interest || 1; // Prevent division by zero
        const uoaRatio = volume / openInterest;
        
        // UOA Filter: volume/OI ratio > 3x
        if (uoaRatio < 3) {
          continue;
        }
        
        // IV Filter: > 50th percentile (0.5 = 50%)
        const iv = contract.implied_volatility || 0;
        if (iv < 0.5) {
          continue;
        }
        
        // Volume Filter: > 1000 contracts minimum
        if (volume < 1000) {
          continue;
        }
        
        // Bid/Ask spread filter: < 0.5% (tight spreads only)
        const bid = contract.bid || 0;
        const ask = contract.ask || 0;
        const premium = (bid + ask) / 2;
        
        if (premium === 0) continue;
        
        const spread = ((ask - bid) / premium) * 100;
        if (spread > 0.5) {
          continue;
        }
        
        // Calculate price volatility (simplified - would need historical data for accuracy)
        const priceVolatility = 1.5; // Placeholder - implement with historical bars
        
        // Calculate RSI (simplified - would need historical data)
        const rsi = 50; // Placeholder - implement with historical bars
        
        candidates.push({
          ...stock,
          optionSymbol: contract.details.ticker || '',
          strike: contract.details.strike_price || 0,
          expiry: contract.details.expiration_date || '',
          optionType: contract.details.contract_type === 'call' ? 'call' : 'put',
          stockPrice,
          premium,
          bid,
          ask,
          volume,
          openInterest,
          iv,
          delta: contract.greeks.delta || 0,
          theta: contract.greeks.theta || 0,
          gamma: contract.greeks.gamma || 0,
          vega: contract.greeks.vega || 0,
          rsi,
          priceVolatility,
        });
      }
      
      return candidates;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Phase 3: Composite Scoring
   * Ranks candidates by 60% likelihood + 40% ROI
   * Returns top 5 winners
   */
  static async scoreAndRank(candidates: UOACandidate[]): Promise<InsertUoaTrade[]> {
    console.log(`\n🎯 Phase 3: Scoring ${candidates.length} candidates...`);
    const startTime = Date.now();
    
    const scoredTrades: InsertUoaTrade[] = [];
    
    for (const candidate of candidates) {
      const scores = this.calculateCompositeScore(candidate);
      
      // Filter: only keep if composite score > 70 and prob > 60%
      if (scores.compositeScore < 70 || scores.directionProb < 0.6) {
        continue;
      }
      
      const now = new Date();
      const cacheExpiry = new Date(now.getTime() + this.SCAN_CACHE_TTL);
      
      scoredTrades.push({
        ticker: candidate.ticker,
        optionSymbol: candidate.optionSymbol,
        optionType: candidate.optionType,
        strike: candidate.strike,
        expiry: candidate.expiry,
        stockPrice: candidate.stockPrice,
        premium: candidate.premium,
        bid: candidate.bid,
        ask: candidate.ask,
        volume: candidate.volume,
        openInterest: candidate.openInterest,
        uoaRatio: candidate.volume / candidate.openInterest,
        volumeVsAvg: 3.5, // Placeholder - implement with historical comparison
        iv: candidate.iv,
        ivPercentile: 65, // Placeholder - implement with IV rank calculation
        priceVolatility: candidate.priceVolatility,
        rsi: candidate.rsi,
        delta: candidate.delta,
        theta: candidate.theta,
        gamma: candidate.gamma,
        vega: candidate.vega,
        ...scores,
        marketCap: candidate.marketCap,
        avgDailyVolume: candidate.avgDailyVolume,
        bidAskSpread: ((candidate.ask - candidate.bid) / candidate.premium) * 100,
        rank: 0, // Will be set after sorting
        displayText: `${candidate.ticker} ${candidate.strike}${candidate.optionType === 'call' ? 'C' : 'P'} @ $${candidate.premium.toFixed(2)}`,
        scanTime: now,
        cacheExpiry,
      });
    }
    
    // Sort by composite score descending
    scoredTrades.sort((a, b) => b.compositeScore - a.compositeScore);
    
    // Take top 5 and assign ranks
    const top5 = scoredTrades.slice(0, 5).map((trade, index) => ({
      ...trade,
      rank: index + 1,
    }));
    
    const duration = Date.now() - startTime;
    console.log(`✅ Phase 3 complete: Top ${top5.length} plays scored in ${duration}ms`);
    
    return top5;
  }
  
  /**
   * Calculate composite score for a candidate
   * 60% Likelihood (UOA + Technical + Sentiment) + 40% ROI
   */
  private static calculateCompositeScore(candidate: UOACandidate) {
    // UOA Strength (20 points max)
    const uoaRatio = candidate.volume / candidate.openInterest;
    const uoaStrength = Math.min(20, (uoaRatio / 5) * 20); // 5x ratio = max score
    
    // Technical Alignment (20 points max)
    // RSI extremes: <30 (bullish) or >70 (bearish)
    let technicalScore = 0;
    if (candidate.optionType === 'call' && candidate.rsi < 30) {
      technicalScore = 20; // Oversold + calls = strong signal
    } else if (candidate.optionType === 'put' && candidate.rsi > 70) {
      technicalScore = 20; // Overbought + puts = strong signal
    } else {
      technicalScore = Math.abs(candidate.rsi - 50) / 2.5; // Scale based on distance from neutral
    }
    
    // Sentiment Score (20 points max) - Placeholder
    const sentimentScore = 15; // Would integrate news/social sentiment
    
    // ROI Potential (40 points max)
    // Implied move from IV × delta - premium cost
    const impliedMove = candidate.iv * candidate.stockPrice;
    const expectedGain = impliedMove * Math.abs(candidate.delta);
    const roiPotential = Math.min(40, (expectedGain / candidate.premium) * 10);
    
    // Likelihood Score (60% weight)
    const likelihoodScore = uoaStrength + technicalScore + sentimentScore;
    
    // Composite Score (0-100)
    const compositeScore = (likelihoodScore * 0.6) + (roiPotential * 0.4);
    
    // Direction Probability (0-1)
    const directionProb = Math.min(0.95, 0.5 + (uoaRatio / 20) + (Math.abs(candidate.delta) * 0.3));
    
    // Projected ROI
    const projectedROI = (expectedGain / candidate.premium) * 100;
    
    return {
      compositeScore,
      likelihoodScore,
      roiScore: roiPotential,
      uoaStrength,
      technicalAlignment: technicalScore,
      sentimentScore,
      roiPotential,
      directionProb,
      projectedROI,
      impliedMove,
      targetPrice: candidate.stockPrice + (candidate.optionType === 'call' ? impliedMove : -impliedMove),
      hasEarnings: false, // Placeholder - implement earnings calendar integration
      earningsDate: null,
      newsVolume: null,
      hasCatalyst: uoaRatio > 5, // High UOA is itself a catalyst
      catalystType: uoaRatio > 5 ? 'uoa' : null,
      nearSupport: false, // Placeholder - implement support/resistance detection
      nearResistance: false,
      priceLevel: 'neutral',
    };
  }
  
  /**
   * Main scan entry point
   * Executes all 3 phases and returns top 5 trades
   */
  static async scan(): Promise<InsertUoaTrade[]> {
    console.log('\n👻 ========== UOA SCANNER START ==========');
    const totalStart = Date.now();
    
    try {
      // Phase 1: Build stock universe
      const universe = await this.buildStockUniverse();
      
      // Phase 2: Scan for UOA signals
      const candidates = await this.scanForUOA(universe);
      
      // Phase 3: Score and rank
      const topTrades = await this.scoreAndRank(candidates);
      
      const totalTime = Date.now() - totalStart;
      console.log(`\n✅ UOA SCAN COMPLETE in ${(totalTime / 1000).toFixed(1)}s`);
      console.log(`📊 Results: ${topTrades.length} top plays`);
      
      return topTrades;
    } catch (error) {
      console.error('❌ UOA scan failed:', error);
      return [];
    }
  }
}
