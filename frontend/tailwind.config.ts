import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // PRMX Brand Colors - Based on the gradient logo
        prmx: {
          cyan: '#00E5FF',
          'cyan-light': '#5EFEEC',
          blue: '#2196F3',
          'blue-dark': '#1565C0',
          purple: '#9C27B0',
          'purple-light': '#BA68C8',
          magenta: '#E040FB',
          'magenta-light': '#EA80FC',
        },
        // Landing page brand colors
        brand: {
          violet: '#8A4AF3',
          teal: '#00C48C',
          amber: '#FFA000',
          magenta: '#FF4081',
        },
        // UI Colors - using RGB format for opacity support
        background: {
          primary: 'rgb(var(--bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--bg-tertiary) / <alpha-value>)',
          card: 'rgb(var(--bg-card) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
        },
        border: {
          primary: 'rgb(var(--border-primary) / <alpha-value>)',
          secondary: 'rgb(var(--border-secondary) / <alpha-value>)',
        },
        // Status Colors
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
      },
      backgroundImage: {
        'prmx-gradient': 'linear-gradient(135deg, #00E5FF 0%, #2196F3 25%, #9C27B0 50%, #E040FB 75%, #00E5FF 100%)',
        'prmx-gradient-horizontal': 'linear-gradient(90deg, #00E5FF 0%, #2196F3 33%, #9C27B0 66%, #E040FB 100%)',
        'prmx-gradient-vertical': 'linear-gradient(180deg, #00E5FF 0%, #2196F3 33%, #9C27B0 66%, #E040FB 100%)',
        'prmx-gradient-radial': 'radial-gradient(circle, #2196F3 0%, #9C27B0 50%, #E040FB 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(0, 229, 255, 0.1) 0%, rgba(156, 39, 176, 0.1) 100%)',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)',
      },
      boxShadow: {
        'prmx-glow': '0 0 40px rgba(0, 229, 255, 0.3), 0 0 80px rgba(156, 39, 176, 0.2)',
        'prmx-glow-sm': '0 0 20px rgba(0, 229, 255, 0.2), 0 0 40px rgba(156, 39, 176, 0.1)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
      },
      animation: {
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(0, 229, 255, 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(156, 39, 176, 0.5)' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        // Landing page fonts
        display: ['var(--font-plus-jakarta)', 'sans-serif'],
        ui: ['var(--font-inter)', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};

export default config;
