import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Header } from '@/components/ui/components'; // Assuming you have these components

const TransactionComplete = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col items-center justify-center p-4">
      <Header /> {/* Optionally include header if desired */}
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        <svg
          className="mx-auto h-16 w-16 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <h2 className="text-2xl font-bold text-gray-800 mt-4">Booking Complete!</h2>
        <p className="text-gray-600 mt-2">
          Your request has been successfully booked for testing.
        </p>
        <p className="text-gray-600 mt-1">
          You can view its status and details in the requests overview.
        </p>
        <Button
          variant="primary"
          className="mt-6 px-6 py-3 text-base"
          onClick={() => navigate('/requests-overview')}
        >
          View All Requests
        </Button>
        <Button
          variant="ghost"
          className="mt-4 px-6 py-3 text-base"
          onClick={() => navigate('/buyer')}
        >
          Start New Request
        </Button>
      </div>
    </div>
  );
};

export default TransactionComplete;
