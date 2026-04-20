import React, { useState } from 'react';

export default function UploadConditionModal({
  open = false,
  item = null,
  onClose = () => {},
  onSave = () => {},
}) {
  const [condition, setCondition] = useState(item?.uploadCondition || 'used');
  const [grade, setGrade] = useState(item?.uploadGrade || 'B');
  const [description, setDescription] = useState(item?.uploadConditionText || '');

  React.useEffect(() => {
    if (open && item) {
      setCondition(item.uploadCondition || 'used');
      setGrade(item.uploadGrade || 'B');
      setDescription(item.uploadConditionText || '');
    }
  }, [open, item]);

  const handleSave = () => {
    onSave({
      uploadCondition: condition,
      uploadGrade: condition === 'used' ? grade : undefined,
      uploadConditionText: description,
    });
    onClose();
  };

  if (!open || !item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Upload Condition</h2>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="form-group">
            <label htmlFor="condition" className="block text-sm font-medium text-slate-700 mb-2">
              Condition<span className="text-red-500">*</span>
            </label>
            <select
              id="condition"
              value={condition}
              onChange={(e) => {
                setCondition(e.target.value);
                if (e.target.value !== 'used' && grade) {
                  setGrade('B');
                }
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/50"
            >
              <option value="">Select...</option>
              <option value="new">Brand New</option>
              <option value="other">New Other</option>
              <option value="refurbished">Refurbished</option>
              <option value="used">Pre-Owned</option>
            </select>
          </div>

          {condition === 'used' && (
            <div className="form-group">
              <label htmlFor="grade" className="block text-sm font-medium text-slate-700 mb-2">
                Grade<span className="text-red-500">*</span>
              </label>
              <select
                id="grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/50"
              >
                <option value="">Select...</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="F">F</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="conditionText" className="block text-sm font-medium text-slate-700 mb-2">
              Condition Description
            </label>
            <textarea
              id="conditionText"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder="Optional description of item condition"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/50 resize-none"
              rows={4}
            />
            <div className="text-xs text-slate-500 mt-1">{description.length}/500 characters</div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-blue hover:bg-brand-blue-hover transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
