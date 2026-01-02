'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, TrendingUp, Droplets, MapPin, Clock, RefreshCw, ArrowUpRight, Timer } from 'lucide-react'
import { FadeIn } from '@/components/ui/FadeIn'
import * as api from '@/lib/api'
import * as apiV3 from '@/lib/api-v3'
import { formatUSDT } from '@/lib/utils'
import type { Market, LpAskOrder, Policy } from '@/types'
import type { V3Policy } from '@/types/v3'
import type { ThresholdTriggerLog } from '@/lib/api'

interface BestOpportunity {
  order: LpAskOrder
  market: Market | undefined
  policy: Policy | V3Policy | undefined
  potentialReturn: number
  timeToMaturity: string
  policyLabel: string
  isV3: boolean
}

function formatTimeRemaining(endTimestamp: number): string {
  const now = Date.now()
  const end = endTimestamp * 1000 // Convert seconds to milliseconds
  const diff = end - now
  
  if (diff <= 0) return 'Expired'
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  
  if (days > 0) {
    return `${days}d ${hours}h`
  } else if (hours > 0) {
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  } else {
    const minutes = Math.floor(diff / (1000 * 60))
    return `${minutes}m`
  }
}

function formatPolicyId(policyId: string | number): string {
  if (typeof policyId === 'string' && policyId.startsWith('0x')) {
    // V3 hex ID - show first 8 chars
    return policyId.slice(2, 10) + '...'
  }
  return String(policyId)
}

export function LPLiveData() {
  const router = useRouter()
  const [markets, setMarkets] = useState<Market[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [v3Policies, setV3Policies] = useState<V3Policy[]>([])
  const [orders, setOrders] = useState<LpAskOrder[]>([])
  const [triggerLogs, setTriggerLogs] = useState<ThresholdTriggerLog[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchData = async () => {
    try {
      const [marketsData, policiesData, v3PoliciesData, ordersData, logsData] = await Promise.all([
        api.getMarkets(),
        api.getPolicies(),
        apiV3.getV3Policies(),
        api.getLpOrders(),
        api.getThresholdTriggerLogs(),
      ])
      setMarkets(marketsData)
      setPolicies(policiesData)
      setV3Policies(v3PoliciesData)
      setOrders(ordersData)
      setTriggerLogs(logsData)
      setLastUpdate(new Date())
    } catch (error) {
      console.error('Failed to fetch live data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchData()
  }

  // Calculate best opportunities (highest potential return)
  const opportunities: BestOpportunity[] = orders
    .map(order => {
      // Check V1/V2 policies first
      let policy: Policy | V3Policy | undefined = policies.find(p => p.id === order.policyId)
      let isV3 = false
      
      // Check V3 policies if not found in V1/V2
      if (!policy) {
        policy = v3Policies.find(p => p.id === order.policyId)
        isV3 = !!policy
      }
      
      // Get market - V1/V2 policies have marketId, V3 policies have locationId
      const market = policy && !isV3 ? markets.find(m => m.id === (policy as Policy).marketId) : undefined
      const payoutPerShare = BigInt(100_000_000) // $100 in smallest units
      const potentialReturn = Number(order.priceUsdt) > 0 
        ? Number(payoutPerShare - order.priceUsdt) / Number(order.priceUsdt) * 100
        : 0
      const timeToMaturity = policy ? formatTimeRemaining(policy.coverageEnd) : 'Unknown'
      
      // Create a user-friendly label
      let policyLabel: string
      if (isV3 && policy) {
        const v3Policy = policy as V3Policy
        policyLabel = v3Policy.location?.name || formatPolicyId(order.policyId)
      } else if (policy) {
        policyLabel = `${market?.name || 'Policy'} #${order.policyId}`
      } else {
        policyLabel = formatPolicyId(order.policyId)
      }
      
      return { order, market, policy, potentialReturn, timeToMaturity, policyLabel, isV3 }
    })
    .filter(opp => opp.potentialReturn > 0) // Only show opportunities with positive returns
    .sort((a, b) => b.potentialReturn - a.potentialReturn)
    .slice(0, 4)

  return (
    <section className="relative bg-slate-100 py-32 md:py-40 px-6 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 right-0 w-[600px] h-[600px] rounded-full bg-sky-100/60 blur-[200px]" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-16">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-100 border border-sky-200 mb-6">
                <Activity size={16} className="text-sky-600" />
                <span className="text-sm font-medium text-sky-700 font-ui">
                  Live Data
                </span>
                {lastUpdate && (
                  <>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs text-slate-500 font-ui">
                      Updated {lastUpdate.toLocaleTimeString()}
                    </span>
                  </>
                )}
              </div>

            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 leading-[1.1] font-display mb-4">
              Real-time{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-500">
                market data.
              </span>
            </h2>
              <p className="text-xl text-slate-600 font-ui">
                Direct from the blockchain. Updated every 30 seconds.
              </p>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-6 md:mt-0 flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all disabled:opacity-50 shadow-sm"
            >
              <RefreshCw size={16} className={`transition-transform ${refreshing ? 'animate-spin' : ''}`} />
              <span className="text-sm font-ui">Refresh</span>
            </button>
          </div>
        </FadeIn>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            {
              label: 'Active Markets',
              value: loading ? '...' : markets.filter(m => m.status === 'Open').length.toString(),
              icon: MapPin,
              color: 'sky',
            },
            {
              label: 'Active Policies',
              value: loading ? '...' : (policies.filter(p => p.status === 'Active').length + v3Policies.filter(p => p.status === 'Active').length).toString(),
              icon: TrendingUp,
              color: 'cyan',
            },
            {
              label: 'Open Orders',
              value: loading ? '...' : orders.length.toString(),
              icon: Droplets,
              color: 'blue',
            },
            {
              label: 'Historical Triggers',
              value: loading ? '...' : triggerLogs.length.toString(),
              icon: Activity,
              color: 'indigo',
            },
          ].map((stat, i) => (
            <FadeIn key={stat.label} delay={i * 100}>
              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div 
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{
                      backgroundColor: stat.color === 'sky' ? 'rgba(14, 165, 233, 0.1)' :
                                      stat.color === 'cyan' ? 'rgba(6, 182, 212, 0.1)' :
                                      stat.color === 'blue' ? 'rgba(59, 130, 246, 0.1)' :
                                      'rgba(99, 102, 241, 0.1)',
                    }}
                  >
                    <stat.icon 
                      size={20} 
                      style={{
                        color: stat.color === 'sky' ? '#0ea5e9' :
                               stat.color === 'cyan' ? '#06b6d4' :
                               stat.color === 'blue' ? '#3b82f6' :
                               '#6366f1',
                      }} 
                    />
                  </div>
                </div>
                <p className="text-3xl font-bold text-slate-900 font-display mb-1">{stat.value}</p>
                <p className="text-sm text-slate-500 font-ui">{stat.label}</p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Opportunities Table */}
        <FadeIn delay={400}>
          <div className="rounded-[2rem] bg-white border border-slate-200 overflow-hidden shadow-lg">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 font-display">Top Opportunities</h3>
                <p className="text-sm text-slate-500 font-ui">Current orderbook highlights</p>
              </div>
              <div className="flex items-center gap-2 text-cyan-600">
                <Activity size={16} />
                <span className="text-xs font-ui">LIVE</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={24} className="animate-spin text-slate-400" />
              </div>
            ) : opportunities.length === 0 ? (
              <div className="text-center py-16">
                <TrendingUp size={32} className="mx-auto mb-4 text-slate-400" />
                <p className="text-slate-500 font-ui">No opportunities available</p>
                <p className="text-sm text-slate-400 font-ui mt-1">Check back later for new LP opportunities</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {opportunities.map((opp, i) => (
                  <div key={opp.order.orderId} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/10 to-sky-500/10 border border-cyan-200/50 flex items-center justify-center text-cyan-600 font-mono text-sm font-bold">
                        #{i + 1}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900 font-display">
                            {opp.policyLabel}
                          </p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            opp.isV3 
                              ? 'bg-cyan-100 text-cyan-700' 
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {opp.isV3 ? 'V3' : 'V1'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 font-ui flex items-center gap-2">
                          <Clock size={12} />
                          {opp.order.remaining.toString()} shares available
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 md:gap-8">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-slate-400 font-ui uppercase tracking-wide">Time Left</p>
                        <p className="font-semibold text-slate-700 font-display flex items-center justify-end gap-1.5 mt-0.5">
                          <Timer size={14} className="text-cyan-500" />
                          {opp.timeToMaturity}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400 font-ui uppercase tracking-wide">Price</p>
                        <p className="font-semibold text-slate-900 font-display mt-0.5">{formatUSDT(opp.order.priceUsdt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400 font-ui uppercase tracking-wide">Return</p>
                        <p className="font-bold text-emerald-600 font-display mt-0.5">
                          +{opp.potentialReturn.toFixed(1)}%
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const policyUrl = opp.isV3 
                            ? `/v3/policies/${opp.order.policyId}`
                            : `/policies/${opp.order.policyId}`
                          router.push(policyUrl)
                        }}
                        className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-50 to-sky-50 border border-cyan-200/50 flex items-center justify-center text-cyan-500 hover:text-cyan-600 hover:border-cyan-300 hover:shadow-md transition-all cursor-pointer"
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50">
              <p className="text-xs text-slate-500 font-ui text-center">
                Data refreshes automatically every 30 seconds. Connect wallet to trade.
              </p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
