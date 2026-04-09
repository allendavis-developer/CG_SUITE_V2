import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import NotificationToast from '@/components/ui/NotificationToast';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const idCounterRef = useRef(0);

  /** Must stay referentially stable: consumers' useEffects must not re-run on every toast. */
  const showNotification = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${idCounterRef.current++}`;
    setNotifications((prev) => [...prev, { id, message, type }]);
  }, []);

  /** Stable ref so toasts' auto-dismiss timers are not reset on every provider re-render. */
  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
  }, []);

  const value = useMemo(
    () => ({ showNotification, dismissNotification }),
    [showNotification, dismissNotification]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed top-3 right-3 z-[1000] flex max-w-[min(100vw-1.5rem,28rem)] flex-col items-end gap-2 sm:max-w-md">
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
