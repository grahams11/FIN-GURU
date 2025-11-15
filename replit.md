# Overview

This project is an AI-powered options trading dashboard providing institutional-grade tools for market analysis, trade recommendations, and portfolio management. It integrates advanced trading systems, leverages real-time data, AI analysis, and sophisticated quantitative strategies to deliver actionable insights and support informed investment decisions, aiming to empower users with professional-level trading tools.

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
- **Smart Data Source Strategy** (Nov 2025): Market-aware fallback automatically switches between live and cached data to reduce API usage from 45k-60k to ~14.5k calls/day.
  - **Market CLOSED**: Defaults to historical cache (11k+ stocks, 30 days) to avoid wasted API calls.
  - **Market OPEN**: Attempts Polygon live data first, falls back to cache on 403/429 errors.
  - **UI Indicator**: Green flashing dot = live data, Red solid dot = historical cache.
- **Live Option Premium Streaming** (Nov 2025): Real-time option pricing accuracy via Polygon WebSocket with simple EOD caching.
  - **Market OPEN**: Subscribes to option quotes via WebSocket, calculates premium as (bid + ask) / 2 from live data.
  - **Market CLOSED**: Uses EOD premiums from `options_trades` table via `storage.getLatestPremium()` to eliminate overnight API calls.
  - **Simple Design**: Reuses existing `options_trades` data instead of complex snapshot tables, reducing API usage from 45k-60k to ~14.5k calls/day.
  - **Data Flow**: WebSocket cache (market open) → `getLatestPremium()` from options_trades (market closed) → REST API fallback.
  - **Option Symbol Format**: OCC standard (e.g., "O:SPY251113C00680000" for SPY $680 Call expiring 11/13/25).
  - **Integration**: LiveDataAdapter switches premium source based on market status via `marketStatusService.isMarketOpen()`.
- **Greeks EOD Caching** (Nov 2025): Extends EOD premium caching to include full Greeks data (delta, gamma, theta, vega, IV) from database.
  - **Market OPEN**: Fetches live Greeks via Polygon API/WebSocket for real-time accuracy.
  - **Market CLOSED**: Uses stored Greeks from `options_trades` table via `storage.getLatestOptionsData()` to eliminate API calls.
  - **Defensive Design**: Validates stored data with null checks; gracefully falls back to Polygon if data missing/invalid.
  - **Data Structure**: Greeks stored as JSONB in options_trades table alongside premium, strike, and expiry.
  - **Log Indicators**: "💾 EOD Data: [TICKER] $[PREMIUM] + Greeks from options_trades" confirms database path working.
  - **Impact**: Combined with premium caching, reduces API usage from 45k-60k to ~14.5k calls/day during market close.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping and financial calculations including a custom Black-Scholes options pricing model.
- **Polygon API Throttling**: Dual Bottleneck system with Standard and Lightweight limiters, Auth Fallback, and Smart Retries.
- **BatchDataService**: Smart market-aware data source selection with historical cache fallback, reducing API usage by ~70% during off-hours.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, AI insights, and AI learning data.

## Core Business Logic

### Market Scanning and Data
- **BatchDataService**: Fetches and caches ~11,600 stocks from Polygon.
- **Elite Scanner**: Institutional-grade scanner with strict filtering for high-quality trade recommendations, operating in under 1 second.
- **Shared WebSocket Architecture**: PolygonService provides a single shared WebSocket connection for stock and option quote streaming.
- **API Authentication**: Uses `Authorization: Bearer` headers and `PolygonService.makeRateLimitedRequest()` for consistent authentication and rate limit management.
- **EOD Cache System**: Caches end-of-day snapshots for overnight scanner operation, auto-caches daily at 3:00 PM CST, and covers ~11,558 stocks.
- **Historical Data Cache System**: Batch-caches 30 days of historical data, reducing API calls by 99.89%, and auto-refreshes daily at 4:00 PM CST.

### Trading Systems
- **Day Trading System (SPX Only)**: Utilizes VIX + RSI for BUY/SELL signals on SPX weekly expirations.
- **Elite Dual-Strategy Scanner (Stocks)**: Momentum-based scanner for CALL/PUT strategies on 100+ stocks and ETFs with two-tier classification system:
  - **Premium Tier**: Strict filtering (RSI <45/>55, 0.8% movement, 1.2x volume, 1.2x ATR) for high-confidence plays. Targets 3-5 during market hours, up to 12 during overnight mode.
  - **Watchlist Tier** (Overnight Only, 8 PM - 8:30 AM CST): Relaxed filtering (RSI 40-60 full range, 0.5% movement, 1.0x volume, 1.0x ATR) to capture emerging setups for pre-market research. Minimum 10 total plays (premium + watchlist) during overnight mode.
  - **Visual UI**: Premium plays display "Bullish/Bearish Elite Play" subtitle. Watchlist plays show yellow "WATCHLIST" badge with "Overnight Watchlist Setup" subtitle.
  - Operates 24/7 with dual-mode analysis (live during market hours, EOD + overnight aggregates when closed). Incorporates Grok AI for pivot level calculation, volume spike detection, and breakout confirmation.

### Shared Features
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using Fibonacci levels with fractal swing detection.
- **VIX Squeeze Kill Switch**: Real-time alert system for high-confidence 0DTE PUT opportunities when VIX >= 20 with >5% change.
- **24/7 Auto-Scan System**: Runs Elite Scanner every 5 minutes continuously, integrating historical cache.
- **Dashboard Market Overview**: Displays real-time S&P 500, NASDAQ, and VIX metrics.
- **Recommendation Validation System** (Nov 2025): Two-tier validation with watchlist exemption.
  - **Premium Plays**: Full validation (age <15min, price drift <3%, expiration check) to ensure setups remain actionable.
  - **Watchlist Plays**: Exempted from age/price checks to persist overnight for pre-market research. Only checked for expiration.
  - Prevents watchlist plays from being filtered out by staleness checks during overnight/weekend periods.
- **TradeExitMonitor**: Tracks historical trade recommendations and evaluates strategy win percentage daily at 4:15 PM ET.

### Self-Learning System (AI Education Engine)
- **Architecture**: Five core services orchestrate autonomous learning using Grok AI reasoning.
- **Learning Loop**: Automated daily outcome analysis, weekly pattern discovery, and bi-weekly parameter optimization.
- **Strategy Evolution**: Tracks recommendations, analyzes outcomes, and dynamically adjusts strategy parameters.

### Portfolio Management (Hybrid AI + Multi-Broker)
- **Data Sources**: Unified portfolio view aggregating positions from Tastytrade and Robinhood brokers.
- **Risk Management**: Automated stop loss and aggressive partial profit-taking across all brokers.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` with `GrokAIService`.
- **Real-Time P&L & Greeks Monitoring**: Live tracking with SSE-powered updates.
- **P&L Baseline System**: Manual baseline adjustment for accurate YTD realized P/L tracking.

### Time Synchronization System
- **Purpose**: Ensures accurate CST time detection for critical trading windows.
- **Primary Sync**: WorldTimeAPI.
- **Fallback**: NTP servers (time.google.com, pool.ntp.org, time.cloudflare.com).

### UI Features
- **CST Clock Component**: Real-time clock display on dashboard showing accurate CST time with market status indicator.
- **Real-Time Dashboard**: Market overview with live S&P 500, NASDAQ, and VIX metrics via SSE streaming.
- **Data Source Indicator**: Visual status showing live (green flashing) vs cached (red solid) data with tooltip details (source, last update time, market status).

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com**: Primary real-time market data (WebSocket and REST API) for US stocks and options.
- **Tastytrade API**: Primary real-time data (DXLink WebSocket) for SPX index.
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
- **Luxon**: Timezone-aware date/time library.
- **Class Variance Authority**: Type-safe CSS class management.