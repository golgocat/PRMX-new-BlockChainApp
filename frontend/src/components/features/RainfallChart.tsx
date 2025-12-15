'use client';

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { useThemeStore } from '@/stores/themeStore';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Theme-aware colors
const getChartColors = (theme: 'light' | 'dark') => ({
  cyan: theme === 'light' ? '#0ea5e9' : '#00E5FF',
  cyanBg: theme === 'light' ? 'rgba(14, 165, 233, 0.1)' : 'rgba(0, 229, 255, 0.1)',
  cyanBgStrong: theme === 'light' ? 'rgba(14, 165, 233, 0.6)' : 'rgba(0, 229, 255, 0.6)',
  purple: '#9C27B0',
  purpleBg: 'rgba(156, 39, 176, 0.1)',
  purpleBgStrong: 'rgba(156, 39, 176, 0.6)',
  grid: theme === 'light' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(55, 65, 81, 0.3)',
  text: theme === 'light' ? '#64748b' : '#6B7280',
  legendText: theme === 'light' ? '#475569' : '#9CA3AF',
  tooltipBg: theme === 'light' ? '#ffffff' : '#1F2937',
  tooltipTitle: theme === 'light' ? '#0f172a' : '#FFFFFF',
  tooltipBody: theme === 'light' ? '#64748b' : '#9CA3AF',
  tooltipBorder: theme === 'light' ? '#e2e8f0' : '#374151',
});

// Mock rainfall data labels
const rainfallLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const manilaData = [12, 19, 3, 5, 2, 3, 45];
const cebuData = [8, 15, 7, 12, 4, 6, 22];

export function RainfallChart() {
  const { theme } = useThemeStore();
  const colors = useMemo(() => getChartColors(theme), [theme]);

  const mockRainfallData = useMemo(() => ({
    labels: rainfallLabels,
    datasets: [
      {
        label: 'Manila',
        data: manilaData,
        borderColor: colors.cyan,
        backgroundColor: colors.cyanBg,
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Cebu',
        data: cebuData,
        borderColor: colors.purple,
        backgroundColor: colors.purpleBg,
        fill: true,
        tension: 0.4,
      },
    ],
  }), [colors]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
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
          label: function(context: any) {
            return `${context.dataset.label}: ${context.parsed.y} mm`;
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
        },
      },
      y: {
        grid: {
          color: colors.grid,
        },
        ticks: {
          color: colors.text,
          callback: function(value: any) {
            return `${value} mm`;
          },
        },
      },
    },
  }), [colors]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Rainfall Data (24h Rolling)</h3>
            <p className="text-sm text-text-secondary">Last 7 days across active markets</p>
          </div>
          <select className="select-field w-32 !py-2 text-sm">
            <option value="7d">7 Days</option>
            <option value="30d">30 Days</option>
            <option value="90d">90 Days</option>
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <Line data={mockRainfallData} options={chartOptions} />
        </div>
      </CardContent>
    </Card>
  );
}

// Premium distribution chart data
const premiumLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const premiumCollectedData = [15000, 22000, 18000, 35000, 42000, 38000];
const claimsPaidData = [5000, 8000, 3000, 15000, 12000, 8000];

export function PremiumChart() {
  const { theme } = useThemeStore();
  const colors = useMemo(() => getChartColors(theme), [theme]);

  const mockPremiumData = useMemo(() => ({
    labels: premiumLabels,
    datasets: [
      {
        label: 'Premium Collected',
        data: premiumCollectedData,
        backgroundColor: colors.cyanBgStrong,
        borderColor: colors.cyan,
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Claims Paid',
        data: claimsPaidData,
        backgroundColor: colors.purpleBgStrong,
        borderColor: colors.purple,
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  }), [colors]);

  const barChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
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
          label: function(context: any) {
            return `${context.dataset.label}: $${context.parsed.y.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: colors.text,
        },
      },
      y: {
        grid: {
          color: colors.grid,
        },
        ticks: {
          color: colors.text,
          callback: function(value: any) {
            return `$${(value / 1000).toFixed(0)}k`;
          },
        },
      },
    },
  }), [colors]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Premium vs Claims</h3>
            <p className="text-sm text-text-secondary">Monthly comparison</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <Bar data={mockPremiumData} options={barChartOptions} />
        </div>
      </CardContent>
    </Card>
  );
}
