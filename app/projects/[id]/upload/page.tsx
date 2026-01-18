'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import FileUploadZone from '@/components/upload/FileUploadZone';
import EOECLabelingForm from '@/components/upload/EOECLabelingForm';

interface UploadState {
  file: File | null;
  uploading: boolean;
  progress: number;
  error: string | null;
  step: 'select' | 'label' | 'upload' | 'complete';
  recordingId: string | null;
}

interface EOECLabels {
  eoLabel?: string;
  ecLabel?: string;
  eoStart?: number;
  eoEnd?: number;
  ecStart?: number;
  ecEnd?: number;
  useManual: boolean;
}

export default function UploadPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [state, setState] = useState<UploadState>({
    file: null,
    uploading: false,
    progress: 0,
    error: null,
    step: 'select',
    recordingId: null,
  });

  const [labels, setLabels] = useState<EOECLabels>({
    useManual: false,
  });

  const handleFileSelected = (file: File) => {
    setState({
      ...state,
      file,
      step: 'label',
      error: null,
    });
  };

  const handleUpload = async () => {
    if (!state.file) return;

    setState({ ...state, uploading: true, progress: 0, error: null, step: 'upload' });

    try {
      // Step 1: Get signed upload URL
      setState((s) => ({ ...s, progress: 10 }));
      const initResponse = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          filename: state.file.name,
          fileSize: state.file.size,
        }),
      });

      if (!initResponse.ok) {
        const error = await initResponse.json();
        throw new Error(error.error || 'Failed to initialize upload');
      }

      const { uploadUrl, filePath } = await initResponse.json();

      // Step 2: Upload file to Supabase Storage
      setState((s) => ({ ...s, progress: 30 }));
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: state.file,
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }

      // Step 3: Create recording and validate
      setState((s) => ({ ...s, progress: 60 }));
      const recordingResponse = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          filename: state.file.name,
          filePath,
          fileSize: state.file.size,
          ...labels,
        }),
      });

      if (!recordingResponse.ok) {
        const error = await recordingResponse.json();
        throw new Error(error.message || error.error || 'Failed to create recording');
      }

      const { recording, analysis } = await recordingResponse.json();

      setState({
        ...state,
        uploading: false,
        progress: 100,
        step: 'complete',
        recordingId: recording.id,
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      setState({
        ...state,
        uploading: false,
        error: error.message,
        step: 'label',
      });
    }
  };

  return (
    <main className="min-h-screen bg-neuro-light">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-neuro-primary hover:text-neuro-accent mb-4 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Project
          </button>
          <h1 className="text-3xl font-bold text-neuro-dark">Upload EEG Recording</h1>
          <p className="text-gray-800 mt-2">
            Upload a 19-channel EDF file for EO/EC analysis
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 space-y-8">
          {/* Step indicator */}
          <div className="flex items-center justify-between">
            {['Select File', 'Label Segments', 'Upload', 'Complete'].map((stepName, idx) => {
              const stepKeys = ['select', 'label', 'upload', 'complete'];
              const currentIdx = stepKeys.indexOf(state.step);
              const isActive = idx === currentIdx;
              const isComplete = idx < currentIdx;

              return (
                <div key={stepName} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                        isComplete
                          ? 'bg-green-500 text-white'
                          : isActive
                          ? 'bg-neuro-primary text-white'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {isComplete ? '✓' : idx + 1}
                    </div>
                    <span className="text-xs mt-2 text-center">{stepName}</span>
                  </div>
                  {idx < 3 && (
                    <div className={`flex-1 h-1 mx-2 ${isComplete ? 'bg-green-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Content */}
          {state.step === 'select' && (
            <FileUploadZone
              projectId={projectId}
              onFileSelected={handleFileSelected}
            />
          )}

          {state.step === 'label' && state.file && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-neuro-dark">{state.file.name}</p>
                    <p className="text-sm text-gray-800">
                      {(state.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={() => setState({ ...state, step: 'select', file: null })}
                    className="text-sm text-neuro-primary hover:text-neuro-accent"
                  >
                    Change File
                  </button>
                </div>
              </div>

              <EOECLabelingForm
                onLabelsChange={setLabels}
                recordingDuration={undefined}
              />

              <div className="flex gap-4">
                <button
                  onClick={() => setState({ ...state, step: 'select' })}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-neuro-primary transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleUpload}
                  disabled={state.uploading}
                  className="flex-1 px-6 py-3 bg-neuro-primary text-white rounded-lg hover:bg-neuro-accent transition-colors disabled:opacity-50"
                >
                  Upload and Validate
                </button>
              </div>
            </div>
          )}

          {state.step === 'upload' && (
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-neuro-primary mx-auto"></div>
              <p className="text-lg font-medium text-neuro-dark">Uploading and validating...</p>
              <div className="max-w-md mx-auto">
                <div className="bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-neuro-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${state.progress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-800 mt-2">{state.progress}%</p>
              </div>
            </div>
          )}

          {state.step === 'complete' && (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-12 h-12 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-neuro-dark">Upload Successful!</h2>
                <p className="text-gray-800 mt-2">
                  Your EEG recording has been uploaded and validated. Analysis is now queued.
                </p>
              </div>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => router.push(`/projects/${projectId}`)}
                  className="px-6 py-3 bg-neuro-primary text-white rounded-lg hover:bg-neuro-accent transition-colors"
                >
                  Back to Project
                </button>
                {state.recordingId && (
                  <button
                    onClick={() => setState({
                      file: null,
                      uploading: false,
                      progress: 0,
                      error: null,
                      step: 'select',
                      recordingId: null,
                    })}
                    className="px-6 py-3 border-2 border-neuro-primary text-neuro-primary rounded-lg hover:bg-neuro-light transition-colors"
                  >
                    Upload Another
                  </button>
                )}
              </div>
            </div>
          )}

          {state.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-medium">Upload Failed</p>
                  <p className="text-sm mt-1">{state.error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
