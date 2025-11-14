# Overview

This project is an AI-powered options trading dashboard providing institutional-grade tools for market analysis, trade recommendations, and portfolio management. It features multiple trading systems, including a high-win-rate Ghost 1DTE overnight scanner, and leverages real-time data, AI analysis, and advanced quantitative strategies to deliver insights and support investment decisions.

# Recent Changes

## November 14, 2025 - VIX Squeeze Kill Switch & Market Data Enhancements
- **VIX Squeeze Kill Switch**: Real-time alert system detecting high-confidence 0DTE PUT opportunities when VIX >= 20 with >5% change
  - **Detection Logic**: Server-side monitoring checks `VIX >= 20 && |changePercent| > 5` on every market overview request
  - **Alert UI**: Red pulsing banner displays "BUY SPY 0DTE PUT" with 94.1% confidence rating, VIX metrics, entry window (NOW - 3:00 PM CST), exit time (9:30 AM next day)
  - **Auto-Refresh**: Component polls every 5 seconds for live alert status updates
  - **Debug Logging**: Monitors VIX values when price > 18 or change > 3% for squeeze condition tracking
- **Market Overview Data Sources**: Refactored to use Tastytrade WebSocket for live SPX data (when market is open) with Google Finance web scraping as fallback for all indices
- **Eliminated 401 Errors**: Removed Polygon API calls for market indices (S&P 500, NASDAQ, VIX), eliminating authentication errors
- **Market Indices ChangePercent Bug Fix**: Fixed issue where all three indices (S&P 500, NASDAQ, VIX) displayed identical +19.06% changePercent
  - **Root Cause**: Google Finance scraping matched wrong DOM elements (first `.JwB6zf` on page), Polygon plan doesn't support index data
  - **Solution**: Index-specific detection returns 0% changePercent with clear logging about API limitation (honest about missing data, not misleading)
  - **Data Integrity**: Added `Number.isFinite()` validation throughout to prevent NaN propagation from Polygon/Tastytrade/web scraping
  - **Authorization Fix**: Polygon index aggregates now use proper `Authorization: Bearer` header via `makeRateLimitedRequest()` instead of query param
  - **Stock Preservation**: Stocks retain accurate changePercent from web scraping when Polygon/Tastytrade don't provide valid data
- **Shared Time Hook**: Created reusable `useCstTime` hook for consistent CST time display across dashboard and Ghost page
- **UI Cleanup**: Removed timestamp display from OptionsTraderAI refresh button for cleaner interface
- **Live CST Clock**: Replaced static CST time on Ghost 1DTE page with real-time updating clock component

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS) with a dark-themed design system.
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) via a custom React hook.
- **Routing**: Wouter.

## Real-Time Data Streaming Architecture
- **Server-Side**: Polygon and Tastytrade WebSockets feed an in-memory cache, streamed via an SSE endpoint.
- **Client-Side**: EventSource connects to `/api/quotes/stream` for live stock quotes and real-time Greeks.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous updates.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping.
- **Financial Calculations**: Custom Black-Scholes options pricing model.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, and AI insights.
- **AI Learning Schema**: Includes `marketInsights` for AI-discovered patterns, `performanceMetrics` for strategy aggregates, and `learningSessions` for audit trails of AI learning runs.

## Core Business Logic

### Market Scanning
- **BatchDataService**: Fetches and caches ~11,600 stocks from Polygon Bulk Snapshot for efficient market scanning.
- **Elite Scanner**: Institutional-grade scanner with strict filtering criteria for high-quality trade recommendations. Completes in <1 second during market hours (live WebSocket data) and ~0.5 seconds during closed market (historical data with unlimited mode).
- **Shared WebSocket Architecture**: PolygonService provides single shared WebSocket connection for stock quotes and option quote streaming. Includes health monitoring and exponential backoff reconnection.
- **Market Data Pipeline**: Efficiently fetches and filters market data, eliminating redundant API calls.
- **API Authentication**: Uses proper `Authorization: Bearer` header method per Polygon/Massive.com specification (NOT query string `?apiKey=`). This ensures Advanced Options Plan unlimited access is properly recognized.
- **Unlimited Mode**: Elite Scanner and performance-critical paths use `unlimited: true` flag to bypass rate limiting, enabling fast scans with the Advanced Options Plan.
- **Centralized Auth**: All REST API calls delegate to PolygonService.makeRateLimitedRequest() for consistent authentication, retry logic, and rate limit management.
- **ExpirationService**: Queries live option chains for accurate expiration dates.

### Trading Systems
- **Ghost 1DTE Overnight Scanner (GROK PHASE 4 ENHANCED)**: High-win-rate strategy for SPY, QQQ, IWM using a 4-layer AI scoring system for entry signals and robust technical optimizations. Includes a manual pre-trade checklist for execution.
  - **Grok AI Enhancements (Phase 4)**:
    - **Strict Theta Filtering**: Theta must be < -0.08 with daily burn rate calculation (|theta| × underlyingPrice × 100)
    - **Gamma Filtering**: Gamma must be > 0.12 for acceleration sensitivity
    - **IV Range**: 20-60% volatility sweet spot with symbol-specific caps
    - **Entry Window**: 2:00-3:00 PM CST only (enforced via time synchronization)
    - **Exit Time**: 8:32 AM CST next day
- **Day Trading System (SPX Only)**: Uses VIX + RSI for BUY/SELL signals on SPX weekly expirations.
- **Elite Dual-Strategy Scanner (Stocks)**: RSI-only momentum scanner for CALL/PUT strategies on 100+ stocks and ETFs.
  - **Grok AI Enhancements**:
    - **Pivot Level Calculation**: (High + Low + Close) / 3 for breakout confirmation
    - **Volume Spike Detection**: 1.8x average volume threshold (increased from 1.5x)
    - **Breakout Filter**: Price must break above pivot with volume confirmation
    - **RSI Integration**: 14-period momentum indicator combined with pivot analysis

### Shared Features
- **Financial Calculations**: Black-Scholes for options Greeks and pricing.
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using Fibonacci levels with fractal swing detection.
- **VIX Squeeze Kill Switch**: Real-time alert system for high-confidence 0DTE PUT trades
  - **Detection Criteria**: VIX >= 20 AND |changePercent| > 5%
  - **Alert UI**: Red pulsing banner with "BUY SPY 0DTE PUT", 94.1% confidence, VIX metrics, entry/exit windows
  - **Auto-Refresh**: 5-second polling of `/api/market-overview` for live alert status
  - **Trading Strategy**: Entry NOW through 3:00 PM CST, exit 9:30 AM next day
  - **Debug Monitoring**: Logs VIX values when price > 18 or change > 3%
- **Dashboard Market Overview**: Displays real-time S&P 500, NASDAQ, and VIX metrics using hierarchical data sources
  - **SPX**: Tastytrade WebSocket (when market open) → Google Finance scraping (fallback)
  - **NASDAQ/VIX**: Google Finance scraping only (Tastytrade doesn't support these indices)
  - **Change Calculation**: All change metrics accurately derived using formula: `prevClose = price / (1 + changePercent/100)`, then `change = price - prevClose`
- **Recommendation Validation System**: Automatically filters stale and invalid recommendations using two criteria:
    - **Staleness Filter**: Removes recommendations >120min old to ensure fresh market data
    - **Price Movement Filter**: Removes recommendations with >2% adverse price movement from entry thesis
    - **Auto-Refresh**: Background job refreshes all recommendations every 15 minutes during market hours (9:30am-4:00pm ET)
    - **Logging**: Detailed filtering reasons (e.g., "Stale (869min old)") for debugging

### Self-Learning System (AI Education Engine)
- **Architecture**: Five core services orchestrate autonomous learning using Grok AI reasoning.
- **Learning Loop**: Automated daily outcome analysis, weekly pattern discovery via Grok, and bi-weekly parameter optimization.
- **Grok AI Integration**: Sends trade summaries to Grok for deep pattern analysis and structured recommendations.
- **Strategy Evolution**: Tracks recommendations, analyzes outcomes, and dynamically adjusts strategy parameters.

### Portfolio Management (Hybrid AI)
- **Data Source**: Fetches positions from Tastytrade API.
- **Risk Management**: Automated stop loss and aggressive partial profit-taking.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` with `GrokAIService` for complex scenarios and strategic recommendations.
- **Goal Tracking**: Monitors progress towards a $1M target.
- **Real-Time P&L & Greeks Monitoring**: Live tracking with SSE-powered updates.

### Time Synchronization System
- **Purpose**: Ensures accurate CST time detection for Ghost 1DTE scanner's 2-3 PM entry window.
- **Primary Sync**: WorldTimeAPI (HTTP-based) - works in restricted network environments.
- **Fallback**: NTP servers (time.google.com, pool.ntp.org, time.cloudflare.com) - may be blocked in some environments.
- **Manual Override**: Admin endpoints allow manual time correction when external sources fail.
- **Safety**: Manual offset clears automatically when external sync succeeds to prevent double-offset bugs.
- **API Endpoints**:
  - `GET /api/time` - Returns CST time and market open status (simple endpoint for UI)
  - `GET /api/time/status` - View current time sync status and offsets
  - `POST /api/time-offset` - Set manual time offset (development/admin only, includes audit logging)
- **Security Note**: Manual offset endpoint is unauthenticated for development ease but should be restricted in production using authentication middleware.

### UI Features
- **CST Clock Component**: Real-time clock display on dashboard and Ghost page showing accurate CST time with market status indicator
  - **Shared Hook**: `useCstTime` custom hook provides consistent time polling across all components
  - **Update Frequency**: 1-second polling via TanStack Query (`GET /api/time`)
  - **Market Status**: Green "LIVE" badge during market hours (9:30 AM - 4:00 PM CST), red "CLOSED" badge otherwise
  - **Time Format**: 12-hour format with AM/PM (e.g., "2:45:30 PM")
  - **Performance**: No performance regressions with 1-second polling interval
  - **Locations**: Dashboard header, Ghost 1DTE status grid (inline clock)
- **Manual Scan Triggers**: Ghost 1DTE scanner includes "Run Scan" button for on-demand analysis
- **Real-Time Dashboard**: Market overview with live S&P 500, NASDAQ, and VIX metrics via SSE streaming
- **Clean UI**: OptionsTraderAI refresh button displays icon/text only (no timestamp)

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com**: Primary real-time market data (WebSocket and REST API) for US stocks and options (NOT used for market indices).
- **Tastytrade API**: Primary real-time data (DXLink WebSocket) for SPX index when market is open.
- **Google Finance**: Primary web scraping for all market indices (S&P 500, NASDAQ, VIX), fallback for SPX.
- **MarketWatch**: Secondary web scraping fallback.

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
- **Class Variance Authority**: Type-safe CSS class management.