import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import NotificationToast from '@/components/ui/NotificationToast';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const idCounterRef = useRef(0);

  const showNotification = (message, type = 'info') => {
    const id = `${Date.now()}-${idCounterRef.current++}`;
    setNotifications((prev) => [...prev, { id, message, type }]);
  };

  /** Stable ref so toasts' auto-dismiss timers are not reset on every provider re-render. */
  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      <div className="pointer-events-none fixed top-3 right-3 z-[1000] flex max-w-[min(100vw-1.5rem,20rem)] flex-col items-end gap-1.5 sm:max-w-xs">
        {notifications.map((notif) => (
          <div key={notif.id} className="pointer-events-auto w-full">
            <NotificationToast
              id={notif.id}
              message={notif.message}
              type={notif.type}
              onDismiss={dismissNotification}
            />
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  return useContext(NotificationContext);
};
