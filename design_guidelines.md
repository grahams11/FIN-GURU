# Design Guidelines: Options Trading AI Dashboard

## Design Approach
**Selected Approach:** Design System (Material Design Dark) + Trading Platform Reference
**Justification:** Financial dashboards prioritize data clarity, professional trust, and cognitive efficiency over visual experimentation. Material Design's elevation system and component library paired with dark mode optimization provides ideal foundation for dense financial data.

**Reference Influences:** TradingView (charts), Robinhood (modern financial UI), Bloomberg Terminal (information density)

## Core Design Elements

### A. Color Palette

**Dark Mode Foundation:**
- Background Base: 222 14% 8%
- Surface Elevated: 222 14% 11%
- Surface Higher: 222 14% 14%
- Border/Divider: 222 10% 20%

**Semantic Colors:**
- Success/Long: 142 76% 45% (vibrant green for profitable trades)
- Danger/Short: 0 84% 60% (red for losses/short positions)
- Primary/Action: 217 91% 60% (blue for CTAs, links)
- Warning: 38 92% 50% (amber for alerts)
- Neutral Text: 222 10% 90% (primary text)
- Muted Text: 222 8% 65% (secondary information)

### B. Typography

**Font Stack:**
- Primary: 'Inter' (Google Fonts) - UI text, labels, metrics
- Monospace: 'JetBrains Mono' (Google Fonts) - numerical data, prices, percentages

**Scale:**
- Metric Display: text-3xl/font-bold (trade prices, P&L)
- Section Headers: text-xl/font-semibold
- Data Labels: text-sm/font-medium
- Body/Descriptions: text-base/font-normal
- Micro Labels: text-xs/font-medium (timestamps, metadata)

### C. Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, and 8 consistently
- Tight spacing: p-2, gap-2 (within components)
- Standard spacing: p-4, gap-4 (component padding)
- Section spacing: p-6, gap-6 (between related groups)
- Major sections: p-8, gap-8 (dashboard sections)

**Grid System:**
- Dashboard: 12-column responsive grid
- Cards: max-w-7xl container with gap-6 between cards
- Sidebar: Fixed 280px on desktop, collapsible on mobile

### D. Component Library

**Navigation:**
- Top bar: Fixed header (h-16) with app logo, search, notifications, user profile
- Sidebar: Vertical navigation with icon + label, active state with primary color accent bar
- Tab navigation: Underline style for section switching within pages

**Data Display Components:**

*AI Recommendations Card:*
- Surface elevated background with border-l-4 accent (green/red for long/short)
- Stock symbol in text-xl/monospace
- Separate fields: Stock Entry Price (Fibonacci 0.707) with label "Entry Price" and small "Fib 0.707" badge
- Premium field with prominent pricing display
- Strategy type badge (top-right corner)
- Confidence score as progress bar

*Trade Cards:*
- Compact card layout (min-h-32)
- Left accent border indicating position type
- Top row: Symbol + Current Price
- Middle: Entry/Target/Stop with inline labels
- Bottom: P&L percentage in large, colored typography
- Hover: Subtle elevation increase (shadow-md to shadow-lg)

*Portfolio Overview:*
- Stat cards grid (grid-cols-1 md:grid-cols-2 lg:grid-cols-4)
- Large metric display with trend indicator (arrow + percentage)
- Mini sparkline chart for trend visualization

*Data Tables:*
- Striped rows (every other row slightly lighter background)
- Sticky header row
- Monospace for all numerical columns
- Right-align numbers, left-align text
- Row hover state: surface higher background
- Sortable columns with subtle arrow indicators

*Charts:*
- Use Chart.js or Lightweight Charts library
- Dark theme with 222 14% 18% chart background
- Grid lines at 222 10% 22%
- Green/red candlesticks or line colors
- Tooltip: Surface elevated with shadow-xl

**Forms & Inputs:**
- Input fields: Surface elevated background, border on focus (primary color)
- Labels: text-sm/font-medium above inputs
- Dark mode compliant: all inputs maintain 222 14% 11% background
- Select dropdowns: Custom styled with down arrow icon
- Buttons: Variant styles with rounded-md corners

**Overlays:**
- Modals: Surface higher background with shadow-2xl, max-w-2xl
- Backdrop: bg-black/60 blur effect
- Toast notifications: Fixed top-right, auto-dismiss, icon + message

### E. Animations

**Minimal Motion Strategy:**
- Number updates: CountUp animation for P&L changes (duration: 800ms)
- Page transitions: None (instant navigation for data focus)
- Loading states: Subtle pulse on skeleton screens
- Hover states: Quick scale(1.02) on interactive cards (150ms ease)

## Images

**Hero Section:** NO large hero image - this is a data dashboard, immediate utility takes precedence. Start with condensed navigation + portfolio summary cards.

**Supporting Images:**
- Stock logos/icons: Small circular avatars (32x32px) next to ticker symbols
- Empty states: Minimal illustrations for "No trades" states
- Tutorial/Onboarding: Optional inline graphics if help section exists

## Layout Architecture

**Dashboard Structure:**
1. **Header Bar** (fixed, h-16): Logo, search, real-time market status, notifications, profile
2. **Sidebar** (280px desktop): Navigation, watchlist, quick filters
3. **Main Content** (flex-1): 
   - Portfolio summary cards (4-column grid)
   - AI Recommendations section (2-column grid on desktop, stack mobile)
   - Active trades table
   - Market overview charts
4. **Footer**: Minimal - disclaimer text, version, support link

**Key Sections:**
- AI Recommendations: Separate Stock Entry Price (with Fib 0.707 notation) and Premium as distinct, prominent fields in each recommendation card
- Market Data: Real-time ticker, major indices, volume metrics
- Portfolio Tracking: P&L, win rate, active positions count, account value trend

**Responsive Breakpoints:**
- Mobile: Stack all multi-column grids, collapsible sidebar
- Tablet: 2-column grids where applicable
- Desktop: Full 12-column grid system