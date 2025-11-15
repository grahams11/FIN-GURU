# Overview

This project is an AI-powered options trading dashboard designed to provide institutional-grade tools for market analysis, trade recommendations, and portfolio management. It integrates multiple advanced trading systems, including a high-win-rate Ghost 1DTE overnight scanner, and leverages real-time data, AI analysis, and sophisticated quantitative strategies to deliver actionable insights and support informed investment decisions. The project aims to empower users with tools typically reserved for professionals, enhancing their market understanding and trading performance.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS) for a dark-themed design system.
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) via a custom React hook.
- **Routing**: Wouter.

## Real-Time Data Streaming
- **Server-Side**: Polygon and Tastytrade WebSockets feed an in-memory cache, streamed via an SSE endpoint.
- **Client-Side**: EventSource connects to `/api/quotes/stream` for live stock quotes and real-time Greeks.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous data updates.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping and financial calculations.
- **Financial Calculations**: Custom Black-Scholes options pricing model.
- **Polygon API Throttling**: Dual Bottleneck system prevents rate limits while respecting unlimited plan fair-use policies:
  - **Standard Limiter**: 200ms minTime, 5 maxConcurrent, 100/min reservoir (rate-limited requests)
  - **Lightweight Limiter**: 300ms minTime, 2 maxConcurrent, no reservoir (unlimited-mode scanners)
  - **Auth Fallback**: Bearer token → query param on 401 errors
  - **Smart Retries**: Exponential backoff for 429/5xx, short-circuit for 401/403 to prevent retry storms
  - **Result Caps**: limit=50000 (historical), limit=5000 (minute), limit=250 (options snapshots)

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, AI insights, and AI learning data (marketInsights, performanceMetrics, learningSessions).

## Core Business Logic

### Market Scanning and Data
- **BatchDataService**: Fetches and caches ~11,600 stocks from Polygon for efficient market scanning.
- **Elite Scanner**: Institutional-grade scanner with strict filtering for high-quality trade recommendations, operating in under 1 second.
- **Shared WebSocket Architecture**: PolygonService provides a single shared WebSocket connection for stock and option quote streaming, including health monitoring and reconnection logic.
- **API Authentication**: Uses `Authorization: Bearer` headers for Polygon/Massive.com to ensure unlimited access for Advanced Options Plan users.
- **Centralized Auth**: All REST API calls use PolygonService.makeRateLimitedRequest() for consistent authentication, retry logic, and rate limit management.
- **ExpirationService**: Queries live option chains for accurate expiration dates.
- **EOD Cache System**: Caches end-of-day snapshots for overnight scanner operation.
  - **Auto-Cache**: Automatically caches at 3:00 PM CST daily.
  - **Manual Trigger**: `POST /api/admin/cache-eod` endpoint for on-demand cache population.
  - **Storage**: In-memory cache with 6-hour expiration.
  - **Coverage**: Successfully caches ~11,558 stocks from Polygon daily bars.
- **Historical Data Cache System**: Eliminates 99% of API calls by batch-caching 30 days of historical data.
  - **Purpose**: Replaces per-symbol getDailyAggregates calls (28,800+ API calls/day) with grouped batch fetching (~30 calls/day).
  - **Implementation**: Iterates through 30 trading days, fetching grouped daily bars (1 API call per trading day for ALL symbols).
  - **Coverage**: Caches 11,000+ symbols with ≥20 bars each for indicator calculations (RSI, EMA, ATR).
  - **Auto-Refresh**: Daily at 4:00 PM CST (after EOD cache).
  - **Retry Logic**: 3-attempt initialization with exponential backoff; background refresh on stale cache detection.
  - **API Reduction**: ~28,800 calls/day → ~30 calls/day (99.89% reduction).
  - **Integration**: OvernightDataFetcher checks cache first, only falls back to live API on cache miss.

### Trading Systems
- **Ghost 1DTE Overnight Scanner**: PERMANENTLY REMOVED (Nov 15, 2025) to eliminate API overhead.
  - **Rationale**: 500+ S&P requests per scan were causing 429 rate limits that blocked Elite Scanner from completing analysis.
  - **Deleted Files**: ghost1DTE.ts, ghostScheduler.ts, ghostSweepDetector.ts, /ghost route, Ghost navigation tab.
  - **Impact**: Freed ~14,000 API calls/day, allowing Elite Scanner to operate without interference.
- **Day Trading System (SPX Only)**: Utilizes VIX + RSI for BUY/SELL signals on SPX weekly expirations.
- **Elite Dual-Strategy Scanner (Stocks)**: Momentum-based scanner for CALL/PUT strategies on 100+ stocks and ETFs, targeting 3-5 high-quality plays per day.
  - **Nov 14, 2025 FIX**: Restored Nov 12 behavior where neutral-RSI plays (RSI=50) like RIGL/TBPH were accepted. Changed signal type determination from RSI thresholds to PRICE ACTION (momentum direction):
    - **Call Signal**: Positive intraday momentum (price moving up from yesterday's close)
    - **Put Signal**: Negative intraday momentum (price moving down from yesterday's close)
    - **RSI Role**: Now used for SCORING quality only, not filtering - accepts all RSI values
    - **Impact**: Allows high-quality plays with neutral RSI that have strong directional momentum/EMA alignment
  - **24/7 Operation**: Operates continuously using dual-mode analysis (live data during market hours, EOD + overnight aggregates when closed).
  - **Live Mode (8:30 AM - 3:00 PM CST)**: Momentum direction determines signal type, volume spike > 1.8x, intraday momentum > 0.8%, premium > $0.30, pivot breakout required.
  - **Overnight Mode (8:00 PM - 8:30 AM CST)**: Uses real indicator calculations (RSI, EMA20, ATR) from EOD snapshot + overnight bars (4-8 PM CST aggregates).
    - **Indicator Calculations**: `server/utils/indicators.ts` provides real RSI (14-period gains/losses), EMA (exponential smoothing), and ATR (true range averaging).
    - **Liquidity-Aware Filters**: Asymmetric RSI thresholds (45/55 to avoid neutral zone), relaxed volume/ATR requirements (1.2x vs live 1.5x), minimum 0.8% price movement.
    - **Data Validation**: Requires ≥20 bars (EOD + overnight), ≥50% bars with volume, filters zero-volume bars.
    - **Contract Selection**: ATM ±5%, DTE 3-7, premium ≥$0.30, delta 0.3-0.6, ranked by volume + OI.
    - **Signal Quality**: Capped at 80 (no live Greeks), based on RSI extremes, volume spike, price movement, premium size, and liquidity.
    - **Detailed Logging**: Filter progression tracking at each step (RSI, EMA alignment, price movement, volume, ATR, contract filtering) for diagnostics.
  - **Core Requirements**: Trend alignment (EMA20), ATR momentum, and pivot breakout confirmation.
  - **Grok AI Enhancements**: Incorporates pivot level calculation, volume spike detection, intraday momentum, and breakout confirmation.

### Shared Features
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using Fibonacci levels with fractal swing detection.
- **VIX Squeeze Kill Switch**: Real-time alert system for high-confidence 0DTE PUT opportunities when VIX >= 20 with >5% change.
  - **Alert UI**: Red pulsing banner with "BUY SPY 0DTE PUT", confidence rating, VIX metrics, and entry/exit windows.
  - **Auto-Refresh**: Component polls every 5 seconds for live alert status.
- **24/7 Auto-Scan System**: Runs Elite Scanner only, every 5 minutes continuously (Ghost removed Nov 15, 2025).
  - **Run-State Guard**: Prevents overlapping scans if previous scan exceeds 5-minute interval.
  - **Error Handling**: Scanner failures logged with detailed error diagnostics.
  - **Duration Tracking**: Logs scan execution time to identify performance issues.
  - **Historical Cache Integration**: Overnight scans use cached 30-day historical data instead of live API calls.
- **Dashboard Market Overview**: Displays real-time S&P 500, NASDAQ, and VIX metrics using hierarchical data sources (Tastytrade WebSocket, Google Finance scraping).
  - **Change Calculation**: Real-time changePercent using `(currentPrice - openPrice) / openPrice * 100`.
- **Recommendation Validation System**: Automatically filters stale (>120min old) and invalid (>2% adverse price movement) recommendations.
  - **Auto-Refresh**: Background job refreshes recommendations every 15 minutes during market hours.
- **TradeExitMonitor**: Tracks historical trade recommendations and evaluates strategy win percentage.
  - **Scheduling**: Runs once daily at 4:15 PM ET (3:15 PM CST) using Luxon timezone-aware scheduling.
  - **Purpose**: Checks historical recommendations for profit targets (65%) and stop losses (30%) once daily after market close.
  - **API Efficiency**: Reduced from 60-second polling (~2,100 req/min) to once-daily execution (~145 req/day), eliminating API quota exhaustion.
  - **Impact**: Restored Elite Scanner functionality (now receives 11,624 stocks vs. 0 stocks before fix).
  - **Logging**: Displays CST time for user-friendly scheduling confirmation.

### Self-Learning System (AI Education Engine)
- **Architecture**: Five core services orchestrate autonomous learning using Grok AI reasoning.
- **Learning Loop**: Automated daily outcome analysis, weekly pattern discovery, and bi-weekly parameter optimization.
- **Grok AI Integration**: Sends trade summaries to Grok for deep pattern analysis and structured recommendations.
- **Strategy Evolution**: Tracks recommendations, analyzes outcomes, and dynamically adjusts strategy parameters.

### Portfolio Management (Hybrid AI + Multi-Broker)
- **Data Sources**: Unified portfolio view aggregating positions from both Tastytrade and Robinhood brokers.
  - **Tastytrade API**: Primary broker integration for options and stock positions.
  - **Robinhood API**: Secondary broker integration using unofficial robinhood-nodejs library.
  - **Circuit Breaker Pattern**: Robinhood authentication failures don't block Tastytrade data; 60-second cooldown prevents retry storms.
  - **Graceful Degradation**: App displays Tastytrade-only positions if Robinhood is unavailable.
- **UI Features**: Broker badges (blue for Tastytrade, green for Robinhood) identify position sources.
- **Risk Management**: Automated stop loss and aggressive partial profit-taking across all brokers.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` with `GrokAIService` for strategic recommendations.
- **Goal Tracking**: Monitors progress towards a $1M target.
- **Real-Time P&L & Greeks Monitoring**: Live tracking with SSE-powered updates for all broker positions.
- **P&L Baseline System**: Manual baseline adjustment system for accurate YTD realized P/L tracking.
  - **Baseline Storage**: `app_config` table stores P/L baseline adjustment (key: `pnl_baseline_adjustment`).
  - **Current Baseline**: -$2,277 (set to match Tastytrade YTD value as of Nov 14, 2025).
  - **Calculation**: Lifetime P/L = Calculated P/L from new trades + Baseline adjustment.
  - **Admin Endpoint**: `POST /api/admin/pnl-baseline` allows updating the baseline with new value and description.
  - **Rationale**: Tastytrade API doesn't expose YTD realized P/L directly; baseline ensures accurate tracking going forward.

### Time Synchronization System
- **Purpose**: Ensures accurate CST time detection for critical trading windows.
- **Primary Sync**: WorldTimeAPI (HTTP-based).
- **Fallback**: NTP servers (time.google.com, pool.ntp.org, time.cloudflare.com).
- **Manual Override**: Admin endpoints allow manual time correction for development/admin only.

### UI Features
- **CST Clock Component**: Real-time clock display on dashboard showing accurate CST time with market status indicator (LIVE/CLOSED).
- **Real-Time Dashboard**: Market overview with live S&P 500, NASDAQ, and VIX metrics via SSE streaming.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com**: Primary real-time market data (WebSocket and REST API) for US stocks and options. Advanced Options Plan provides unlimited API access with fair-use throttling.
  - **Limitation**: Index symbols (I:SPX, I:COMP, I:VIX) return 403 errors - not included in Advanced Options Plan. System automatically falls back to Google Finance scraping.
- **Tastytrade API**: Primary real-time data (DXLink WebSocket) for SPX index when market is open.
- **Google Finance**: Primary web scraping for all market indices (S&P 500, NASDAQ, VIX), and fallback for SPX and Polygon index queries.
- **MarketWatch**: Secondary web scraping fallback.
- **WorldTimeAPI**: Primary source for time synchronization.
- **NTP Servers**: (time.google.com, pool.ntp.org, time.cloudflare.com) for time synchronization fallback.

## Development Tools
- **Replit Integration**: Cartographer and dev banner plugins.
- **Vite Plugins**: Runtime error overlay, HMR.

## UI Component Libraries
- **Radix UI**: Primitive components.
- **Lucide React**: Icon library.
- **React Hook Form**: Form state management.

## Utility Libraries
- **Axios**: HTTP client.
- **Cheerio**: HTML parsing.
- **Date-fns**: Date utilities.
- **Luxon**: Timezone-aware date/time library for TradeExitMonitor scheduling.
- **Class Variance Authority**: Type-safe CSS class management.