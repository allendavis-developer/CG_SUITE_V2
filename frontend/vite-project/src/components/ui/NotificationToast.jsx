import React, { useState, useEffect, useRef } from 'react';

/** Short-lived toasts; errors stay slightly longer so they can be read. */
const DURATION_MS = {
  success: 2200,
  info: 2200,
  warning: 3200,
  error: 3600,
};

const NotificationToast = ({ id, message, type = 'info', onDismiss }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    setIsVisible(true);
    const duration = DURATION_MS[type] ?? DURATION_MS.info;
    let exitTimer;

    const mainTimer = window.setTimeout(() => {
      setIsExiting(true);
      exitTimer = window.setTimeout(() => onDismissRef.current(id), 280);
    }, duration);

    return () => {
      window.clearTimeout(mainTimer);
      if (exitTimer != null) window.clearTimeout(exitTimer);
    };
  }, [id, type]);

  let bgColor = '';
  let textColor = '';
  let borderColor = '';
  let iconColor = '';

  switch (type) {
    case 'success':
      bgColor = 'bg-green-50';
      textColor = 'text-green-900';
      borderColor = 'border-green-500';
      iconColor = 'text-green-600';
      break;
    case 'error':
      bgColor = 'bg-red-50';
      textColor = 'text-red-900';
      borderColor = 'border-red-500';
      iconColor = 'text-red-600';
      break;
    case 'warning':
      bgColor = 'bg-amber-50';
      textColor = 'text-amber-950';
      borderColor = 'border-amber-500';
      iconColor = 'text-amber-700';
      break;
    case 'info':
    default:
      bgColor = 'bg-brand-blue/5';
      textColor = 'text-brand-blue';
      borderColor = 'border-brand-blue';
      iconColor = 'text-brand-blue';
      break;
  }

  const handleManualClose = () => {
    setIsExiting(true);
    window.setTimeout(() => onDismiss(id), 280);
  };

  return (
    <div
      className={`
        relative flex max-w-full items-start gap-2 rounded-md border-l-[3px] px-3 py-2 shadow-md
        transition-all duration-300 ease-out
        ${bgColor} ${textColor} ${borderColor}
        ${isVisible && !isExiting ? 'opacity-100 translate-x-0' : 'pointer-events-none opacity-0 translate-x-4'}
      `}
      role="alert"
    >
      <div className="mt-0.5 flex-shrink-0">
        {type === 'success' && (
          <svg className={`h-4 w-4 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )}
        {type === 'error' && (
          <svg className={`h-4 w-4 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        )}
        {type === 'warning' && (
          <svg className={`h-4 w-4 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )}
        {(type === 'info' || !['success', 'error', 'warning'].includes(type)) && (
          <svg className={`h-4 w-4 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2h1a1 1 0 001-1V8a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-snug">{message}</p>
      </div>
      <button
        type="button"
        onClick={handleManualClose}
        className={`flex-shrink-0 rounded p-0.5 ${textColor} opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-blue/40`}
      >
        <span className="sr-only">Dismiss</span>
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
};

export default NotificationToast;
