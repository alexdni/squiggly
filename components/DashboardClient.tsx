'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

interface DashboardClientProps {
  user: User;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  owner_id: string;
}

export default function DashboardClient({ user }: DashboardClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
              <div className="text-sm text-gray-800">
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
        {/* Hero Section */}
        <div className="mb-8 bg-white rounded-lg shadow-md p-8">
          <h2 className="text-3xl font-bold text-neuro-dark mb-4">
            Welcome to Squiggly
          </h2>
          <p className="text-gray-800 text-lg mb-6">
            An open-source EEG assessment platform for analyzing 19-channel EEG recordings
          </p>

          {/* How it works */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-neuro-light rounded-lg">
              <div className="text-3xl mb-2">📁</div>
              <h3 className="font-semibold text-neuro-dark mb-1">1. Create Project</h3>
              <p className="text-sm text-gray-700">Organize your EEG recordings</p>
            </div>
            <div className="text-center p-4 bg-neuro-light rounded-lg">
              <div className="text-3xl mb-2">⬆️</div>
              <h3 className="font-semibold text-neuro-dark mb-1">2. Upload EDF</h3>
              <p className="text-sm text-gray-700">19-channel EEG files</p>
            </div>
            <div className="text-center p-4 bg-neuro-light rounded-lg">
              <div className="text-3xl mb-2">🧠</div>
              <h3 className="font-semibold text-neuro-dark mb-1">3. Analyze</h3>
              <p className="text-sm text-gray-700">Automated signal processing</p>
            </div>
            <div className="text-center p-4 bg-neuro-light rounded-lg">
              <div className="text-3xl mb-2">📊</div>
              <h3 className="font-semibold text-neuro-dark mb-1">4. Review</h3>
              <p className="text-sm text-gray-700">Interactive visualizations</p>
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 border border-gray-200 rounded-lg">
              <h4 className="font-semibold text-neuro-dark mb-1">Band Power Analysis</h4>
              <p className="text-sm text-gray-700">Delta, theta, alpha, beta, gamma bands</p>
            </div>
            <div className="p-3 border border-gray-200 rounded-lg">
              <h4 className="font-semibold text-neuro-dark mb-1">Coherence & Connectivity</h4>
              <p className="text-sm text-gray-700">Inter-hemispheric coherence analysis</p>
            </div>
            <div className="p-3 border border-gray-200 rounded-lg">
              <h4 className="font-semibold text-neuro-dark mb-1">Asymmetry & Ratios</h4>
              <p className="text-sm text-gray-700">Hemispheric asymmetry indices</p>
            </div>
          </div>
        </div>

        {/* Projects Section */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-2xl font-bold text-neuro-dark">Your Projects</h3>
              <p className="text-gray-800 mt-1">
                {projects.length === 0
                  ? 'Create your first project to get started'
                  : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <button
              onClick={() => router.push('/projects')}
              className="bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium"
            >
              + New Project
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-neuro-primary"></div>
              <p className="mt-4 text-gray-800">Loading projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow-md">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                No projects yet
              </h3>
              <p className="mt-2 text-gray-800">
                Create your first project to start analyzing EEG recordings
              </p>
              <button
                onClick={() => router.push('/projects')}
                className="mt-6 bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium"
              >
                Create Your First Project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-neuro-primary"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <h3 className="text-xl font-semibold text-neuro-dark mb-2">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-gray-800 text-sm mb-4">
                      {project.description}
                    </p>
                  )}
                  <div className="flex justify-between items-center">
                    <div className="text-xs text-gray-700">
                      Created {new Date(project.created_at).toLocaleDateString()}
                    </div>
                    <button className="text-neuro-primary hover:text-neuro-accent text-sm font-medium">
                      Open →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Disclaimer */}
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
                This EEG assessment platform is for educational and research use only. It is NOT for medical use
                and should NOT be used for clinical decision-making. All heuristic flags are
                based on within-subject analysis without normative comparison.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
