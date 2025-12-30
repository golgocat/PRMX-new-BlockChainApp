'use client';

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { useThemeStore } from '@/stores/themeStore';
import type { V3EventType } from '@/types/v3';
import type { V3Observation } from '@/lib/api-v3';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Theme-aware colors
const getChartColors = (theme: 'light' | 'dark') => ({
  primary: theme === 'light' ? '#0ea5e9' : '#00E5FF',
  primaryBg: theme === 'light' ? 'rgba(14, 165, 233, 0.1)' : 'rgba(0, 229, 255, 0.1)',
  threshold: theme === 'light' ? '#ef4444' : '#f87171',
  grid: theme === 'light' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(55, 65, 81, 0.3)',
  text: theme === 'light' ? '#64748b' : '#6B7280',
  legendText: theme === 'light' ? '#475569' : '#9CA3AF',
  tooltipBg: theme === 'light' ? '#ffffff' : '#1F2937',
  tooltipTitle: theme === 'light' ? '#0f172a' : '#FFFFFF',
  tooltipBody: theme === 'light' ? '#64748b' : '#9CA3AF',
  tooltipBorder: theme === 'light' ? '#e2e8f0' : '#374151',
});

interface WeatherHistoryChartProps {
  observations: V3Observation[];
  eventType: V3EventType;
  threshold: number;
  thresholdUnit: string;
  coverageStart: number;
  coverageEnd: number;
  loading?: boolean;
  error?: string | null;
}

/**
 * Extract value from observation based on event type
 * For cumulative types, we show the running sum
 */
function getObservationValue(
  obs: V3Observation, 
  eventType: V3EventType,
  previousSum: number = 0
): number | null {
  const fields = obs.fields || {};
  
  switch (eventType) {
    case 'PrecipSumGte':
      // For cumulative, add to previous sum
      const hourly = fields.precip_1h_mm_x1000 ? fields.precip_1h_mm_x1000 / 1000 : 0;
      return previousSum + hourly;
    case 'Precip1hGte':
      return fields.precip_1h_mm_x1000 ? fields.precip_1h_mm_x1000 / 1000 : null;
    case 'TempMaxGte':
      return fields.temp_c_x1000 ? fields.temp_c_x1000 / 1000 : null;
    case 'TempMinLte':
      return fields.temp_c_x1000 ? fields.temp_c_x1000 / 1000 : null;
    case 'WindGustMaxGte':
      return fields.wind_gust_mps_x1000 ? fields.wind_gust_mps_x1000 / 1000 : null;
    default:
      return null;
  }
}

/**
 * Get unit label for event type
 */
function getUnitLabel(eventType: V3EventType): string {
  switch (eventType) {
    case 'PrecipSumGte':
    case 'Precip1hGte':
      return 'mm';
    case 'TempMaxGte':
    case 'TempMinLte':
      return '°C';
    case 'WindGustMaxGte':
      return 'm/s';
    default:
      return '';
  }
}

/**
 * Get data label for event type
 */
function getDataLabel(eventType: V3EventType): string {
  switch (eventType) {
    case 'PrecipSumGte':
      return 'Cumulative Rainfall';
    case 'Precip1hGte':
      return 'Hourly Rainfall';
    case 'TempMaxGte':
      return 'Max Temperature';
    case 'TempMinLte':
      return 'Min Temperature';
    case 'WindGustMaxGte':
      return 'Wind Gust';
    default:
      return 'Value';
  }
}

export function WeatherHistoryChart({
  observations,
  eventType,
  threshold,
  thresholdUnit,
  coverageStart,
  coverageEnd,
  loading = false,
  error = null,
}: WeatherHistoryChartProps) {
  const { theme } = useThemeStore();
  const colors = useMemo(() => getChartColors(theme), [theme]);

  // Filter observations within coverage period and sort by time
  const filteredObservations = useMemo(() => {
    return observations
      .filter(obs => {
        const obsTime = obs.epoch_time;
        return obsTime >= coverageStart && obsTime <= coverageEnd;
      })
      .sort((a, b) => a.epoch_time - b.epoch_time);
  }, [observations, coverageStart, coverageEnd]);

  // Prepare chart data
  const chartData = useMemo(() => {
    const labels: string[] = [];
    const values: (number | null)[] = [];
    let runningSum = 0;
    
    filteredObservations.forEach(obs => {
      const date = new Date(obs.epoch_time * 1000);
      // Format: "Dec 29, 14:30"
      labels.push(
        date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false 
        })
      );
      
      const value = getObservationValue(obs, eventType, runningSum);
      if (value !== null && eventType === 'PrecipSumGte') {
        runningSum = value; // Update running sum for cumulative
      }
      values.push(value);
    });

    return {
      labels,
      datasets: [
        {
          label: getDataLabel(eventType),
          data: values,
          borderColor: colors.primary,
          backgroundColor: colors.primaryBg,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: colors.primary,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
        // Threshold line - divide by 1000 to match observation values
        // (threshold is stored as value * 1000 to avoid decimals on-chain)
        {
          label: 'Threshold',
          data: filteredObservations.map(() => threshold / 1000),
          borderColor: colors.threshold,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [filteredObservations, eventType, threshold, colors]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: colors.legendText,
          usePointStyle: true,
          padding: 20,
        },
      },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipTitle,
        bodyColor: colors.tooltipBody,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          title: function(context: any[]) {
            if (context.length > 0) {
              const index = context[0].dataIndex;
              const obs = filteredObservations[index];
              if (obs) {
                const date = new Date(obs.epoch_time * 1000);
                return date.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                });
              }
            }
            return '';
          },
          label: function(context: any) {
            const value = context.parsed.y;
            if (value === null) return 'No data';
            const unit = getUnitLabel(eventType);
            // Both datasets now use the same scale (divided by 1000)
            return `${context.dataset.label}: ${value.toFixed(1)} ${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: colors.grid,
        },
        ticks: {
          color: colors.text,
          maxRotation: 45,
          minRotation: 45,
        },
      },
      y: {
        grid: {
          color: colors.grid,
        },
        ticks: {
          color: colors.text,
          callback: function(value: any) {
            const unit = getUnitLabel(eventType);
            return `${value} ${unit}`;
          },
        },
      },
    },
  }), [colors, filteredObservations, eventType]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Weather History</h3>
        </CardHeader>
        <CardContent>
          <div className="h-72 flex items-center justify-center">
            <div className="animate-pulse text-text-tertiary">Loading observations...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Weather History</h3>
        </CardHeader>
        <CardContent>
          <div className="h-72 flex items-center justify-center">
            <div className="text-center text-text-secondary max-w-md">
              <p className="mb-2 text-error">Failed to load observations</p>
              <p className="text-sm text-text-tertiary">{error}</p>
              <p className="text-xs text-text-tertiary mt-2">
                Make sure the oracle service is running on port 3001
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (filteredObservations.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    const hasStarted = now >= coverageStart;
    const hasEnded = now >= coverageEnd;
    
    let message = 'No observations available yet';
    let detail = 'Weather data will appear here once observations are recorded';
    
    if (!hasStarted) {
      const startDate = new Date(coverageStart * 1000);
      detail = `Coverage starts on ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Observations will begin after coverage starts.`;
    } else if (hasEnded) {
      detail = 'Coverage period has ended. No observations were recorded during this period.';
    } else {
      detail = 'The offchain worker is monitoring this policy. Observations will appear here as they are recorded.';
    }
    
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Weather History</h3>
        </CardHeader>
        <CardContent>
          <div className="h-72 flex items-center justify-center">
            <div className="text-center text-text-secondary max-w-md">
              <p className="mb-2">{message}</p>
              <p className="text-sm text-text-tertiary">{detail}</p>
              {observations.length > 0 && (
                <p className="text-xs text-text-tertiary mt-2">
                  Note: {observations.length} observation{observations.length !== 1 ? 's' : ''} found, but none within the coverage period
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Weather History</h3>
            <p className="text-sm text-text-secondary">
              {filteredObservations.length} observation{filteredObservations.length !== 1 ? 's' : ''} during coverage period
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <Line data={chartData} options={chartOptions} />
        </div>
      </CardContent>
    </Card>
  );
}

