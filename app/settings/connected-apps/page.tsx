import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';
import { listGrants } from '@/lib/server/oauth-grants';
import SquigglyLogo from '@/components/SquigglyLogo';
import RevokeButton from './RevokeButton';

export const dynamic = 'force-dynamic';

export default async function ConnectedAppsPage() {
  if (isLocalAuthMode()) notFound();

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login?redirect=' + encodeURIComponent('/settings/connected-apps'));
  }

  const supabase = await createClient();
  const { data: grants, error } = await listGrants(supabase);

  return (
    <main className="min-h-screen bg-neuro-light">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <SquigglyLogo />
          <Link href="/dashboard" className="text-sm text-neuro-primary hover:underline">
            Back to dashboard
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white shadow-lg rounded-lg p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-neuro-dark">Connected apps</h1>
            <p className="mt-2 text-gray-700">
              Apps you have authorized to read EEG analysis results in Squiggly.
              Revoking removes their access.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              Could not load connected apps.
            </div>
          )}

          {grants && grants.length === 0 && (
            <p className="text-gray-700">No apps are connected.</p>
          )}

          {grants && grants.length > 0 && (
            <ul className="divide-y divide-gray-200">
              {grants.map((g) => (
                <li
                  key={g.client.client_id}
                  className="py-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-medium text-gray-900">{g.client.client_name}</p>
                    <p className="text-sm text-gray-600">
                      Approved{' '}
                      {new Date(g.granted_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                  <RevokeButton clientId={g.client.client_id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
