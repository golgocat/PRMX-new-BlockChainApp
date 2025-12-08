'use client';

import { useEffect, useRef } from 'react';
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

// Mock rainfall data for demo
const mockRainfallData = {
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  datasets: [
    {
      label: 'Manila',
      data: [12, 19, 3, 5, 2, 3, 45],
      borderColor: '#00E5FF',
      backgroundColor: 'rgba(0, 229, 255, 0.1)',
      fill: true,
      tension: 0.4,
    },
    {
      label: 'Cebu',
      data: [8, 15, 7, 12, 4, 6, 22],
      borderColor: '#9C27B0',
      backgroundColor: 'rgba(156, 39, 176, 0.1)',
      fill: true,
      tension: 0.4,
    },
  ],
};

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: '#9CA3AF',
        usePointStyle: true,
        padding: 20,
      },
    },
    tooltip: {
      backgroundColor: '#1F2937',
      titleColor: '#FFFFFF',
      bodyColor: '#9CA3AF',
      borderColor: '#374151',
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
        color: 'rgba(55, 65, 81, 0.3)',
      },
      ticks: {
        color: '#6B7280',
      },
    },
    y: {
      grid: {
        color: 'rgba(55, 65, 81, 0.3)',
      },
      ticks: {
        color: '#6B7280',
        callback: function(value: any) {
          return `${value} mm`;
        },
      },
    },
  },
};

export function RainfallChart() {
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

// Premium distribution chart
const mockPremiumData = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [
    {
      label: 'Premium Collected',
      data: [15000, 22000, 18000, 35000, 42000, 38000],
      backgroundColor: 'rgba(0, 229, 255, 0.6)',
      borderColor: '#00E5FF',
      borderWidth: 1,
      borderRadius: 4,
    },
    {
      label: 'Claims Paid',
      data: [5000, 8000, 3000, 15000, 12000, 8000],
      backgroundColor: 'rgba(156, 39, 176, 0.6)',
      borderColor: '#9C27B0',
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
};

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: '#9CA3AF',
        usePointStyle: true,
        padding: 20,
      },
    },
    tooltip: {
      backgroundColor: '#1F2937',
      titleColor: '#FFFFFF',
      bodyColor: '#9CA3AF',
      borderColor: '#374151',
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
        color: '#6B7280',
      },
    },
    y: {
      grid: {
        color: 'rgba(55, 65, 81, 0.3)',
      },
      ticks: {
        color: '#6B7280',
        callback: function(value: any) {
          return `$${(value / 1000).toFixed(0)}k`;
        },
      },
    },
  },
};

export function PremiumChart() {
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
