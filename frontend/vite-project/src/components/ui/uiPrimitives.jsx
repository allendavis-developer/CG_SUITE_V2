import React from 'react';

export const Icon = ({ name, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  onClick,
  className = '',
  disabled = false,
  type = 'button',
}) => {
  const baseStyles =
    'font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';

  const variants = {
    primary:
      'bg-brand-orange hover:bg-brand-orange-hover text-brand-blue shadow-sm shadow-brand-orange/25 active:scale-[0.98] focus-visible:ring-brand-orange',
    secondary:
      'bg-brand-blue hover:bg-brand-blue-hover text-white shadow-sm active:scale-[0.98] focus-visible:ring-brand-blue',
    outline:
      'border border-slate-200 bg-white text-slate-700 hover:border-brand-blue hover:text-brand-blue hover:bg-brand-blue/5 focus-visible:ring-brand-blue',
    ghost: 'text-slate-500 hover:text-brand-blue hover:bg-brand-blue/5 focus-visible:ring-brand-blue',
    danger:
      'bg-red-600 hover:bg-red-700 text-white shadow-sm active:scale-[0.98] focus-visible:ring-red-500',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-sm',
  };

  const disabledStyles = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variants[variant] ?? variants.primary} ${sizes[size]} ${disabledStyles} ${className}`}
    >
      {icon && <Icon name={icon} className="text-[18px] leading-none" />}
      {children}
    </button>
  );
};

export const Badge = ({ children, variant = 'default', dot = false, className = '' }) => {
  const variants = {
    default: 'bg-brand-blue/[0.07] text-brand-blue border-brand-blue/15',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  const dotColors = {
    default: 'bg-brand-blue',
    warning: 'bg-amber-500',
    success: 'bg-emerald-500',
    danger: 'bg-red-500',
    purple: 'bg-purple-500',
    neutral: 'bg-slate-500',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wide ${variants[variant] ?? variants.default} ${className}`}
    >
      {dot && (
        <span className={`size-1.5 rounded-full shrink-0 ${dotColors[variant] ?? dotColors.default}`} />
      )}
      {children}
    </span>
  );
};
