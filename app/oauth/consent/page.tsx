import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';
import SquigglyLogo from '@/components/SquigglyLogo';

export const dynamic = 'force-dynamic';

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: { authorization_id?: string };
}) {
  if (isLocalAuthMode()) notFound();

  const id = searchParams.authorization_id;
  if (!id) notFound();

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

  if (error || !data) {
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

  const clientName = data.client.client_name;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-neuro-light to-white">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="flex justify-center mb-4">
            <SquigglyLogo height={52} />
          </h1>
        </div>

        <div className="bg-white shadow-lg rounded-lg p-8 space-y-6">
          <p className="text-gray-800">
            <strong>{clientName}</strong> wants read-only access to analyses in
            projects you can access in Squiggly. It will see EEG measurements
            only: no client details, project names or file names.
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
