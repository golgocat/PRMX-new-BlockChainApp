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
import { CloudRain, Thermometer, Wind, Droplets } from 'lucide-react';
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

// Theme-aware colors - more refined palette
const getChartColors = (theme: 'light' | 'dark') => ({
  primary: theme === 'light' ? '#0ea5e9' : '#22d3ee',
  primaryBg: theme === 'light' ? 'rgba(14, 165, 233, 0.08)' : 'rgba(34, 211, 238, 0.12)',
  threshold: theme === 'light' ? '#f43f5e' : '#fb7185',
  thresholdBg: theme === 'light' ? 'rgba(244, 63, 94, 0.05)' : 'rgba(251, 113, 133, 0.05)',
  grid: theme === 'light' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(71, 85, 105, 0.25)',
  text: theme === 'light' ? '#94a3b8' : '#64748b',
  legendText: theme === 'light' ? '#64748b' : '#94a3b8',
  tooltipBg: theme === 'light' ? '#ffffff' : '#0f172a',
  tooltipTitle: theme === 'light' ? '#0f172a' : '#f1f5f9',
  tooltipBody: theme === 'light' ? '#64748b' : '#94a3b8',
  tooltipBorder: theme === 'light' ? '#e2e8f0' : '#1e293b',
});

// Get icon for event type
function getEventIcon(eventType: V3EventType) {
  switch (eventType) {
    case 'PrecipSumGte':
      return CloudRain;
    case 'Precip1hGte':
      return Droplets;
    case 'TempMaxGte':
    case 'TempMinLte':
      return Thermometer;
    case 'WindGustMaxGte':
      return Wind;
    default:
      return CloudRain;
  }
}

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
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: colors.primary,
          pointBorderColor: theme === 'light' ? '#fff' : '#0f172a',
          pointBorderWidth: 2,
          borderWidth: 2.5,
        },
        // Threshold line - divide by 1000 to match observation values
        // (threshold is stored as value * 1000 to avoid decimals on-chain)
        {
          label: 'Threshold',
          data: filteredObservations.map(() => threshold / 1000),
          borderColor: colors.threshold,
          backgroundColor: colors.thresholdBg,
          borderWidth: 2,
          borderDash: [8, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [filteredObservations, eventType, threshold, colors, theme]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: false, // We'll use custom legend
      },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipTitle,
        bodyColor: colors.tooltipBody,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        padding: 14,
        cornerRadius: 8,
        displayColors: true,
        boxPadding: 6,
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
            return ` ${context.dataset.label}: ${value.toFixed(1)} ${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: colors.grid,
          drawBorder: false,
        },
        ticks: {
          color: colors.text,
          maxRotation: 45,
          minRotation: 45,
          font: {
            size: 11,
          },
        },
        border: {
          display: false,
        },
      },
      y: {
        grid: {
          color: colors.grid,
          drawBorder: false,
        },
        ticks: {
          color: colors.text,
          padding: 8,
          font: {
            size: 11,
          },
          callback: function(value: any) {
            const unit = getUnitLabel(eventType);
            return `${value} ${unit}`;
          },
        },
        border: {
          display: false,
        },
      },
    },
  }), [colors, filteredObservations, eventType]);

  const EventIcon = getEventIcon(eventType);
  const unit = getUnitLabel(eventType);
  const thresholdDisplay = threshold / 1000;

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="h-80 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-prmx-cyan/10 flex items-center justify-center">
                <EventIcon className="w-5 h-5 text-prmx-cyan animate-pulse" />
              </div>
              <p className="text-sm text-text-tertiary">Loading weather data...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="h-80 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-error/10 flex items-center justify-center">
                <EventIcon className="w-6 h-6 text-error" />
              </div>
              <p className="font-medium text-error mb-1">Failed to load observations</p>
              <p className="text-sm text-text-tertiary">{error}</p>
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
    
    let message = 'No observations yet';
    let detail = 'Weather data will appear once monitoring begins';
    
    if (!hasStarted) {
      const startDate = new Date(coverageStart * 1000);
      detail = `Coverage starts ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else if (hasEnded) {
      detail = 'No observations were recorded during coverage';
    }
    
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="h-80 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-background-tertiary flex items-center justify-center">
                <EventIcon className="w-6 h-6 text-text-tertiary" />
              </div>
              <p className="font-medium text-text-secondary mb-1">{message}</p>
              <p className="text-sm text-text-tertiary">{detail}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get the latest value for display
  const latestValue = chartData.datasets[0].data[chartData.datasets[0].data.length - 1];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header section */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-prmx-cyan/10 flex items-center justify-center">
                <EventIcon className="w-5 h-5 text-prmx-cyan" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">Weather History</h3>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {filteredObservations.length} observation{filteredObservations.length !== 1 ? 's' : ''} recorded
                </p>
              </div>
            </div>
            
            {/* Current value badge */}
            {latestValue !== null && (
              <div className="text-right">
                <p className="text-xs text-text-tertiary mb-0.5">Current</p>
                <p className="text-lg font-bold text-prmx-cyan">
                  {(latestValue as number).toFixed(1)} {unit}
                </p>
              </div>
            )}
          </div>
          
          {/* Custom legend */}
          <div className="flex items-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-prmx-cyan" />
              <span className="text-xs text-text-secondary">{getDataLabel(eventType)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-0 border-t-2 border-dashed border-rose-400" />
              <span className="text-xs text-text-secondary">Threshold ({thresholdDisplay} {unit})</span>
            </div>
          </div>
        </div>
        
        {/* Chart area with subtle gradient background */}
        <div className="relative px-4 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-prmx-cyan/[0.02] to-prmx-cyan/[0.04] pointer-events-none" />
          <div className="h-64 relative">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

