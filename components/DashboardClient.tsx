'use client';

import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

interface DashboardClientProps {
  user: User;
}

export default function DashboardClient({ user }: DashboardClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <main className="min-h-screen bg-neuro-light">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-neuro-primary">
                Squiggly
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                {user.email}
              </div>
              <button
                onClick={handleSignOut}
                className="bg-neuro-primary text-white px-4 py-2 rounded-lg hover:bg-neuro-accent transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-neuro-dark mb-2">
            Dashboard
          </h2>
          <p className="text-gray-600">
            Welcome to your EEG analysis workspace
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-neuro-dark">
                Projects
              </h3>
              <div className="bg-neuro-primary text-white rounded-full w-10 h-10 flex items-center justify-center">
                0
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              Create and manage your EEG analysis projects
            </p>
            <button className="mt-4 w-full bg-neuro-primary text-white px-4 py-2 rounded-lg hover:bg-neuro-accent transition-colors">
              Create Project
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-neuro-dark">
                Recordings
              </h3>
              <div className="bg-neuro-secondary text-white rounded-full w-10 h-10 flex items-center justify-center">
                0
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              Upload and analyze EEG recordings (19-channel EDF)
            </p>
            <button
              className="mt-4 w-full bg-gray-300 text-gray-500 px-4 py-2 rounded-lg cursor-not-allowed"
              disabled
            >
              Upload Recording
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-neuro-dark">
                Analyses
              </h3>
              <div className="bg-neuro-accent text-white rounded-full w-10 h-10 flex items-center justify-center">
                0
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              View completed EO/EC analysis results
            </p>
            <button
              className="mt-4 w-full bg-gray-300 text-gray-500 px-4 py-2 rounded-lg cursor-not-allowed"
              disabled
            >
              View Analyses
            </button>
          </div>
        </div>

        <div className="mt-8 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong className="font-medium">Important Disclaimer:</strong>{' '}
                This platform is for educational and research use only. It is NOT a diagnostic tool
                and should NOT be used for clinical decision-making. All heuristic risk flags are
                based on within-subject analysis without normative comparison.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
