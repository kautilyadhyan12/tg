/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Base surfaces ────────────────────────────────────────────────────
        base:    '#0A0908',
        surface: '#121110',
        elevated:'#1A1815',
        border:  'rgba(255,255,255,0.06)',

        // ── Amber accent system ──────────────────────────────────────────────
        amber: {
          DEFAULT: '#FF8A1F',
          50:  '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FFB347',
          400: '#FF8A1F',
          500: '#F97316',
          600: '#C4521A',
          700: '#9A3412',
          800: '#7C2D12',
          900: '#431407',
        },

        // ── Keep primary for backward compat ─────────────────────────────────
        primary: {
          DEFAULT: '#FF8A1F',
          50:  '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FFB347',
          400: '#FF8A1F',
          500: '#F97316',
          600: '#FF8A1F',
          700: '#C4521A',
          800: '#9A3412',
          900: '#7C2D12',
        },

        // ── Dark surfaces ────────────────────────────────────────────────────
        dark: {
          50:  '#2A2825',
          100: '#1A1815',
          200: '#121110',
          300: '#0D0C0B',
          400: '#0A0908',
        },

        // ── Semantic ─────────────────────────────────────────────────────────
        success: '#22c55e',
        danger:  '#ef4444',
        gold:    '#FFD66B',
      },

      fontFamily: {
        sans:    ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        display: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        xs:    ['0.75rem',  { lineHeight: '1rem'     }],
        sm:    ['0.875rem', { lineHeight: '1.25rem'  }],
        base:  ['1rem',     { lineHeight: '1.6rem'   }],
        lg:    ['1.125rem', { lineHeight: '1.75rem'  }],
        xl:    ['1.25rem',  { lineHeight: '1.875rem' }],
        '2xl': ['1.5rem',   { lineHeight: '2rem'     }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem'  }],
        '4xl': ['2.25rem',  { lineHeight: '2.5rem'   }],
        '5xl': ['3rem',     { lineHeight: '1.1'      }],
        '6xl': ['3.75rem',  { lineHeight: '1.05'     }],
        '7xl': ['4.5rem',   { lineHeight: '1'        }],
        '8xl': ['6rem',     { lineHeight: '1'        }],
        '9xl': ['8rem',     { lineHeight: '1'        }],
      },

      letterSpacing: {
        tightest: '-0.04em',
        tighter:  '-0.02em',
        tight:    '-0.01em',
        normal:   '0em',
        wide:     '0.02em',
        wider:    '0.05em',
        widest:   '0.1em',
      },

      borderRadius: {
        sm:   '0.375rem',
        md:   '0.5rem',
        lg:   '0.75rem',
        xl:   '1rem',
        '2xl':'1.25rem',
        '3xl':'1.5rem',
        '4xl':'2rem',
        full: '9999px',
      },

      boxShadow: {
        'amber-sm': '0 0 15px rgba(255,138,31,0.15)',
        'amber':    '0 0 30px rgba(255,138,31,0.2)',
        'amber-lg': '0 0 60px rgba(255,138,31,0.25)',
        'amber-xl': '0 0 100px rgba(255,138,31,0.3)',
        'card':     '0 4px 24px rgba(0,0,0,0.4)',
        'card-lg':  '0 8px 48px rgba(0,0,0,0.6)',
        'inset-amber': 'inset 0 1px 0 rgba(255,138,31,0.1)',
      },

      backgroundImage: {
        'amber-gradient':   'linear-gradient(135deg, #FF8A1F, #FFB347)',
        'amber-radial':     'radial-gradient(ellipse at center, rgba(255,138,31,0.15) 0%, transparent 70%)',
        'dark-gradient':    'linear-gradient(180deg, #0A0908 0%, #121110 100%)',
        'hero-gradient':    'radial-gradient(ellipse at 50% 0%, #1A0F08 0%, #0A0908 60%)',
        'card-gradient':    'linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
        'amber-glow':       'radial-gradient(ellipse, rgba(255,138,31,0.2) 0%, transparent 60%)',
      },

      animation: {
        'fade-in':        'fadeIn 0.5s ease forwards',
        'fade-up':        'fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) forwards',
        'fade-down':      'fadeDown 0.5s ease forwards',
        'scale-in':       'scaleIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards',
        'slide-in-left':  'slideInLeft 0.5s cubic-bezier(0.22,1,0.36,1) forwards',
        'slide-in-right': 'slideInRight 0.5s cubic-bezier(0.22,1,0.36,1) forwards',
        'pulse-amber':    'pulseAmber 2s ease-in-out infinite',
        'glow':           'glow 3s ease-in-out infinite',
        'float':          'float 6s ease-in-out infinite',
        'shimmer':        'shimmer 2s linear infinite',
        'spin-slow':      'spin 8s linear infinite',
        'bounce-subtle':  'bounceSubtle 2s ease-in-out infinite',
        'count-up':       'countUp 1s ease-out forwards',
        'draw-line':      'drawLine 1s ease forwards',
      },

      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to:   { opacity: '1', transform: 'translateY(0)'    },
        },
        fadeDown: {
          from: { opacity: '0', transform: 'translateY(-20px)' },
          to:   { opacity: '1', transform: 'translateY(0)'     },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.9)' },
          to:   { opacity: '1', transform: 'scale(1)'   },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-30px)' },
          to:   { opacity: '1', transform: 'translateX(0)'     },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(30px)' },
          to:   { opacity: '1', transform: 'translateX(0)'    },
        },
        pulseAmber: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255,138,31,0.2)' },
          '50%':      { boxShadow: '0 0 40px rgba(255,138,31,0.4)' },
        },
        glow: {
          '0%, 100%': { opacity: '0.5' },
          '50%':      { opacity: '1'   },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)'   },
          '50%':      { transform: 'translateY(-10px)' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to:   { backgroundPosition: '200% 0'  },
        },
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(0)'   },
          '50%':      { transform: 'translateY(-4px)' },
        },
        drawLine: {
          from: { strokeDashoffset: '1000' },
          to:   { strokeDashoffset: '0'    },
        },
      },

      transitionTimingFunction: {
        'spring':      'cubic-bezier(0.22, 1, 0.36, 1)',
        'out-expo':    'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-expo': 'cubic-bezier(0.87, 0, 0.13, 1)',
      },

      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '16px',
        xl: '24px',
        '2xl': '40px',
      },
    },
  },
  plugins: [],
};