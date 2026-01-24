import React from "react";

export default function PageList() {
  const pages = ["Dashboard", "Settings", "Profile"];

  return (
    <ul className="text-lg text-gray-700">
      {pages.map((page) => (
        <li key={page} className="mb-2">
          {page}
        </li>
      ))}
    </ul>
  );
}
