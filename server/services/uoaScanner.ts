import { polygonService } from './polygonService';
import { batchDataService, type StockSnapshot } from './batchDataService';
import pLimit from 'p-limit';
import type { UoaTrade, InsertUoaTrade } from '@shared/schema';
import { Phase4Scoring, type Phase4ScoreResult, type Phase4InputData } from './phase4Scoring';

/**
 * UOA (Unusual Options Activity) Scanner Service
 * 
 * OPTIMIZED STRATEGY:
 * - Uses shared BatchDataService (fetches ~9,000 stocks in ONE API call)
 * - Applies UOA filters locally (no additional API calls)
 * - Scans option chains only for UOA candidates (batched concurrency)
 * 
 * Three-phase scanning approach:
 * Phase 1: Get stock universe from BatchDataService (cached, shared with Elite Scanner)
 * Phase 2: Filter to 50-100 UOA candidates using volume/OI signals
 * Phase 3: Score and rank top 5 winners (60% likelihood + 40% ROI)
 * 
 * Target: <60 seconds per scan with minimal API usage
 */

interface StockCandidate {
  ticker: string;
  marketCap: number; // In billions
  avgDailyVolume: number;
  price: number;
  volume: number;
  changePercent: number;
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
  dte: number; // Days to expiry
}

/**
 * Symbol-level cache for Phase 4 scoring
 * Reuses option chain and metrics across all strikes for same symbol
 */
interface SymbolScanContext {
  ticker: string;
  optionContracts: any[]; // Full option chain snapshot
  historicalBars: any[] | null; // Historical bars for RSI
  maxPain: number | null; // Precomputed max pain
  ivSkew: { callIV: number; putIV: number } | null; // Precomputed IV skew
  rsi: number | null; // Precomputed RSI
  fetchedAt: number; // Timestamp for cache invalidation
}

export class UoaScannerService {
  private static readonly SCAN_CACHE_TTL = 25 * 1000; // 25 seconds
  
  // Concurrency limits to prevent API overload
  private static readonly PHASE2_CONCURRENCY = 10; // Max 10 parallel option chain requests
  
  // Symbol-level cache for Phase 4 scoring (shared across all strikes)
  private static symbolContextCache: Map<string, SymbolScanContext> = new Map();
  
  /**
   * Get or create SymbolScanContext for a ticker
   * Caches option chain and Phase 4 metrics to reuse across all strikes
   */
  private static async getSymbolContext(ticker: string, snapshot: any): Promise<SymbolScanContext> {
    // Check if cached and still valid
    const cached = this.symbolContextCache.get(ticker);
    const now = Date.now();
    
    if (cached && (now - cached.fetchedAt) < this.SCAN_CACHE_TTL) {
      return cached;
    }
    
    // Calculate Phase 4 symbol-level metrics from snapshot
    const optionContracts = snapshot.results || [];
    const maxPain = Phase4Scoring.calculateMaxPain(optionContracts);
    const ivSkew = Phase4Scoring.calculateIVSkew(optionContracts);
    
    // Note: historicalBars and RSI will be filled in batch later (after Phase 2)
    const context: SymbolScanContext = {
      ticker,
      optionContracts,
      historicalBars: null, // Filled later in batch
      maxPain,
      ivSkew,
      rsi: null, // Calculated from historicalBars later
      fetchedAt: now
    };
    
    this.symbolContextCache.set(ticker, context);
    return context;
  }
  
  /**
   * Clear symbol context cache (call at start of each scan)
   */
  private static clearSymbolContextCache(): void {
    this.symbolContextCache.clear();
  }
  
  /**
   * Batch fetch historical bars for top candidates (after Phase 2)
   * Only fetches for unique tickers to minimize API calls
   * Populates RSI in SymbolScanContext
   */
  private static async batchFetchHistoricalBars(candidates: UOACandidate[]): Promise<void> {
    console.log(`\n📊 Fetching historical bars for RSI calculation...`);
    const startTime = Date.now();
    
    // Get unique tickers from candidates
    const uniqueTickers = [...new Set(candidates.map(c => c.ticker))];
    console.log(`📈 Found ${uniqueTickers.length} unique tickers to fetch`);
    
    // Limit concurrency to avoid API rate limits
    const limit = pLimit(5);
    let successCount = 0;
    let errorCount = 0;
    
    await Promise.all(uniqueTickers.map(ticker => limit(async () => {
      try {
        const context = this.symbolContextCache.get(ticker);
        if (!context) return;
        
        // Fetch 30 days of historical bars for RSI (14-day period)
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        
        const bars = await polygonService.getHistoricalBars(
          ticker,
          fromDate.toISOString().split('T')[0],
          toDate.toISOString().split('T')[0]
        );
        
        if (bars && bars.length >= 15) {
          // Calculate RSI from bars
          const rsi = Phase4Scoring.calculateRSI(bars);
          
          // Update context
          context.historicalBars = bars;
          context.rsi = rsi;
          
          successCount++;
        } else {
          errorCount++;
        }
        
      } catch (error) {
        errorCount++;
      }
    })));
    
    const duration = Date.now() - startTime;
    console.log(`✅ Historical bars fetched: ${successCount} success, ${errorCount} failed in ${(duration / 1000).toFixed(1)}s`);
  }
  
  /**
   * Phase 1: Get Stock Universe from BatchDataService
   * Uses shared cache (same data as Elite Scanner)
   * NO additional API calls - data already fetched in bulk
   */
  static async buildStockUniverse(): Promise<StockCandidate[]> {
    console.log('📊 Getting stock universe from BatchDataService...');
    const startTime = Date.now();
    
    try {
      // Get cached bulk snapshot (shared with Elite Scanner)
      const universe = await batchDataService.getStockUniverse();
      
      // Filter for liquid stocks suitable for options trading
      const candidates: StockCandidate[] = universe
        .filter(stock => {
          // Must have price data
          if (!stock.price || stock.price <= 0) return false;
          
          // Filter out extreme penny stocks (< $5) and very expensive stocks
          if (stock.price < 5 || stock.price > 1000) return false;
          
          // Prefer stocks with market cap data, but don't require it (fallback data may not have it)
          // If market cap exists, require >$500M for decent liquidity
          if (stock.marketCap && stock.marketCap < 500_000_000) return false;
          
          // Must have volume data (>100K shares for minimal liquidity)
          // Lower threshold since we're using fallback data from previous days
          if (!stock.volume || stock.volume < 100_000) return false;
          
          return true;
        })
        .map(stock => ({
          ticker: stock.ticker,
          price: stock.price,
          marketCap: stock.marketCap ? stock.marketCap / 1_000_000_000 : 0, // Convert to billions, default to 0 if missing
          avgDailyVolume: stock.avgVolume || stock.volume,
          volume: stock.volume,
          changePercent: stock.changePercent || 0,
        }))
        .sort((a, b) => b.volume - a.volume); // Sort by today's volume (UOA indicator)
      
      const duration = Date.now() - startTime;
      console.log(`✅ Stock universe ready: ${candidates.length} liquid stocks in ${duration}ms (from shared cache)`);
      
      return candidates;
    } catch (error) {
      console.error('❌ Error getting stock universe:', error);
      
      // Hard-coded fallback for critical liquid stocks
      return this.getFallbackUniverse();
    }
  }
  
  /**
   * Fallback universe if BatchDataService fails
   * Uses top 20 most liquid stocks for options
   */
  private static getFallbackUniverse(): StockCandidate[] {
    const fallbackTickers = [
      'SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD',
      'JPM', 'BAC', 'WMT', 'DIS', 'NFLX', 'PYPL', 'INTC', 'CSCO', 'PFE', 'KO'
    ];
    
    return fallbackTickers.map(ticker => ({
      ticker,
      price: 100, // Placeholder
      marketCap: 100, // Assume $100B+ for fallback
      avgDailyVolume: 10_000_000, // Assume 10M+ volume
      volume: 10_000_000,
      changePercent: 0,
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
   * Now uses SymbolScanContext for Phase 4 integration
   */
  private static async analyzeStock(stock: StockCandidate): Promise<UOACandidate[]> {
    try {
      // Get option chain snapshot from Polygon
      const snapshot = await polygonService.getOptionsSnapshot(stock.ticker);
      
      if (!snapshot || !snapshot.results || snapshot.results.length === 0) {
        return [];
      }
      
      // Get or create symbol context (caches Phase 4 metrics)
      const symbolContext = await this.getSymbolContext(stock.ticker, snapshot);
      
      const candidates: UOACandidate[] = [];
      const stockPrice = snapshot.underlying?.price || 0;
      const now = new Date();
      
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
        
        // Calculate DTE (days to expiry)
        const expiryDate = new Date(contract.details.expiration_date);
        const dte = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        
        // Placeholder values (will be filled from symbol context later)
        const rsi = symbolContext.rsi || 50;
        const priceVolatility = 1.5;
        
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
          dte
        });
      }
      
      return candidates;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Phase 3: Hybrid Scoring (70% UOA + 30% Phase 4)
   * Applies Phase 4 gating and blends scores
   * Returns top 5 winners
   */
  static async scoreAndRank(candidates: UOACandidate[]): Promise<InsertUoaTrade[]> {
    console.log(`\n🎯 Phase 3: Hybrid Scoring ${candidates.length} candidates (70% UOA + 30% Phase 4)...`);
    const startTime = Date.now();
    
    const scoredTrades: InsertUoaTrade[] = [];
    let phase4Passed = 0;
    let phase4Failed = 0;
    
    for (const candidate of candidates) {
      // Get symbol context with Phase 4 metrics
      const context = this.symbolContextCache.get(candidate.ticker);
      
      // Update candidate RSI from context (populated by batchFetchHistoricalBars)
      if (context && context.rsi !== null) {
        candidate.rsi = context.rsi;
      }
      
      // Calculate original UOA composite score
      const uoaScores = this.calculateCompositeScore(candidate);
      
      // Calculate Phase 4 score using cached symbol metrics
      const phase4Input: Phase4InputData = {
        symbol: candidate.ticker,
        currentPrice: candidate.stockPrice,
        volume: candidate.volume,
        openInterest: candidate.openInterest,
        dte: candidate.dte,
        optionContracts: context?.optionContracts,
        historicalBars: context?.historicalBars || undefined,
        precomputedMaxPain: context?.maxPain || undefined,
        precomputedIvSkew: context?.ivSkew || undefined,
        precomputedRsi: context?.rsi || undefined
      };
      
      const phase4Score = Phase4Scoring.calculateScore(phase4Input);
      
      // Apply Phase 4 gating: must score ≥70 with ≥2 active layers
      if (!Phase4Scoring.meetsThreshold(phase4Score, 70, 2)) {
        phase4Failed++;
        continue;
      }
      
      phase4Passed++;
      
      // Hybrid scoring: 70% UOA + 30% Phase 4
      const hybridScore = (uoaScores.compositeScore * 0.7) + (phase4Score.totalScore * 0.3);
      
      // Filter: only keep if hybrid score > 70 and UOA prob > 60%
      if (hybridScore < 70 || uoaScores.directionProb < 0.6) {
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
        ...uoaScores,
        compositeScore: hybridScore, // Override with hybrid score
        marketCap: candidate.marketCap,
        avgDailyVolume: candidate.avgDailyVolume,
        bidAskSpread: ((candidate.ask - candidate.bid) / candidate.premium) * 100,
        rank: 0, // Will be set after sorting
        displayText: `${candidate.ticker} ${candidate.strike}${candidate.optionType === 'call' ? 'C' : 'P'} @ $${candidate.premium.toFixed(2)}`,
        scanTime: now,
        cacheExpiry,
        // Phase 4 metadata (for UI display)
        phase4Score: phase4Score.totalScore,
        phase4Layer1: phase4Score.layer1,
        phase4Layer2: phase4Score.layer2,
        phase4Layer3: phase4Score.layer3,
        phase4Layer4: phase4Score.layer4,
        phase4ActiveLayers: phase4Score.activeLayers,
      } as any); // TODO: Update schema to include phase4 fields
    }
    
    // Sort by hybrid score descending
    scoredTrades.sort((a, b) => b.compositeScore - a.compositeScore);
    
    // Take top 5 and assign ranks
    const top5 = scoredTrades.slice(0, 5).map((trade, index) => ({
      ...trade,
      rank: index + 1,
    }));
    
    const duration = Date.now() - startTime;
    console.log(`✅ Phase 3 complete: ${phase4Passed} passed Phase 4 gate, ${phase4Failed} failed`);
    console.log(`📊 Top ${top5.length} plays with hybrid scoring (70% UOA + 30% Phase 4) in ${duration}ms`);
    
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
   * Now with Phase 4 intelligence integration
   * Executes 4 phases: Stock Universe → UOA Filtering → Historical Data → Hybrid Scoring
   */
  static async scan(): Promise<InsertUoaTrade[]> {
    console.log('\n👻 ========== ENHANCED UOA SCANNER START (Phase 4) ==========');
    const totalStart = Date.now();
    
    try {
      // Clear symbol context cache from previous scan
      this.clearSymbolContextCache();
      
      // Phase 1: Build stock universe
      const universe = await this.buildStockUniverse();
      
      // Phase 2: Scan for UOA signals (caches max pain, IV skew per symbol)
      const candidates = await this.scanForUOA(universe);
      
      // Phase 2.5: Batch fetch historical bars for RSI (only for top candidates)
      if (candidates.length > 0) {
        await this.batchFetchHistoricalBars(candidates);
      }
      
      // Phase 3: Hybrid scoring (70% UOA + 30% Phase 4)
      const topTrades = await this.scoreAndRank(candidates);
      
      const totalTime = Date.now() - totalStart;
      console.log(`\n✅ ENHANCED UOA SCAN COMPLETE in ${(totalTime / 1000).toFixed(1)}s`);
      console.log(`📊 Results: ${topTrades.length} top plays with Phase 4 scoring`);
      
      return topTrades;
    } catch (error) {
      console.error('❌ UOA scan failed:', error);
      return [];
    }
  }
}
