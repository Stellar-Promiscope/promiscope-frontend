'use client';

import { useState } from 'react';
import { fetchScoutContacts } from '@/lib/api';
import { buildScoutContactsCsv } from '@/lib/scoutContactsCsv';
import { useToast } from '@/components/ui/Toast';

/**
 * Issue #555: exports the scout's contacted players as a CSV generated
 * entirely client-side — no dedicated export endpoint.
 */
export default function ExportContactsCsvButton({
  scoutId,
}: {
  scoutId: string;
}) {
  const [exporting, setExporting] = useState(false);
  const { show } = useToast();

  const handleExport = async () => {
    setExporting(true);
    try {
      const contacts = await fetchScoutContacts(scoutId);
      const csv = buildScoutContactsCsv(
        Array.isArray(contacts) ? contacts : [],
      );
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacted-players-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      show({ message: 'Could not export contacts.', variant: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={exporting}
      className="px-4 py-1.5 rounded-lg border border-brand-green text-sm text-brand-green disabled:opacity-40 hover:bg-brand-green hover:text-black transition"
    >
      {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
  );
}
