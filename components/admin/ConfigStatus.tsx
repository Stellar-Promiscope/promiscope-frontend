import React, { useEffect, useState } from 'react';

type ConfigEntry = {
  name: string;
  required: boolean;
  present: boolean;
};

export default function ConfigStatus() {
  const [config, setConfig] = useState<ConfigEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    fetch('/api/admin/config-status')
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          setUnauthorized(true);
          return [];
        }
        return res.json();
      })
      .then((data) => {
        setConfig(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setConfig([]);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-400">Loading config status…</p>;
  }

  if (unauthorized) {
    return (
      <p className="text-sm text-gray-400">
        Admin session required to view config status.
      </p>
    );
  }

  return (
    <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-white">
        Runtime Configuration Status
      </h2>
      <table className="w-full table-auto text-sm">
        <thead className="text-left text-gray-400">
          <tr>
            <th className="pr-4">Variable</th>
            <th className="pr-4">Required</th>
            <th className="pr-4">Present</th>
          </tr>
        </thead>
        <tbody>
          {config &&
            config.map((c) => (
              <tr key={c.name} className="border-t border-gray-700">
                <td className="py-2 text-gray-300">{c.name}</td>
                <td className="py-2 text-gray-300">
                  {c.required ? 'Yes' : 'No'}
                </td>
                <td className="py-2">
                  {c.present ? (
                    <span className="text-green-400 font-medium">Present</span>
                  ) : (
                    <span className="text-red-400 font-medium">Missing</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
