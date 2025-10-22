# Overview

This is an options trading AI dashboard application that provides market analysis, trade recommendations, and portfolio management features. The system analyzes financial data using web scraping and AI-powered algorithms to generate high-confidence options trading opportunities with calculated Greeks and risk metrics.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Library**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling
- **State Management**: TanStack Query (React Query) for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Styling**: Dark-themed design system with CSS variables and custom color scheme optimized for financial data visualization

## Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints for market data, AI insights, and trade management
- **Data Processing**: Real-time market data scraping with cheerio and axios
- **Financial Calculations**: Custom Black-Scholes options pricing model for Greeks calculation (delta, gamma, theta, vega, rho)

## Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Schema**: Normalized tables for users, market data, options trades, and AI insights
- **Storage Strategy**: In-memory storage implementation with interface for easy database swapping
- **Migrations**: Drizzle Kit for database schema migrations and version control

## Authentication and Authorization
- **Current State**: Basic user schema prepared but not fully implemented
- **Planned**: User authentication with session management using connect-pg-simple for PostgreSQL session storage

## Core Business Logic
- **AI Analysis Service**: Generates market sentiment scores, volatility forecasts, and confidence ratings with $1000 per trade budget
- **Web Scraper Service**: Retrieves real-time market data including 52-week highs for pullback analysis (S&P 500, NASDAQ, VIX)
- **Financial Calculations**: Black-Scholes implementation for options Greeks and pricing models
- **Trade Scoring**: Proprietary algorithm combining technical indicators, sentiment analysis, and volatility metrics
- **Trade Budget**: $1000 maximum per trade with smart contract allocation (cheaper premiums get more contracts)
- **30% Pullback Filter**: Only recommends stocks that have pulled back 30% or more from their 52-week high (true pullback opportunities)
- **Stock Entry Pricing**: Entry prices set at current market price (±1%) for immediate actionable trades after pullback
- **Premium Display**: Separate display of stock entry price (market execution) and actual option premium cost
- **Real-Time Variation**: ROI and confidence values dynamically fluctuate based on market volatility and timestamp-based factors for realistic updates

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL database with connection pooling via @neondatabase/serverless
- **Drizzle ORM**: Type-safe database toolkit with PostgreSQL dialect support

## Financial Data Sources
- **Yahoo Finance**: Primary source for market indices and stock price data via web scraping
- **Market Data APIs**: Configured for real-time price feeds and historical data analysis

## Development Tools
- **Replit Integration**: Development environment plugins for cartographer and dev banner
- **Vite Plugins**: Runtime error overlay and hot module replacement for development workflow

## UI Component Libraries
- **Radix UI**: Comprehensive primitive components for accessibility and interactions
- **Lucide React**: Icon library for consistent visual elements
- **React Hook Form**: Form state management with validation resolvers

## Utility Libraries
- **Axios**: HTTP client for external API requests and web scraping
- **Cheerio**: Server-side HTML parsing for market data extraction
- **Date-fns**: Date manipulation and formatting utilities
- **Class Variance Authority**: Type-safe CSS class management for component variants