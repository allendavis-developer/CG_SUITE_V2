import React, { useState } from "react";
import NavButton from "../components/NavButton";
import Welcome from "./Welcome";
import PageList from "./PageList";

export default function Home() {
  const [currentPage, setCurrentPage] = useState(null);

  return (
    <div className="flex flex-col justify-center items-center h-screen">
      <h1 className="text-4xl mb-8">App Navigator</h1>
      
      <div className="flex">
        <NavButton label="Welcome" onClick={() => setCurrentPage("welcome")} />
        <NavButton label="Pages" onClick={() => setCurrentPage("pages")} />
      </div>

      <div className="mt-8">
        {currentPage === "welcome" && <Welcome />}
        {currentPage === "pages" && <PageList />}
      </div>
    </div>
  );
}
