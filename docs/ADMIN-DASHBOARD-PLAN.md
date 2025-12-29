# Admin/DAO Dashboard Feature Plan

## Overview
A comprehensive dashboard for DAO administrators and operators to monitor system health, track failed operations, and analyze policy performance.

## Feature Requirements

### 1. OCW (Offchain Worker) Health Status

#### Data Sources
- **Oracle Service API**: Existing `/health` endpoint
- **V3 Oracle Service**: `/ingest/stats` endpoint
- **Chain State**: Query for recent snapshot submissions
- **Logs**: OCW activity indicators

#### Metrics to Display
- ✅ Service Status (Online/Offline)
- ✅ Last Successful Operation Timestamp
- ✅ Policies Being Monitored Count
- ✅ Recent Snapshot Submissions (last 24h)
- ✅ Recent Observation Submissions (last 24h)
- ✅ AccuWeather API Status (if available)
- ✅ Database Connection Status
- ✅ Chain Connection Status
- ✅ Error Rate (failed operations / total operations)

#### UI Components
- **Health Status Card**: Overall system health with color indicators
- **OCW Activity Timeline**: Recent operations with timestamps
- **Service Status Grid**: Individual service statuses (Oracle V2, Oracle V3, Chain, Database)
- **Real-time Refresh**: Auto-refresh every 30 seconds

#### Implementation Files
- `frontend/src/app/(dashboard)/admin/page.tsx` - Main dashboard page
- `frontend/src/components/admin/OcwHealthCard.tsx` - Health status component
- `frontend/src/lib/api-admin.ts` - Admin API functions
- `offchain-oracle-service/src/api/routes.ts` - Add enhanced health endpoint

---

### 2. Failed Transactions Log

#### Data Sources
- **On-chain Events**: Query `system.ExtrinsicFailed` events
- **Oracle Service Logs**: Failed OCW submissions
- **Database**: Store failed transaction records (MongoDB)

#### Data to Track
- Transaction Hash (if available)
- Policy ID (if related)
- Timestamp
- Error Type/Reason
- Error Message
- Retry Status
- Block Number
- Pallet/Method that failed

#### Database Schema (MongoDB)
```typescript
interface FailedTransaction {
  _id: string; // transaction hash or unique ID
  tx_hash?: string;
  block_number?: number;
  timestamp: number;
  policy_id?: number;
  pallet: string;
  method: string;
  error_type: string;
  error_message: string;
  retry_count: number;
  last_retry_at?: number;
  resolved: boolean;
  resolved_at?: number;
  created_at: Date;
  updated_at: Date;
}
```

#### UI Components
- **Failed Transactions Table**: Sortable, filterable table
- **Filters**: By date range, error type, policy ID, resolved status
- **Error Details Modal**: Expandable row with full error details
- **Retry Action**: Button to manually retry failed transactions (if applicable)
- **Export**: Export to CSV functionality

#### API Endpoints (Oracle Service)
- `GET /admin/failed-transactions` - List failed transactions
- `POST /admin/failed-transactions/:id/retry` - Retry failed transaction
- `POST /admin/failed-transactions/:id/resolve` - Mark as resolved
- `GET /admin/failed-transactions/stats` - Error statistics

#### Implementation Files
- `frontend/src/components/admin/FailedTransactionsTable.tsx`
- `frontend/src/components/admin/ErrorDetailsModal.tsx`
- `offchain-oracle-service/src/db/mongo.ts` - Add failed_transactions collection
- `offchain-oracle-service/src/api/routes.ts` - Add admin endpoints

---

### 3. Policy Analytics

#### Data Sources
- **Chain State**: Query all policies from `prmxPolicyV3.policies`
- **Oracle Service**: Policy monitoring data
- **Settlement Results**: On-chain settlement data

#### Analytics Metrics

##### Overview Stats
- Total Policies Created
- Active Policies Count
- Settled Policies Count
- Triggered Policies Count
- Total Premium Collected
- Total Payouts Distributed
- Net Revenue (Premium - Payouts)

##### Time-based Analytics
- Policies Created (by day/week/month)
- Premium Collected Over Time
- Payouts Over Time
- Trigger Rate Over Time

##### Location Analytics
- Policies by Location
- Trigger Rate by Location
- Average Premium by Location
- Average Payout by Location

##### Event Type Analytics
- Policies by Event Type
- Trigger Rate by Event Type
- Average Coverage Duration by Event Type

##### Performance Metrics
- Average Policy Duration
- Average Premium per Policy
- Average Payout per Policy
- Trigger Rate (%)
- Loss Ratio (Payouts / Premiums)

#### UI Components
- **Stats Overview Cards**: Key metrics at a glance
- **Revenue Chart**: Premium vs Payouts over time (line chart)
- **Policies Chart**: Policies created over time (bar chart)
- **Location Breakdown**: Chart showing policies/triggers by location
- **Event Type Breakdown**: Chart showing distribution by event type
- **Performance Metrics Table**: Detailed metrics with comparisons
- **Date Range Selector**: Filter analytics by time period

#### Implementation Files
- `frontend/src/components/admin/PolicyAnalytics.tsx`
- `frontend/src/components/admin/RevenueChart.tsx`
- `frontend/src/components/admin/LocationBreakdown.tsx`
- `frontend/src/lib/api-admin.ts` - Analytics aggregation functions
- `offchain-oracle-service/src/api/routes.ts` - Add analytics endpoint (if needed for aggregation)

---

## File Structure

```
frontend/src/
├── app/(dashboard)/
│   └── admin/
│       └── page.tsx                    # Main admin dashboard page
├── components/
│   └── admin/
│       ├── OcwHealthCard.tsx          # OCW health status card
│       ├── ServiceStatusGrid.tsx      # Service status indicators
│       ├── OcwActivityTimeline.tsx    # Recent activity timeline
│       ├── FailedTransactionsTable.tsx # Failed transactions table
│       ├── ErrorDetailsModal.tsx      # Error details modal
│       ├── PolicyAnalytics.tsx        # Analytics main component
│       ├── RevenueChart.tsx           # Premium vs payouts chart
│       ├── LocationBreakdown.tsx      # Location analytics
│       └── AnalyticsFilters.tsx       # Date range and filter controls
├── lib/
│   └── api-admin.ts                   # Admin API functions
└── types/
    └── admin.ts                       # Admin-related types

offchain-oracle-service/src/
├── api/
│   └── routes.ts                      # Add admin endpoints
├── db/
│   └── mongo.ts                       # Add failed_transactions collection
└── models/
    └── failed-transaction.ts          # Failed transaction model (if using TypeScript models)
```

---

## API Design

### Admin API Endpoints

#### Health & Status
```typescript
GET /admin/health
Response: {
  success: boolean;
  data: {
    overall_status: 'healthy' | 'degraded' | 'down';
    services: {
      oracle_v2: { status: string; last_check: number };
      oracle_v3: { status: string; last_check: number };
      chain: { status: string; last_check: number };
      database: { status: string; last_check: number };
    };
    ocw_metrics: {
      policies_monitored: number;
      snapshots_last_24h: number;
      observations_last_24h: number;
      last_successful_operation: number;
      error_rate: number;
    };
  };
}
```

#### Failed Transactions
```typescript
GET /admin/failed-transactions?limit=50&offset=0&status=unresolved
Response: {
  success: boolean;
  data: FailedTransaction[];
  total: number;
}

GET /admin/failed-transactions/stats
Response: {
  success: boolean;
  data: {
    total: number;
    unresolved: number;
    by_error_type: Record<string, number>;
    by_pallet: Record<string, number>;
  };
}

POST /admin/failed-transactions/:id/retry
POST /admin/failed-transactions/:id/resolve
```

#### Policy Analytics
```typescript
GET /admin/analytics/policies?start_date=...&end_date=...
Response: {
  success: boolean;
  data: {
    overview: {
      total_policies: number;
      active: number;
      settled: number;
      triggered: number;
      total_premium: bigint;
      total_payouts: bigint;
      net_revenue: bigint;
    };
    time_series: Array<{ date: string; policies: number; premium: bigint; payouts: bigint }>;
    by_location: Array<{ location_id: number; location_name: string; policies: number; triggered: number }>;
    by_event_type: Array<{ event_type: string; policies: number; triggered: number }>;
    performance: {
      avg_duration: number;
      avg_premium: bigint;
      avg_payout: bigint;
      trigger_rate: number;
      loss_ratio: number;
    };
  };
}
```

---

## Implementation Phases

### Phase 1: OCW Health Status (Week 1)
1. ✅ Enhance oracle service `/health` endpoint
2. ✅ Create `OcwHealthCard` component
3. ✅ Create `ServiceStatusGrid` component
4. ✅ Create admin dashboard page with health section
5. ✅ Add auto-refresh functionality

### Phase 2: Failed Transactions Log (Week 2)
1. ✅ Add `failed_transactions` collection to MongoDB
2. ✅ Implement transaction failure tracking in OCW
3. ✅ Create admin API endpoints for failed transactions
4. ✅ Create `FailedTransactionsTable` component
5. ✅ Create `ErrorDetailsModal` component
6. ✅ Add filtering and export functionality

### Phase 3: Policy Analytics (Week 3)
1. ✅ Implement analytics aggregation logic
2. ✅ Create `PolicyAnalytics` component
3. ✅ Create chart components (Revenue, Location, etc.)
4. ✅ Add date range filtering
5. ✅ Add export functionality for analytics data

### Phase 4: Integration & Polish (Week 4)
1. ✅ Integrate all components into admin dashboard
2. ✅ Add loading states and error handling
3. ✅ Add permissions check (DAO only)
4. ✅ Write documentation
5. ✅ Testing and bug fixes

---

## Security & Permissions

### Access Control
- Dashboard should only be accessible to DAO accounts
- Use existing `useIsDao()` hook for permission checks
- Redirect non-DAO users to home page
- Add server-side validation for admin endpoints (if needed)

### Data Privacy
- Failed transactions may contain sensitive information
- Only show relevant error details (no private keys, etc.)
- Consider rate limiting on admin endpoints

---

## UI/UX Considerations

### Design Principles
- Clear visual hierarchy with status indicators
- Real-time updates where applicable
- Responsive design for mobile/tablet
- Dark mode support (consistent with existing theme)
- Loading states for all async operations
- Error states with helpful messages

### Color Scheme
- **Healthy**: Green (#10b981)
- **Degraded**: Yellow/Orange (#f59e0b)
- **Down**: Red (#ef4444)
- **Info**: Cyan (#00E5FF)

### Navigation
- Add "Admin" link to sidebar (DAO only)
- Breadcrumbs for navigation
- Quick action buttons for common tasks

---

## Testing Strategy

### Unit Tests
- Test analytics aggregation logic
- Test failed transaction filtering/sorting
- Test health status calculations

### Integration Tests
- Test API endpoints
- Test database operations
- Test component rendering with mock data

### Manual Testing
- Test with DAO account
- Test with non-DAO account (should be blocked)
- Test real-time updates
- Test error scenarios

---

## Future Enhancements

1. **Alerting System**: Email/SMS alerts for critical failures
2. **Performance Monitoring**: Track OCW performance metrics
3. **Cost Analysis**: Track gas costs for transactions
4. **Predictive Analytics**: ML-based trigger predictions
5. **Audit Log**: Comprehensive audit trail of all admin actions
6. **Custom Reports**: User-defined analytics reports
7. **Export Enhancements**: PDF reports, scheduled exports

---

## Dependencies

### Frontend
- Existing Chart.js setup (for analytics charts)
- Existing UI components (Card, Table, Badge, etc.)
- Existing wallet store (for DAO check)

### Backend
- MongoDB (for failed transactions storage)
- Existing oracle service infrastructure
- Chain API access

---

## Notes

- Consider using a separate admin service if the dashboard grows complex
- Failed transactions should be cleaned up after 90 days (TTL index)
- Analytics data can be computed on-demand or cached (consider caching for performance)
- Consider adding pagination for large datasets
- Make sure all admin operations are logged for audit purposes

