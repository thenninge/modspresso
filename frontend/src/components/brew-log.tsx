'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { useLocalStorage } from '@/hooks/use-local-storage';
import type { BrewLogEntry } from '@/types';

interface BrewLogDraft {
  id?: string;
  date: string;
  beanType: string;
  grindSize: string;
  nextGrindSize: string;
  gramsIn: string;
  gramsOut: string;
  brewTimeSeconds: string;
  grade: string;
  notes: string;
}

const createEmptyDraft = (): BrewLogDraft => ({
  date: '',
  beanType: '',
  grindSize: '',
  nextGrindSize: '',
  gramsIn: '18',
  gramsOut: '28',
  brewTimeSeconds: '',
  grade: '',
  notes: ''
});

const toNumberOrNull = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const BrewLog: React.FC = () => {
  const [entries, setEntries] = useLocalStorage<BrewLogEntry[]>('modspresso-brew-log', []);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [draft, setDraft] = useState<BrewLogDraft>(createEmptyDraft());

  const [sortKey, setSortKey] = useState<keyof BrewLogEntry>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedEntries = useMemo(() => {
    const getComparable = (entry: BrewLogEntry) => {
      switch (sortKey) {
        case 'date':
          return entry.date ? new Date(entry.date).getTime() : 0;
        case 'gramsIn':
          return entry.gramsIn ?? Number.NEGATIVE_INFINITY;
        case 'gramsOut':
          return entry.gramsOut ?? Number.NEGATIVE_INFINITY;
        case 'brewTimeSeconds':
          return entry.brewTimeSeconds ?? Number.NEGATIVE_INFINITY;
        case 'grade':
          return entry.grade ?? Number.NEGATIVE_INFINITY;
        case 'beanType':
        case 'grindSize':
        case 'nextGrindSize':
        case 'notes':
          return (entry[sortKey] || '').toLowerCase();
        case 'createdAt':
        case 'updatedAt':
          return entry[sortKey] || '';
        case 'id':
        default:
          return entry[sortKey] ?? '';
      }
    };

    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...entries].sort((a, b) => {
      const valueA = getComparable(a);
      const valueB = getComparable(b);
      if (valueA < valueB) return -1 * direction;
      if (valueA > valueB) return 1 * direction;
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
  }, [entries, sortKey, sortDirection]);

  const handleSort = (key: keyof BrewLogEntry) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection(key === 'date' ? 'desc' : 'asc');
    }
  };

  const openNewEntry = () => {
    setDraft(createEmptyDraft());
    setIsEditorOpen(true);
  };

  const openEditEntry = (entry: BrewLogEntry) => {
    setDraft({
      id: entry.id,
      date: entry.date || '',
      beanType: entry.beanType || '',
      grindSize: entry.grindSize || '',
      nextGrindSize: entry.nextGrindSize || '',
      gramsIn: entry.gramsIn != null ? String(entry.gramsIn) : '',
      gramsOut: entry.gramsOut != null ? String(entry.gramsOut) : '',
      brewTimeSeconds: entry.brewTimeSeconds != null ? String(entry.brewTimeSeconds) : '',
      grade: entry.grade != null ? String(entry.grade) : '',
      notes: entry.notes || ''
    });
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setDraft(createEmptyDraft());
  };

  const handleSave = () => {
    if (!draft.date.trim()) {
      alert('Date is required');
      return;
    }

    const now = new Date().toISOString();
    const entry: BrewLogEntry = {
      id: draft.id || `brew-${Date.now()}`,
      date: draft.date,
      beanType: draft.beanType.trim(),
      grindSize: draft.grindSize.trim(),
      nextGrindSize: draft.nextGrindSize.trim(),
      gramsIn: toNumberOrNull(draft.gramsIn),
      gramsOut: toNumberOrNull(draft.gramsOut),
      brewTimeSeconds: toNumberOrNull(draft.brewTimeSeconds),
      grade: toNumberOrNull(draft.grade),
      notes: draft.notes.trim(),
      createdAt: draft.id
        ? entries.find(existing => existing.id === draft.id)?.createdAt || now
        : now,
      updatedAt: draft.id ? now : undefined
    };

    if (draft.id) {
      setEntries(entries.map(existing => existing.id === draft.id ? entry : existing));
    } else {
      setEntries([entry, ...entries]);
    }

    closeEditor();
  };

  const handleDelete = (entryId: string) => {
    if (confirm('Are you sure you want to delete this log entry?')) {
      setEntries(entries.filter(entry => entry.id !== entryId));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Brew Log</h2>
          <p className="text-sm text-gray-600">
            Track how it went and what to adjust next time.
          </p>
        </div>
        <button
          onClick={openNewEntry}
          className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
        >
          <Plus size={16} className="mr-2" />
          New Log
        </button>
      </div>

      {isEditorOpen && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">
              {draft.id ? 'Edit Log' : 'New Log'}
            </h3>
            <button onClick={closeEditor} className="p-2 text-gray-500 hover:text-gray-700">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date *
              </label>
              <input
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Beans
              </label>
              <input
                type="text"
                value={draft.beanType}
                onChange={(event) => setDraft({ ...draft, beanType: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="e.g. Ethiopia Natural"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grind
              </label>
              <input
                type="text"
                value={draft.grindSize}
                onChange={(event) => setDraft({ ...draft, grindSize: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="e.g. 12"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Next
              </label>
              <input
                type="text"
                value={draft.nextGrindSize}
                onChange={(event) => setDraft({ ...draft, nextGrindSize: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="e.g. 11.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                In
              </label>
              <input
                type="number"
                value={draft.gramsIn}
                onChange={(event) => setDraft({ ...draft, gramsIn: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                min="0"
                step="0.1"
                placeholder="18.0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Out
              </label>
              <input
                type="number"
                value={draft.gramsOut}
                onChange={(event) => setDraft({ ...draft, gramsOut: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                min="0"
                step="0.1"
                placeholder="28.0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Time
              </label>
              <input
                type="number"
                value={draft.brewTimeSeconds}
                onChange={(event) => setDraft({ ...draft, brewTimeSeconds: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                min="0"
                step="0.1"
                placeholder="28.0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grade
              </label>
              <select
                value={draft.grade}
                onChange={(event) => setDraft({ ...draft, grade: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              >
                <option value="">-</option>
                {['1', '2', '3', '4', '5', '6'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              rows={4}
              placeholder="Taste, flow, what to adjust next time, etc."
            />
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              onClick={closeEditor}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              <Save size={16} className="mr-2" />
              Save Log
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {sortedEntries.length === 0 ? (
          <div className="p-6 text-center text-gray-600">
            No brew logs yet. Click &quot;New Log&quot; to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('date')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Date
                      {sortKey === 'date' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('beanType')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Beans
                      {sortKey === 'beanType' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('grindSize')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Grind
                      {sortKey === 'grindSize' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('nextGrindSize')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Next
                      {sortKey === 'nextGrindSize' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('gramsIn')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      In
                      {sortKey === 'gramsIn' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('gramsOut')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Out
                      {sortKey === 'gramsOut' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('brewTimeSeconds')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Time
                      {sortKey === 'brewTimeSeconds' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('grade')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Grade
                      {sortKey === 'grade' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('notes')}
                      className="inline-flex items-center text-gray-500 hover:text-gray-700"
                    >
                      Notes
                      {sortKey === 'notes' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                      {entry.date || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {entry.beanType || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {entry.grindSize || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {entry.nextGrindSize || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                      {entry.gramsIn != null ? `${entry.gramsIn} g` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                      {entry.gramsOut != null ? `${entry.gramsOut} g` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                      {entry.brewTimeSeconds != null ? `${entry.brewTimeSeconds} s` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                      {entry.grade != null ? entry.grade : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                      {entry.notes || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEditEntry(entry)}
                        className="inline-flex items-center px-2 py-1 text-blue-600 hover:text-blue-800"
                      >
                        <Pencil size={14} className="mr-1" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="inline-flex items-center px-2 py-1 text-red-600 hover:text-red-800"
                      >
                        <Trash2 size={14} className="mr-1" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrewLog;
