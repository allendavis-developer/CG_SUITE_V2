import React, { useMemo, useState } from 'react';
import TinyModal from '@/components/ui/TinyModal';

/**
 * Pick a row from GET /cash-generator/retail-categories/ (flat list + search).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {Array<{ cgCategoryId: number, categoryName: string, categoryPath: string }>} props.rows
 * @param {number|null} props.currentCgCategoryId
 * @param {(row: object) => void} props.onSelect
 * @param {() => void} props.onClose
 */
export default function CgCategoryPickerModal({ open, rows, currentCgCategoryId, onSelect, onClose }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (r) =>
        String(r.categoryPath || '').toLowerCase().includes(s) ||
        String(r.categoryName || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  if (!open) return null;

  return (
    <TinyModal title="Webepos category" onClose={onClose} panelClassName="max-w-lg">
      <div className="mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search path or name…"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="max-h-[50vh] overflow-y-auto border border-slate-200 rounded">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No categories match. Update categories in Upload → View categories first.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const id = r.cgCategoryId ?? r.cg_category_id;
              const selected = currentCgCategoryId != null && Number(currentCgCategoryId) === Number(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      selected ? 'bg-brand-blue/10 font-semibold' : ''
                    }`}
                  >
                    <span className="text-slate-900">{r.categoryName}</span>
                    <span className="text-[11px] text-slate-500 break-words">{r.categoryPath}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </TinyModal>
  );
}
