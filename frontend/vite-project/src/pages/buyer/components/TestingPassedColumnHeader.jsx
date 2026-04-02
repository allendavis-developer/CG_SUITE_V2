import React from 'react';

/** Shared `<th>` for negotiation + jewellery spreadsheet tables (inherits `.spreadsheet-table th` styles). */
export default function TestingPassedColumnHeader() {
  return (
    <th scope="col" className="w-28 min-w-[6rem] text-center align-middle">
      <span className="block leading-snug">Testing passed</span>
    </th>
  );
}
