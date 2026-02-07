import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // make sure Tailwind CSS is imported
import { NotificationProvider } from './contexts/NotificationContext.jsx'; // Import NotificationProvider

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NotificationProvider> {/* Wrap App with NotificationProvider */}
      <App />
    </NotificationProvider>
  </React.StrictMode>
);
