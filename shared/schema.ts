import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const marketData = pgTable("market_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  price: real("price").notNull(),
  change: real("change").notNull(),
  changePercent: real("change_percent").notNull(),
  volume: integer("volume"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const optionsTrade = pgTable("options_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  optionSymbol: text("option_symbol"), // OCC format for live premium fetching (e.g., ".SPY251113C00680000")
  optionType: text("option_type"), // 'call' | 'put'
  currentPrice: real("current_price").notNull(),
  strikePrice: real("strike_price").notNull(),
  expiry: text("expiry").notNull(),
  stockEntryPrice: real("stock_entry_price"), // Stock purchase price at market execution (optional for backward compatibility)
  stockExitPrice: real("stock_exit_price"), // Target stock price at exit
  premium: real("premium"), // Actual option premium cost (optional for backward compatibility)
  entryPrice: real("entry_price").notNull(), // Kept for backward compatibility
  exitPrice: real("exit_price"),
  holdDays: integer("hold_days"), // Projected hold period in days
  totalCost: real("total_cost"), // Total investment required (contracts × premium × 100)
  contracts: integer("contracts").notNull(),
  projectedROI: real("projected_roi").notNull(),
  aiConfidence: real("ai_confidence").notNull(),
  greeks: jsonb("greeks").notNull(),
  sentiment: real("sentiment"),
  score: real("score").notNull(),
  fibonacciLevel: real("fibonacci_level"), // 0.707 or 0.618 if bouncing off Fibonacci level
  fibonacciColor: text("fibonacci_color"), // 'gold' for 0.707, 'green' for 0.618
  estimatedProfit: real("estimated_profit"), // Dollar amount profit (not percentage)
  isExecuted: boolean("is_executed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketConfidence: real("market_confidence").notNull(),
  volatilityForecast: text("volatility_forecast").notNull(),
  bestTimeFrame: text("best_time_frame").notNull(),
  sentimentScore: real("sentiment_score").notNull(),
  insights: jsonb("insights").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const portfolioPositions = pgTable("portfolio_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  ticker: text("ticker").notNull(),
  positionType: text("position_type").notNull(), // 'options' | 'stock'
  quantity: integer("quantity").notNull(),
  avgCost: real("avg_cost").notNull(),
  currentPrice: real("current_price"),
  unrealizedPnL: real("unrealized_pnl"),
  realizedPnL: real("realized_pnl").default(0),
  openDate: timestamp("open_date").defaultNow(),
  closeDate: timestamp("close_date"),
  status: text("status").default("open"), // 'open' | 'closed'
  metadata: jsonb("metadata"), // For options: strike, expiry, type, etc.
});

export const tradeHistory = pgTable("trade_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  positionId: varchar("position_id").references(() => portfolioPositions.id),
  tradeType: text("trade_type").notNull(), // 'buy' | 'sell' | 'exercise' | 'expire'
  ticker: text("ticker").notNull(),
  quantity: integer("quantity").notNull(),
  price: real("price").notNull(),
  fees: real("fees").default(0),
  totalValue: real("total_value").notNull(),
  tradeDate: timestamp("trade_date").defaultNow(),
  notes: text("notes"),
});

export const watchlists = pgTable("watchlists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  watchlistId: varchar("watchlist_id").references(() => watchlists.id),
  ticker: text("ticker").notNull(),
  notes: text("notes"),
  addedAt: timestamp("added_at").defaultNow(),
});

export const priceAlerts = pgTable("price_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  ticker: text("ticker").notNull(),
  alertType: text("alert_type").notNull(), // 'above' | 'below'
  targetPrice: real("target_price").notNull(),
  currentPrice: real("current_price"),
  isActive: boolean("is_active").default(true),
  isTriggered: boolean("is_triggered").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  triggeredAt: timestamp("triggered_at"),
});

export const backtestRuns = pgTable("backtest_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbolUniverse: text("symbol_universe").array(), // Optional list of symbols to test, null = all market
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  timeframe: text("timeframe").notNull().default('1d'), // '1d' | '4h'
  warmupLookback: integer("warmup_lookback").notNull().default(14), // Days for RSI calculation
  config: jsonb("config"), // Strategy parameters used
  totalTrades: integer("total_trades").default(0),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  winRate: real("win_rate"), // Percentage
  avgROI: real("avg_roi"), // Average return on investment
  profitFactor: real("profit_factor"), // Gross profit / gross loss
  maxDrawdown: real("max_drawdown"), // Maximum peak-to-trough decline
  sharpeRatio: real("sharpe_ratio"), // Risk-adjusted return metric
  status: text("status").notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed'
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});

export const backtestTrades = pgTable("backtest_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").references(() => backtestRuns.id, { onDelete: 'cascade' }).notNull(),
  ticker: text("ticker").notNull(),
  optionType: text("option_type").notNull(), // 'call' | 'put'
  strike: real("strike").notNull(),
  expiry: timestamp("expiry").notNull(),
  entryDate: timestamp("entry_date").notNull(),
  exitDate: timestamp("exit_date"),
  entryPremium: real("entry_premium").notNull(),
  exitPremium: real("exit_premium"),
  exitReason: text("exit_reason"), // 'target' | 'stop' | 'expiry' | 'signal'
  contracts: integer("contracts").notNull(),
  pnl: real("pnl"), // Profit/loss in dollars
  roi: real("roi"), // Return on investment percentage
  maxDrawdown: real("max_drawdown"), // Max decline during hold
  signals: jsonb("signals"), // RSI, VIX, Fibonacci data at entry
  marketContext: jsonb("market_context"), // Market conditions at entry
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Elite Strategy: Recommendation Tracking
export const recommendationTracking = pgTable("recommendation_tracking", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  optionType: text("option_type").notNull(), // 'call' | 'put'
  recommendationType: text("recommendation_type").notNull(), // 'day_trade' | 'swing_trade'
  strikePrice: real("strike_price").notNull(),
  expiry: text("expiry").notNull(),
  entryPrice: real("entry_price").notNull(), // Stock price at recommendation
  premium: real("premium").notNull(), // Option premium at recommendation
  contracts: integer("contracts").notNull(),
  projectedROI: real("projected_roi").notNull(),
  aiConfidence: real("ai_confidence").notNull(),
  
  // Signal metrics at entry
  rsi: real("rsi").notNull(),
  vix: real("vix").notNull(),
  ema: real("ema"),
  atrShort: real("atr_short"),
  atrLong: real("atr_long"),
  fibonacciLevel: real("fibonacci_level"),
  
  // Greeks at entry
  delta: real("delta"),
  theta: real("theta"),
  gamma: real("gamma"),
  vega: real("vega"),
  
  // Strategy parameters used
  strategyVersion: text("strategy_version").notNull(),
  parameters: jsonb("parameters").notNull(), // RSI thresholds, VIX mins, etc.
  
  // Status tracking
  status: text("status").notNull().default('pending'), // 'pending' | 'monitoring' | 'closed' | 'expired'
  recommendedAt: timestamp("recommended_at").defaultNow(),
}, (table) => ({
  // Fast lookup by strategy version and date for learning analysis
  strategyVersionIdx: {
    columns: [table.strategyVersion, table.recommendedAt],
    name: "idx_tracking_strategy_date",
  },
  // GIN index for JSONB parameters filtering
  parametersIdx: {
    columns: [table.parameters],
    name: "idx_tracking_parameters",
  },
}));

// Elite Strategy: Performance Monitoring
export const recommendationPerformance = pgTable("recommendation_performance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recommendationId: varchar("recommendation_id").references(() => recommendationTracking.id, { onDelete: 'cascade' }).notNull(),
  
  // Actual outcome
  exitDate: timestamp("exit_date"),
  exitPrice: real("exit_price"), // Actual stock price at exit
  exitPremium: real("exit_premium"), // Actual option premium at exit
  actualROI: real("actual_roi"), // Actual return on investment
  actualProfit: real("actual_profit"), // Dollar profit/loss
  
  // Exit analysis
  exitReason: text("exit_reason"), // 'profit_target' | 'stop_loss' | 'time_based' | 'manual' | 'expiry'
  holdDays: integer("hold_days"), // Actual days held
  maxDrawdown: real("max_drawdown"), // Worst drawdown during hold
  maxProfit: real("max_profit"), // Best profit during hold
  
  // Win/loss classification
  isWin: boolean("is_win"), // Did it meet profit target?
  isLoss: boolean("is_loss"), // Did it hit stop loss?
  
  // Performance tracking
  updatedAt: timestamp("updated_at").defaultNow(),
  closedAt: timestamp("closed_at"),
}, (table) => ({
  // Fast lookup for learning analysis
  recommendationClosedIdx: {
    columns: [table.recommendationId, table.closedAt],
    name: "idx_performance_rec_closed",
  },
}));

// Elite Strategy: Adaptive Parameter History
export const strategyParameters = pgTable("strategy_parameters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  version: text("version").notNull(), // Semantic version or timestamp
  
  // RSI parameters
  rsiOversold: real("rsi_oversold").notNull(),
  rsiOverbought: real("rsi_overbought").notNull(),
  
  // VIX parameters
  vixMinCall: real("vix_min_call").notNull(),
  vixMinPut: real("vix_min_put").notNull(),
  
  // Stop/target parameters
  stopLoss: real("stop_loss").notNull(),
  profitTarget: real("profit_target").notNull(),
  partialProfitLevel: real("partial_profit_level"),
  partialProfitPercent: real("partial_profit_percent"),
  
  // Filter parameters
  emaLength: integer("ema_length"),
  atrMultiplier: real("atr_multiplier"),
  deltaMin: real("delta_min"),
  deltaMax: real("delta_max"),
  
  // Performance metrics (rolling 30-day)
  winRate: real("win_rate"), // Win rate with these parameters
  avgROI: real("avg_roi"), // Average ROI
  profitFactor: real("profit_factor"), // Gross profit / gross loss
  totalTrades: integer("total_trades"), // Sample size
  
  // Reason for adjustment
  adjustmentReason: text("adjustment_reason"),
  previousVersion: text("previous_version"),
  
  // Status
  isActive: boolean("is_active").default(false), // Only one active at a time
  activatedAt: timestamp("activated_at").defaultNow(),
  deactivatedAt: timestamp("deactivated_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// UOA (Unusual Options Activity) Scanner
export const uoaTrades = pgTable("uoa_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  optionSymbol: varchar("option_symbol").notNull(), // Polygon contract identifier (e.g., O:SPY251121C00700000)
  optionType: text("option_type").notNull(), // 'call' | 'put'
  strike: real("strike").notNull(),
  expiry: text("expiry").notNull(),
  
  // Pricing
  stockPrice: real("stock_price").notNull(),
  premium: real("premium").notNull(),
  bid: real("bid").notNull(),
  ask: real("ask").notNull(),
  
  // UOA Metrics (Primary Signal)
  volume: integer("volume").notNull(),
  openInterest: integer("open_interest").notNull(),
  uoaRatio: real("uoa_ratio").notNull(), // volume / open_interest (target >3x)
  volumeVsAvg: real("volume_vs_avg").notNull(), // Current volume vs 5-day avg (target >3x)
  
  // Volatility & Technical
  iv: real("iv").notNull(), // Implied volatility
  ivPercentile: real("iv_percentile").notNull(), // IV rank (0-100, target >50)
  priceVolatility: real("price_volatility").notNull(), // Price vol vs 20-day avg (target >1.5x)
  rsi: real("rsi").notNull(), // RSI(14) for direction (<30 bullish, >70 bearish)
  
  // Greeks
  delta: real("delta").notNull(),
  theta: real("theta").notNull(),
  gamma: real("gamma").notNull(),
  vega: real("vega").notNull(),
  
  // Composite Score (0-100)
  compositeScore: real("composite_score").notNull(), // Overall score (target >70)
  likelihoodScore: real("likelihood_score").notNull(), // 60% weight: UOA + technical + sentiment
  roiScore: real("roi_score").notNull(), // 40% weight: IV move × delta - premium
  
  // Score Components
  uoaStrength: real("uoa_strength").notNull(), // 20 points max
  technicalAlignment: real("technical_alignment").notNull(), // 20 points max
  sentimentScore: real("sentiment_score").notNull(), // 20 points max
  roiPotential: real("roi_potential").notNull(), // 40 points max
  
  // Directional Probability
  directionProb: real("direction_prob").notNull(), // Probability of move (target >60%)
  
  // ROI Projection
  projectedROI: real("projected_roi").notNull(), // Expected return % (target >150%)
  impliedMove: real("implied_move").notNull(), // Expected price move from IV
  targetPrice: real("target_price"), // Projected target price
  
  // Catalyst Flags
  hasEarnings: boolean("has_earnings").default(false), // Earnings within 7 days
  earningsDate: text("earnings_date"),
  newsVolume: real("news_volume"), // News volume vs avg (>2x = catalyst)
  hasCatalyst: boolean("has_catalyst").default(false), // Any identified catalyst
  catalystType: text("catalyst_type"), // 'earnings' | 'news' | 'uoa' | 'technical'
  
  // Price Action
  nearSupport: boolean("near_support").default(false), // Price near 50 SMA support
  nearResistance: boolean("near_resistance").default(false), // Price near resistance
  priceLevel: text("price_level"), // 'support' | 'resistance' | 'neutral'
  
  // Market Cap & Liquidity Filters
  marketCap: real("market_cap"), // In billions
  avgDailyVolume: integer("avg_daily_volume"), // 20-day avg stock volume
  bidAskSpread: real("bid_ask_spread"), // Spread percentage (target <0.5%)
  
  // Display & Ranking
  rank: integer("rank").notNull(), // 1-5 for top plays
  displayText: text("display_text"), // Human-readable summary
  
  // Cache Control
  scanTime: timestamp("scan_time").notNull(), // When this was scanned
  cacheExpiry: timestamp("cache_expiry").notNull(), // When to refresh (scan_time + 20-30s)
  createdAt: timestamp("created_at").defaultNow(),
  
  // Scanner Type & Phase 4 Enhancement (Added 11/12/2025)
  scannerType: text("scanner_type"), // 'uoa' | 'elite' - differentiates scanner source
  phase4Score: real("phase4_score"), // Total Phase 4 score (0-100), null for legacy/Elite
  phase4Layer1: real("phase4_layer1"), // Max Pain + Gamma Trap (0-30)
  phase4Layer2: real("phase4_layer2"), // IV Skew Inversion (0-25)
  phase4Layer3: real("phase4_layer3"), // Ghost Sweep Detection (0-30)
  phase4Layer4: real("phase4_layer4"), // RSI Extreme + DTE (0-15)
  phase4ActiveLayers: integer("phase4_active_layers"), // Count of active layers (0-4)
}, (table) => ({
  // Performance indexes for fast cache queries (<100ms target)
  cacheExpiryIdx: {
    columns: [table.cacheExpiry],
    name: "idx_uoa_cache_expiry",
  },
  scanRankIdx: {
    columns: [table.scanTime, table.rank],
    name: "idx_uoa_scan_rank",
  },
  // Prevent duplicate contracts per scan batch
  uniqueScanContract: {
    columns: [table.scanTime, table.optionSymbol],
    name: "unique_scan_contract",
  },
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({
  id: true,
  timestamp: true,
});

export const insertOptionsTradeSchema = createInsertSchema(optionsTrade).omit({
  id: true,
  createdAt: true,
});

export const insertAiInsightsSchema = createInsertSchema(aiInsights).omit({
  id: true,
  timestamp: true,
});

export const insertPortfolioPositionSchema = createInsertSchema(portfolioPositions).omit({
  id: true,
  openDate: true,
});

export const insertTradeHistorySchema = createInsertSchema(tradeHistory).omit({
  id: true,
  tradeDate: true,
});

export const insertWatchlistSchema = createInsertSchema(watchlists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).omit({
  id: true,
  addedAt: true,
});

export const insertPriceAlertSchema = createInsertSchema(priceAlerts).omit({
  id: true,
  createdAt: true,
});

export const insertBacktestRunSchema = createInsertSchema(backtestRuns).omit({
  id: true,
  startedAt: true,
});

export const insertBacktestTradeSchema = createInsertSchema(backtestTrades).omit({
  id: true,
  createdAt: true,
});

export const insertRecommendationTrackingSchema = createInsertSchema(recommendationTracking).omit({
  id: true,
  recommendedAt: true,
});

export const insertRecommendationPerformanceSchema = createInsertSchema(recommendationPerformance).omit({
  id: true,
  updatedAt: true,
});

export const insertStrategyParametersSchema = createInsertSchema(strategyParameters).omit({
  id: true,
  createdAt: true,
});

export const insertUoaTradeSchema = createInsertSchema(uoaTrades).omit({
  id: true,
  createdAt: true,
});

// AI Learning: Market Insights (AI-discovered patterns)
export const marketInsights = pgTable("market_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  insightType: text("insight_type").notNull(), // 'pattern' | 'correlation' | 'regime' | 'anomaly'
  pattern: text("pattern").notNull(), // Human-readable pattern description
  conditions: jsonb("conditions").notNull(), // Structured conditions {rsi: '<25', vix: '>20', sector: 'tech'}
  winRate: real("win_rate").notNull(), // Historical win rate for this pattern
  sampleSize: integer("sample_size").notNull(), // Number of trades matching this pattern
  avgROI: real("avg_roi"), // Average ROI when pattern occurs
  confidence: real("confidence").notNull(), // Statistical confidence (0-1)
  discoveredBy: text("discovered_by").notNull(), // 'grok_analysis' | 'backtest' | 'manual'
  marketRegime: text("market_regime"), // 'bull' | 'bear' | 'volatile' | 'choppy' | null (applies to all)
  sector: text("sector"), // Specific sector or null (applies to all)
  discoveredAt: timestamp("discovered_at").defaultNow(),
  lastValidatedAt: timestamp("last_validated_at"),
  isActive: boolean("is_active").default(true), // Deactivate if pattern stops working
  deactivatedReason: text("deactivated_reason"),
}, (table) => ({
  // Fast lookup for active, high-confidence insights
  activeConfidenceIdx: {
    columns: [table.isActive, table.confidence],
    name: "idx_insights_active_confidence",
  },
  // GIN index for JSONB conditions filtering
  conditionsIdx: {
    columns: [table.conditions],
    name: "idx_insights_conditions",
  },
}));

// AI Learning: Performance Metrics (Materialized aggregates)
export const performanceMetrics = pgTable("performance_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyVersion: text("strategy_version").notNull(),
  marketRegime: text("market_regime").notNull(), // 'bull' | 'bear' | 'volatile' | 'choppy' | 'all'
  timeframe: text("timeframe").notNull().default('30d'), // '7d' | '30d' | '90d' | 'all_time'
  
  // Performance stats
  winRate: real("win_rate").notNull(), // Percentage of winning trades
  avgROI: real("avg_roi").notNull(), // Average return on investment
  profitFactor: real("profit_factor"), // Gross profit / gross loss
  sharpeRatio: real("sharpe_ratio"), // Risk-adjusted return
  maxDrawdown: real("max_drawdown"), // Maximum peak-to-trough decline
  
  // Sample size
  totalTrades: integer("total_trades").notNull(),
  winningTrades: integer("winning_trades").notNull(),
  losingTrades: integer("losing_trades").notNull(),
  
  // Breakdown by option type
  callWinRate: real("call_win_rate"),
  putWinRate: real("put_win_rate"),
  
  // Metadata
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Fast lookup by strategy + regime
  strategyRegimeIdx: {
    columns: [table.strategyVersion, table.marketRegime, table.timeframe],
    name: "idx_metrics_strategy_regime",
  },
  // Fast lookup for latest metrics
  updatedIdx: {
    columns: [table.lastUpdated],
    name: "idx_metrics_updated",
  },
}));

// AI Learning: Learning Sessions (Audit trail)
export const learningSessions = pgTable("learning_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionType: text("session_type").notNull(), // 'outcome_analysis' | 'pattern_discovery' | 'parameter_optimization'
  analysisPeriod: jsonb("analysis_period").notNull(), // {startDate, endDate}
  tradesAnalyzed: integer("trades_analyzed").notNull(),
  insightsGenerated: integer("insights_generated").default(0),
  parametersAdjusted: boolean("parameters_adjusted").default(false),
  newStrategyVersion: text("new_strategy_version"),
  previousStrategyVersion: text("previous_strategy_version"),
  summary: jsonb("summary"), // Key findings from Grok {findings: [], recommendations: []}
  grokReasoning: text("grok_reasoning"), // Full Grok reasoning text
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").default('running'), // 'running' | 'completed' | 'failed'
  errorMessage: text("error_message"),
}, (table) => ({
  // Fast lookup for recent sessions
  startedIdx: {
    columns: [table.startedAt],
    name: "idx_sessions_started",
  },
  // Fast lookup by type
  typeStatusIdx: {
    columns: [table.sessionType, table.status],
    name: "idx_sessions_type_status",
  },
}));

export const insertMarketInsightSchema = createInsertSchema(marketInsights).omit({
  id: true,
  discoveredAt: true,
});

export const insertPerformanceMetricsSchema = createInsertSchema(performanceMetrics).omit({
  id: true,
  lastUpdated: true,
  createdAt: true,
});

export const insertLearningSessionSchema = createInsertSchema(learningSessions).omit({
  id: true,
  startedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type OptionsTrade = typeof optionsTrade.$inferSelect;
export type InsertOptionsTrade = z.infer<typeof insertOptionsTradeSchema>;
export type AiInsights = typeof aiInsights.$inferSelect;
export type InsertAiInsights = z.infer<typeof insertAiInsightsSchema>;
export type PortfolioPosition = typeof portfolioPositions.$inferSelect;
export type InsertPortfolioPosition = z.infer<typeof insertPortfolioPositionSchema>;
export type TradeHistory = typeof tradeHistory.$inferSelect;
export type InsertTradeHistory = z.infer<typeof insertTradeHistorySchema>;
export type Watchlist = typeof watchlists.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type PriceAlert = typeof priceAlerts.$inferSelect;
export type InsertPriceAlert = z.infer<typeof insertPriceAlertSchema>;
export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
export type BacktestTrade = typeof backtestTrades.$inferSelect;
export type InsertBacktestTrade = z.infer<typeof insertBacktestTradeSchema>;
export type RecommendationTracking = typeof recommendationTracking.$inferSelect;
export type InsertRecommendationTracking = z.infer<typeof insertRecommendationTrackingSchema>;
export type RecommendationPerformance = typeof recommendationPerformance.$inferSelect;
export type InsertRecommendationPerformance = z.infer<typeof insertRecommendationPerformanceSchema>;
export type StrategyParameters = typeof strategyParameters.$inferSelect;
export type InsertStrategyParameters = z.infer<typeof insertStrategyParametersSchema>;
export type UoaTrade = typeof uoaTrades.$inferSelect;
export type InsertUoaTrade = z.infer<typeof insertUoaTradeSchema>;
export type MarketInsight = typeof marketInsights.$inferSelect;
export type InsertMarketInsight = z.infer<typeof insertMarketInsightSchema>;
export type PerformanceMetricsRow = typeof performanceMetrics.$inferSelect;
export type InsertPerformanceMetricsRow = z.infer<typeof insertPerformanceMetricsSchema>;
export type LearningSession = typeof learningSessions.$inferSelect;
export type InsertLearningSession = z.infer<typeof insertLearningSessionSchema>;

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface TradeRecommendation {
  ticker: string;
  optionType: 'call' | 'put';
  currentPrice: number;
  strikePrice: number;
  expiry: string;
  stockEntryPrice: number; // Stock purchase price at market execution
  stockExitPrice?: number; // Target stock price at exit
  premium: number; // Actual option premium cost
  entryPrice: number; // Backward compatibility - same value as premium
  exitPrice: number;
  totalCost: number; // Total investment required (contracts × premium × 100)
  contracts: number;
  projectedROI: number;
  aiConfidence: number;
  greeks: Greeks;
  sentiment: number;
  score: number;
  holdDays: number;
  fibonacciLevel?: number; // 0.707 or 0.618 if bouncing off Fibonacci level
  fibonacciColor?: 'gold' | 'green'; // Color coding for UI display
  estimatedProfit?: number; // Dollar amount profit (not percentage)
}

export interface PortfolioSummary {
  totalValue: number;
  dailyPnL: number;
  totalPnL: number;
  totalCost: number;
  optionsCount: number;
  stockCount: number;
  buyingPower: number;
  topPositions: PortfolioPosition[];
}

export interface PositionPerformance {
  position: PortfolioPosition;
  currentValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalReturn: number;
  totalReturnPercent: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  monthlyReturns: { month: string; return: number }[];
  tradeDistribution: { range: string; count: number }[];
}

export interface SectorData {
  name: string;
  change: number;
}

export interface MarketOverviewData {
  sp500: { value: number; change: number; changePercent: number };
  nasdaq: { value: number; change: number; changePercent: number };
  vix: { value: number; change: number; changePercent: number };
  sentiment: { score: number; label: string };
}

export interface AlertNotification {
  id: string;
  type: 'price_alert' | 'trade_execution' | 'market_news';
  title: string;
  message: string;
  ticker?: string;
  price?: number;
  timestamp: Date;
  isRead: boolean;
}

export interface OptionsMetadata {
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  entryPrice: number;
  contracts: number;
}

export interface PositionAnalysis {
  id: string;
  ticker: string;
  positionType: 'options' | 'stock';
  currentPrice: number;
  entryPrice: number;
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  dayChange: number;
  dayChangePercent: number;
  quantity: number;
  totalCost: number;
  breakEvenPrice?: number;
  
  // Options specific
  greeks?: Greeks;
  timeToExpiry?: number;
  impliedVolatility?: number;
  moneyness?: 'ITM' | 'OTM' | 'ATM';
  
  // Analysis
  sentiment: number;
  confidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  
  // Exit Strategy
  exitStrategy: {
    profitTarget: number;
    stopLoss: number;
    timeBasedExit: string;
    recommendation: 'HOLD' | 'TAKE_PROFIT' | 'CUT_LOSS' | 'MONITOR';
    reasoning: string[];
    trimPercentage?: number; // Percentage of position to trim (e.g., 50 for 50%)
  };
}

export interface PortfolioAnalysis {
  totalValue: number;
  totalCost: number;
  totalPnL: number;
  totalPnLPercent: number;
  dayChange: number;
  positions: PositionAnalysis[];
  riskMetrics: {
    portfolioRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    concentration: number;
    beta: number;
    maxLoss: number;
  };
  recommendations: string[];
  overallSentiment: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SymbolSuggestion {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
}

export interface PriceQuote {
  symbol: string;
  price: number;
  change?: number;
  changePercent?: number;
}
