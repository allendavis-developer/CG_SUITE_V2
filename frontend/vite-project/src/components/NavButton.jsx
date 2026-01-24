import React from "react";

export default function NavButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-6 py-3 m-2 bg-blue-500 text-white rounded hover:bg-blue-600"
    >
      {label}
    </button>
  );
}
