# PRMX Frontend

A modern, fully-featured frontend application for the PRMX Parametric Rainfall Insurance platform built on the Polkadot blockchain.

<p align="center">
  <img src="./public/logo.svg" alt="PRMX Logo" width="150"/>
</p>

## Features

- **Parametric Insurance** - Automated rainfall-based insurance with V1 (24h) and V2 (2-7 day) coverage options
- **Real-time Oracle Data** - AccuWeather integration with hourly rainfall visualization
- **Dual Oracle Monitoring** - V1 (on-chain rolling sum) and V2 (off-chain cumulative) oracle pages
- **LP Trading** - Full orderbook for trading policy-specific LP tokens with trade history
- **Policy Management** - Create, view, and track V1/V2 policies with settlement details
- **Polkadot Wallet Integration** - Secure wallet connection via Polkadot.js extension
- **Modern UI** - Beautiful gradient-based design with smooth animations and silent data refresh

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 14 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS |
| **State Management** | Zustand |
| **Blockchain** | Polkadot.js API |
| **Charts** | Chart.js + react-chartjs-2 |
| **Animations** | Framer Motion |
| **Icons** | Lucide React |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Polkadot.js browser extension (for wallet connection)
- Running PRMX blockchain node (see [main README](../README.md))

### Installation

1. Navigate to the frontend directory:

```bash
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
frontend/
├── public/                    # Static assets (logos, images)
│   ├── logo.svg
│   ├── logo_black.png
│   ├── logo_white.png
│   └── favicon.ico
│
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── (dashboard)/       # Dashboard layout group
│   │   │   ├── dashboard/     # Main dashboard
│   │   │   ├── markets/       # Markets list + detail
│   │   │   ├── policies/      # Policies list + detail + new
│   │   │   ├── lp/            # LP trading orderbook
│   │   │   ├── oracle/        # V1 Oracle (24h rolling)
│   │   │   ├── oracle-v2/     # Oracle Service Dashboard (V2 + V3)
│   │   │   ├── help/          # Help & FAQ
│   │   │   ├── settings/      # User settings
│   │   │   └── layout.tsx     # Dashboard layout
│   │   ├── (landing)/         # Landing page group
│   │   ├── globals.css        # Global styles
│   │   └── layout.tsx         # Root layout
│   │
│   ├── components/
│   │   ├── ui/                # Reusable UI components
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Table.tsx
│   │   │   └── ...
│   │   ├── layout/            # Layout components
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   ├── features/          # Feature-specific components
│   │   │   └── AccountSelector.tsx
│   │   └── sections/          # Page section components
│   │       ├── dashboard/
│   │       ├── lp/
│   │       ├── markets/
│   │       ├── oracle/
│   │       └── policies/
│   │
│   ├── hooks/                 # Custom React hooks
│   │   ├── useChainData.ts    # Blockchain data fetching
│   │   ├── usePolkadot.ts     # Polkadot.js connection
│   │   └── ...
│   │
│   ├── lib/                   # Utility functions
│   │   ├── api.ts             # Blockchain API calls
│   │   ├── utils.ts           # Helper utilities
│   │   └── formatters.ts      # Data formatters
│   │
│   ├── stores/                # Zustand state stores
│   │   ├── useAccountStore.ts
│   │   └── usePolkadotStore.ts
│   │
│   └── types/                 # TypeScript types
│       └── index.ts
│
├── tailwind.config.ts         # Tailwind configuration
├── next.config.js             # Next.js configuration
├── tsconfig.json              # TypeScript configuration
└── package.json
```

## Pages

### Dashboard (`/dashboard`)

Platform overview with key statistics:
- Total markets, active policies, total value locked
- Recent policy activity
- Market summaries with rainfall data

### Markets (`/markets`)

Browse available insurance markets:
- Market list with real-time rainfall data
- V1/V2 availability indicators
- Coverage window rules

### Market Detail (`/markets/[id]`)

Individual market information:
- Current rainfall vs strike threshold
- Hourly rainfall breakdown (V1 oracle)
- Active policies for the market
- Coverage window configuration

### Policies (`/policies`)

View and manage insurance policies:
- Policy list with V1/V2 badges
- Status indicators (Active, Settled, Expired)
- Quick actions for each policy

### Policy Detail (`/policies/[id]`)

Detailed policy information:
- Coverage period and status
- Premium and payout amounts
- LP token holders and ownership percentages
- Settlement payouts (for settled policies)

### New Policy (`/policies/new`)

Multi-step quote and coverage flow:
1. Select market and coverage type (V1/V2)
2. Choose coverage dates and duration
3. Request and view quote
4. Apply for coverage

### LP Trading (`/lp`)

Full LP token trading interface:
- Orderbook with V1/V2 policy labels
- Your LP holdings across policies
- Trade history with detail modals
- Position outcomes tracking

### Oracle V1 (`/oracle`)

On-chain oracle monitoring:
- 24-hour rolling rainfall per market
- Hourly bucket breakdown with Historical/Live badges
- Market-by-market rainfall comparison

### Oracle Service Dashboard (`/oracle-v2`)

Off-chain oracle monitoring:
- V2 policy monitors with cumulative rainfall
- Coverage progress visualization
- Strike threshold indicators
- Evidence hash links

### Settings (`/settings`)

User preferences:
- RPC endpoint configuration
- Display preferences

### Help (`/help`)

FAQ and documentation links.

## Key Features

### Silent Data Refresh

The frontend uses silent background polling to update data without UI disruption:
- No loading spinners during refresh
- Scroll position preserved
- Smooth transitions with `useTransition`

### Trade Detail Modals

Click any trade in the LP trading history to see:
- Full order details
- Price and quantity
- Transaction timestamp
- Policy information

### V1/V2 Labels

Clear visual indicators throughout the UI:
- Policy version badges on all listings
- Orderbook entries marked with V1/V2
- Market pages show coverage type availability

### Animated Refresh Buttons

All refresh buttons feature smooth rotation animations:
- Visual feedback during data fetch
- Consistent UX across pages

### Chain Reset Detection

Trade history and local storage are automatically cleared when the blockchain is reset:
- Genesis hash validation
- Clean slate for new chain instances

## Configuration

### Environment Variables

Create a `.env.local` file:

```env
# Blockchain RPC endpoint
NEXT_PUBLIC_RPC_URL=ws://localhost:9944

# Oracle V2 API endpoint
NEXT_PUBLIC_ORACLE_V2_URL=http://localhost:3001
```

### Tailwind Configuration

The design tokens are configured in `tailwind.config.ts`:

```typescript
// Brand colors
colors: {
  prmx: {
    cyan: '#00E5FF',
    blue: '#2196F3',
    purple: '#9C27B0',
    magenta: '#E040FB',
  }
}
```

## Design System

### Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Cyan | `#00E5FF` | Primary accent |
| Blue | `#2196F3` | Secondary |
| Purple | `#9C27B0` | Tertiary |
| Magenta | `#E040FB` | Highlight |

### Gradients

The signature PRMX gradient flows from cyan through blue and purple to magenta:

```css
background: linear-gradient(135deg, #00E5FF, #2196F3, #9C27B0, #E040FB);
```

### Components

- **Glass-morphism cards** with subtle blur effects
- **Gradient buttons** and accents
- **Dark theme** optimized for readability
- **Responsive design** for all screen sizes

## Development

### Code Style

- ESLint for code quality
- TypeScript for type safety
- Consistent component patterns

### Component Guidelines

1. Use provided UI components from `@/components/ui`
2. Follow established patterns for new features
3. Keep components small and focused
4. Use custom hooks for data fetching

### Adding New Pages

1. Create page in `src/app/(dashboard)/your-page/page.tsx`
2. Add navigation link in `Sidebar.tsx`
3. Create section components in `src/components/sections/your-page/`
4. Add data hooks in `src/hooks/useChainData.ts`

## Integration with Blockchain

The frontend integrates with PRMX Substrate pallets via Polkadot.js API:

| Pallet | Frontend Usage |
|--------|----------------|
| `prmx-markets` | Market listings, rainfall thresholds |
| `prmx-policy` | Policy creation, status, settlement |
| `prmx-holdings` | LP token balances, ownership |
| `prmx-orderbook-lp` | Order placement, trade execution |
| `prmx-oracle` | V1 rainfall data, hourly buckets |
| `prmx-quote` | Quote requests, pricing |

### API Functions

Key functions in `src/lib/api.ts`:

```typescript
// Markets
getMarkets(): Promise<Market[]>
getMarket(id: number): Promise<Market>

// Policies
getPolicies(): Promise<Policy[]>
getPolicy(id: number): Promise<Policy>

// LP Trading
getLpOrders(): Promise<LpAskOrder[]>
getLpHoldingsForPolicy(policyId: number): Promise<LpHolding[]>

// Oracle
getHourlyBuckets(marketId: number): Promise<HourlyBucket[]>
getRollingState(marketId: number): Promise<RollingState>
```

## License

MIT

## Support

For questions or issues:
- Open a GitHub issue
- See [main project README](../README.md) for full documentation
