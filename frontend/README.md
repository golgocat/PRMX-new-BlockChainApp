# PRMX Frontend

A modern, fully-featured frontend application for the PRMX Parametric Rainfall Insurance platform built on the Polkadot blockchain.

![PRMX Logo](./public/logo.svg)

## Features

- 🌧️ **Parametric Insurance** - Automated rainfall-based insurance coverage
- 📊 **Real-time Oracle Data** - AccuWeather integration for rainfall monitoring
- 💱 **LP Trading** - Orderbook for trading liquidity provider tokens
- 📈 **Analytics Dashboard** - Comprehensive platform metrics and insights
- 🔐 **Polkadot Wallet Integration** - Secure wallet connection via Polkadot.js
- 🎨 **Modern UI** - Beautiful gradient-based design following PRMX brand guidelines

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Blockchain**: Polkadot.js API
- **Charts**: Chart.js + react-chartjs-2
- **Animations**: Framer Motion
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Polkadot.js browser extension (for wallet connection)

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
├── public/              # Static assets (logos, images)
├── src/
│   ├── app/            # Next.js App Router pages
│   │   ├── page.tsx    # Dashboard
│   │   ├── markets/    # Markets explorer
│   │   ├── policies/   # Policy management
│   │   ├── lp/         # LP trading
│   │   ├── oracle/     # Oracle data
│   │   ├── analytics/  # Analytics dashboard
│   │   ├── docs/       # Documentation
│   │   ├── help/       # Help & FAQ
│   │   └── settings/   # User settings
│   ├── components/
│   │   ├── ui/         # Reusable UI components
│   │   ├── layout/     # Layout components
│   │   └── features/   # Feature-specific components
│   ├── hooks/          # Custom React hooks
│   ├── lib/            # Utility functions
│   ├── stores/         # Zustand state stores
│   └── types/          # TypeScript types
├── tailwind.config.ts  # Tailwind configuration
└── package.json
```

## Key Pages

### Dashboard (`/`)
Overview of the platform with key statistics, recent activity, and market summaries.

### Markets (`/markets`)
Browse available insurance markets by region with real-time rainfall data.

### Policies (`/policies`)
View and manage your insurance policies.

### New Policy (`/policies/new`)
Multi-step form to request quotes and apply for coverage.

### LP Trading (`/lp`)
Trade LP tokens on the orderbook and manage your LP positions.

### Oracle Data (`/oracle`)
Real-time rainfall data visualization from AccuWeather.

### Analytics (`/analytics`)
Platform-wide performance metrics and charts.

## Design System

The PRMX design system is based on the brand guidelines with:

### Colors
- **Cyan**: `#00E5FF` - Primary accent
- **Blue**: `#2196F3` - Secondary
- **Purple**: `#9C27B0` - Tertiary
- **Magenta**: `#E040FB` - Highlight

### Gradients
The signature PRMX gradient flows from cyan through blue and purple to magenta, creating the distinctive brand identity.

### Components
- Glass-morphism cards with subtle blur effects
- Gradient buttons and accents
- Dark theme optimized for readability
- Responsive design for all screen sizes

## Configuration

### Environment Variables

Create a `.env.local` file:

```env
# Blockchain RPC endpoint
NEXT_PUBLIC_RPC_URL=ws://localhost:9944

# API endpoints (if applicable)
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Tailwind Configuration

The design tokens are configured in `tailwind.config.ts` including:
- Brand colors
- Custom gradients
- Animations
- Typography

## Development

### Code Style

- ESLint for code quality
- Prettier for formatting
- TypeScript for type safety

### Component Guidelines

- Use the provided UI components from `@/components/ui`
- Follow the established patterns for new features
- Keep components small and focused

## Integration with Blockchain

The frontend is designed to integrate with the PRMX Substrate pallets:

- `pallet_prmx_markets` - Market data
- `pallet_prmx_policy` - Policy management
- `pallet_prmx_holdings` - LP token holdings
- `pallet_prmx_orderbook_lp` - LP trading
- `pallet_prmx_oracle` - Rainfall data
- `pallet_prmx_quote` - Quote requests

Currently using mock data for demonstration. Connect to a running PRMX node to enable full functionality.

## License

MIT

## Support

For questions or issues, please open a GitHub issue or contact the PRMX team.
