import React, { useState, useEffect } from 'react';

const NotificationToast = ({ message, type, onClose }) => {
  const [isVisible, setIsVisible] = useState(false); // Start hidden for animation
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Animate in
    setIsVisible(true);

    const timer = setTimeout(() => {
      setIsExiting(true); // Start exit animation
      setTimeout(onClose, 300); // Close after exit animation duration (must match transition duration)
    }, 5000); // Notification disappears after 5 seconds

    return () => clearTimeout(timer);
  }, [onClose]);

  // Determine styles based on type
  let bgColor = '';
  let textColor = '';
  let borderColor = '';
  let iconColor = '';

  switch (type) {
    case 'success':
      bgColor = 'bg-green-100'; // Lighter background for better contrast with border
      textColor = 'text-green-800';
      borderColor = 'border-green-500';
      iconColor = 'text-green-600';
      break;
    case 'error':
      bgColor = 'bg-red-100';
      textColor = 'text-red-800';
      borderColor = 'border-red-500';
      iconColor = 'text-red-600';
      break;
    case 'info':
    default:
      bgColor = 'bg-blue-100';
      textColor = 'text-blue-800';
      borderColor = 'border-blue-500';
      iconColor = 'text-blue-600';
      break;
  }

  return (
    <div
      className={`
        relative p-5 rounded-lg shadow-lg flex items-center space-x-4
        transition-all duration-300 ease-out transform
        ${bgColor} ${textColor} border-l-4 ${borderColor}
        ${isVisible && !isExiting ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}
        w-full max-w-sm
      `}
      role="alert"
    >
      <div className="flex-shrink-0">
        {type === 'success' && (
          <svg className={`h-6 w-6 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )}
        {type === 'error' && (
          <svg className={`h-6 w-6 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        )}
        {type === 'info' && (
          <svg className={`h-6 w-6 ${iconColor}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2h1a1 1 0 001-1V8a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <p className="text-base font-medium">{message}</p> {/* Increased font size */}
      </div>
      <button
        onClick={() => {
          setIsExiting(true);
          setTimeout(onClose, 300); // Allow exit animation to complete
        }}
        className={`ml-auto -mr-1.5 -my-1.5 ${textColor} rounded-lg focus:ring-2 focus:ring-${type}-400 p-1.5 hover:${bgColor} inline-flex h-8 w-8`}
      >
        <span className="sr-only">Dismiss</span>
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path>
        </svg>
      </button>
    </div>
  );
};

export default NotificationToast;
