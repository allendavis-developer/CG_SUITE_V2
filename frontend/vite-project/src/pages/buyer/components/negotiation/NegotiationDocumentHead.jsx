import React from 'react';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';

export default function NegotiationDocumentHead() {
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{SPREADSHEET_TABLE_STYLES}</style>
    </>
  );
}
