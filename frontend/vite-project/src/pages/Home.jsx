import React, { useState } from "react";
import { Button } from "../components/ui/button";

import Welcome from "./Welcome";
import PageList from "./PageList";

export default function Home() {
  const [currentPage, setCurrentPage] = useState(null);

  return (
    <div className="space-x-4 mt-4">
      <Button variant="default" onClick={() => setCurrentPage("welcome")}>
        Welcome
      </Button>
      <Button variant="default" onClick={() => setCurrentPage("pages")}>
        Pages
      </Button>

      <div className="mt-8">
        {currentPage === "welcome" && <Welcome />}
        {currentPage === "pages" && <PageList />}
      </div>
    </div>
  );
}

