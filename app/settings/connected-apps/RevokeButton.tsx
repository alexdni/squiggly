'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function RevokeButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oauth/grants?client_id=${encodeURIComponent(clientId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        setError('Could not revoke access');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not revoke access');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="text-right">
      <button
        onClick={revoke}
        disabled={isLoading}
        className="bg-white border-2 border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Revoking...' : 'Revoke'}
      </button>
      {error && <p className="text-sm text-red-700 mt-1">{error}</p>}
    </div>
  );
}
