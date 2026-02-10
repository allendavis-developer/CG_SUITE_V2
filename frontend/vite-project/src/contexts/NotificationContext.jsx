import React, { createContext, useContext, useState, useRef } from 'react';
import NotificationToast from '@/components/ui/NotificationToast';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const idCounterRef = useRef(0);

  const showNotification = (message, type = 'info') => {
    // Use counter + timestamp to ensure unique IDs even with rapid calls
    // Using useRef to avoid state update delays
    const id = `${Date.now()}-${idCounterRef.current++}`;
    setNotifications((prev) => [...prev, { id, message, type }]);
  };

  const removeNotification = (id) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
  };

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      <div className="fixed top-4 right-4 flex flex-col items-end space-y-2 z-[1000]"> {/* Added zIndex */}
        {notifications.map((notif) => (
          <NotificationToast
            key={notif.id}
            message={notif.message}
            type={notif.type}
            onClose={() => removeNotification(notif.id)}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  return useContext(NotificationContext);
};
