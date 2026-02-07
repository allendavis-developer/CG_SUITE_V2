import React, { createContext, useContext, useState } from 'react';
import NotificationToast from '@/components/ui/NotificationToast';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const showNotification = (message, type = 'info') => {
    const id = Date.now();
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
