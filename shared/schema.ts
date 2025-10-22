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
  currentPrice: real("current_price").notNull(),
  strikePrice: real("strike_price").notNull(),
  expiry: text("expiry").notNull(),
  stockEntryPrice: real("stock_entry_price"), // Fibonacci 0.707 entry price (optional for backward compatibility)
  premium: real("premium"), // Actual option premium (optional for backward compatibility)
  entryPrice: real("entry_price").notNull(), // Kept for backward compatibility
  exitPrice: real("exit_price"),
  contracts: integer("contracts").notNull(),
  projectedROI: real("projected_roi").notNull(),
  aiConfidence: real("ai_confidence").notNull(),
  greeks: jsonb("greeks").notNull(),
  sentiment: real("sentiment"),
  score: real("score").notNull(),
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

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface TradeRecommendation {
  ticker: string;
  currentPrice: number;
  strikePrice: number;
  expiry: string;
  stockEntryPrice: number; // Fibonacci 0.707 entry price for underlying stock
  premium: number; // Actual option premium cost
  entryPrice: number; // Backward compatibility - same value as premium
  exitPrice: number;
  contracts: number;
  projectedROI: number;
  aiConfidence: number;
  greeks: Greeks;
  sentiment: number;
  score: number;
  holdDays: number;
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
