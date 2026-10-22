import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';
import { parseAuthorizationId } from '@/lib/server/oauth-consent';
import SquigglyLogo from '@/components/SquigglyLogo';

export const dynamic = 'force-dynamic';

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-neuro-light to-white">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 space-y-4 text-center">
        <h1 className="text-xl font-semibold text-neuro-dark">
          Authorization request unavailable
        </h1>
        <p className="text-gray-700">
          This request is invalid or has expired. Return to the app and try
          connecting again.
        </p>
      </div>
    </main>
  );
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: { authorization_id?: string | string[]; error?: string | string[] };
}) {
  if (isLocalAuthMode()) notFound();

  if (searchParams.authorization_id === undefined) notFound();
  const id = parseAuthorizationId(searchParams.authorization_id);
  if (!id) return <Unavailable />;
  const decisionFailed = searchParams.error === '1';

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      '/login?redirect=' +
        encodeURIComponent('/oauth/consent?authorization_id=' + id)
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);

  // Already consented: the response carries only a redirect_url
  const redirectUrl = (data as { redirect_url?: string } | null)?.redirect_url;
  if (data && !('authorization_id' in data) && redirectUrl) {
    redirect(redirectUrl);
  }

  if (error || !data || !('client' in data) || !data.client) return <Unavailable />;

  const clientName = data.client.client_name || 'An app';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-neuro-light to-white">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="flex justify-center mb-4">
            <SquigglyLogo height={52} />
          </h1>
        </div>

        <div className="bg-white shadow-lg rounded-lg p-8 space-y-6">
          {decisionFailed && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              Your decision could not be recorded. Try again, or return to the
              app and start connecting again.
            </div>
          )}
          <p className="text-gray-800">
            <strong>{clientName}</strong> is asking to connect to your Squiggly
            account. Squiggly&apos;s connector gives it read-only tools that
            return EEG measurements only: no client details, project names or
            file names. The access token it receives is tied to your account;
            revoke it anytime under{' '}
            <Link href="/settings/connected-apps" className="text-neuro-primary hover:underline">
              Connected apps
            </Link>
            .
          </p>

          <dl className="text-sm text-gray-700 space-y-1">
            <div className="flex gap-2">
              <dt className="font-medium">Application:</dt>
              <dd>{clientName}</dd>
            </div>
            {data.redirect_uri && (
              <div className="flex gap-2">
                <dt className="font-medium">Redirects to:</dt>
                <dd className="break-all">{data.redirect_uri}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-medium">Signed in as:</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>

          <form
            method="POST"
            action="/api/oauth/decision"
            className="flex gap-3"
          >
            <input type="hidden" name="authorization_id" value={id} />
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors"
            >
              Deny
            </button>
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 bg-neuro-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-neuro-dark transition-colors"
            >
              Approve
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
