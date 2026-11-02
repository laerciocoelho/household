import type { ComponentType } from 'react';

export type IconComponent = ComponentType<{ className?: string }>;

const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
};

// Silhuetas simples (estilo "placa de banheiro") no mesmo traço dos ícones lucide.
const MAN = (
  <>
    <circle cx="12" cy="4.5" r="2" />
    <path d="M9.5 9.5h5v6h-5z" />
    <path d="M7 10.5V15M17 10.5V15M10.8 15.5V21M13.2 15.5V21" />
  </>
);
const WOMAN = (
  <>
    <circle cx="12" cy="4.5" r="2" />
    <path d="M12 9l-4 8h8z" />
    <path d="M10.5 17v4M13.5 17v4" />
  </>
);

export const ManIcon: IconComponent = ({ className }) => <svg {...base} className={className}>{MAN}</svg>;
export const WomanIcon: IconComponent = ({ className }) => <svg {...base} className={className}>{WOMAN}</svg>;

// Crianças: mesma silhueta, menores e alinhadas à base
export const BoyIcon: IconComponent = ({ className }) => (
  <svg {...base} strokeWidth={2.6} className={className}>
    <g transform="translate(3 6) scale(.75)">{MAN}</g>
  </svg>
);
export const GirlIcon: IconComponent = ({ className }) => (
  <svg {...base} strokeWidth={2.6} className={className}>
    <g transform="translate(3 6) scale(.75)">{WOMAN}</g>
  </svg>
);

export const CoupleIcon: IconComponent = ({ className }) => (
  <svg {...base} strokeWidth={2.8} className={className}>
    <g transform="translate(-0.8 5.5) scale(.65)">{MAN}</g>
    <g transform="translate(9.2 5.5) scale(.65)">{WOMAN}</g>
  </svg>
);
