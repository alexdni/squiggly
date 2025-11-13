'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import type { User } from '@supabase/supabase-js';

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  owner_id: string;
}

interface Recording {
  id: string;
  filename: string;
  file_size: number;
  duration_seconds: number | null;
  created_at: string;
  eo_start: number | null;
  eo_end: number | null;
  ec_start: number | null;
  ec_end: number | null;
}

interface ProjectDetailsClientProps {
  project: Project;
  user: User;
}

export default function ProjectDetailsClient({
  project,
  user,
}: ProjectDetailsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecordings(data || []);
    } catch (error) {
      console.error('Error fetching recordings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleViewAnalysis = async (recordingId: string) => {
    try {
      // First, check if an analysis already exists for this recording
      const { data: existingAnalysis, error: fetchError } = await supabase
        .from('analyses')
        .select('id')
        .eq('recording_id', recordingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingAnalysis) {
        // Navigate to existing analysis
        router.push(`/analyses/${existingAnalysis.id}`);
        return;
      }

      // If no analysis exists, create one
      const { data: newAnalysis, error: createError } = await supabase
        .from('analyses')
        .insert({
          recording_id: recordingId,
          status: 'pending',
          config: {
            preprocessing: {
              resample_freq: 250,
              filter_low: 0.5,
              filter_high: 45,
              notch_freq: 60,
            },
            features: {
              bands: [
                { name: 'delta', low: 1, high: 4 },
                { name: 'theta', low: 4, high: 8 },
                { name: 'alpha1', low: 8, high: 10 },
                { name: 'alpha2', low: 10, high: 12 },
                { name: 'smr', low: 12, high: 15 },
                { name: 'beta2', low: 15, high: 20 },
                { name: 'hibeta', low: 20, high: 30 },
                { name: 'lowgamma', low: 30, high: 45 },
              ],
            },
          },
        })
        .select()
        .single();

      if (createError) throw createError;

      // Navigate to newly created analysis
      router.push(`/analyses/${(newAnalysis as any).id}`);
    } catch (error) {
      console.error('Error handling analysis:', error);
      alert('Failed to load or create analysis. Please try again.');
    }
  };

  return (
    <main className="min-h-screen bg-neuro-light">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-2xl font-bold text-neuro-primary hover:text-neuro-accent transition-colors"
              >
                Squiggly
              </button>
              <span className="text-gray-400">/</span>
              <button
                onClick={() => router.push('/projects')}
                className="text-gray-600 hover:text-neuro-primary transition-colors"
              >
                Projects
              </button>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">{user.email}</div>
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

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Project Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-neuro-dark mb-2">
                {project.name}
              </h1>
              {project.description && (
                <p className="text-gray-600">{project.description}</p>
              )}
              <p className="text-sm text-gray-500 mt-2">
                Created {new Date(project.created_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => router.push(`/projects/${project.id}/upload`)}
              className="bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium"
            >
              + Upload Recording
            </button>
          </div>
        </div>

        {/* Recordings Section */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-neuro-dark mb-4">
            Recordings ({recordings.length})
          </h2>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-neuro-primary"></div>
              <p className="mt-4 text-gray-600">Loading recordings...</p>
            </div>
          ) : recordings.length === 0 ? (
            <div className="text-center py-12">
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
                  d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                No recordings yet
              </h3>
              <p className="mt-2 text-gray-600">
                Upload your first EEG recording to get started
              </p>
              <button
                onClick={() => router.push(`/projects/${project.id}/upload`)}
                className="mt-6 bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium"
              >
                Upload Recording
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Filename
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      EO/EC Labels
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Uploaded
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recordings.map((recording) => (
                    <tr key={recording.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {recording.filename}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {formatFileSize(recording.file_size)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {formatDuration(recording.duration_seconds)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {recording.eo_start !== null &&
                          recording.ec_start !== null ? (
                            <span className="text-green-600">✓ Labeled</span>
                          ) : (
                            <span className="text-yellow-600">
                              ⚠ Not labeled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {new Date(recording.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          className="text-neuro-primary hover:text-neuro-accent font-medium"
                          onClick={() => handleViewAnalysis(recording.id)}
                        >
                          View Analysis
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
    </main>
  );
}
