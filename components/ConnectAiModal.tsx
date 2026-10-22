'use client';

import { useState } from 'react';

// How to connect Claude or ChatGPT to Squiggly's MCP server (/api/mcp). Shown from the analysis
// page; the connector signs in through Squiggly's OAuth consent page and is read-only.

type Assistant = 'claude' | 'chatgpt';

interface ConnectAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** link to the analysis the user is viewing, offered as a ready-made prompt */
  analysisUrl: string;
}

const STEPS: Record<Assistant, { title: string; steps: string[]; use: string }> = {
  claude: {
    title: 'Claude (claude.ai or the desktop app)',
    steps: [
      'Open Settings → Connectors and choose "Add custom connector".',
      'Name it "Squiggly" and paste the server URL below, then click Add.',
      'Click Connect. You will be sent to Squiggly — sign in if asked, then click Approve.',
    ],
    use: 'In a new chat, make sure Squiggly is switched on in the tools menu, then ask away.',
  },
  chatgpt: {
    title: 'ChatGPT',
    steps: [
      'Open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.',
      'Back in Apps & Connectors, choose Create. Name it "Squiggly", paste the server URL below and pick OAuth for authentication.',
      'Create it, then sign in to Squiggly when prompted and click Approve.',
    ],
    use: 'In a new chat, pick Squiggly from the "+" menu (Developer mode), then ask away.',
  },
};

export default function ConnectAiModal({ isOpen, onClose, analysisUrl }: ConnectAiModalProps) {
  const [assistant, setAssistant] = useState<Assistant>('claude');
  const [copied, setCopied] = useState<string | null>(null);

  if (!isOpen) return null;

  const serverUrl = `${window.location.origin}/api/mcp`;
  const prompts = [
    `Walk me through this Squiggly analysis and what it suggests clinically: ${analysisUrl}`,
    'Compare my two most recent sessions in Squiggly — what changed, and is it real or data quality?',
    'Show the frontal theta/beta trend across my last 8 Squiggly sessions.',
  ];
  const guide = STEPS[assistant];

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch {
      // clipboard blocked; the text stays selectable
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-ai-title"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 id="connect-ai-title" className="text-2xl font-bold text-neuro-dark">
              Ask Claude or ChatGPT about your analyses
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-800 transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-gray-700 mt-2 text-sm">
            Connect your own assistant to Squiggly once, then ask it to walk through any analysis,
            compare sessions or show trends.
          </p>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div>
            <h3 className="font-semibold text-neuro-dark mb-2">Server URL</h3>
            <div className="flex gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 break-all">
                {serverUrl}
              </code>
              <button
                onClick={() => copy(serverUrl)}
                className="px-3 py-2 rounded-lg border border-neuro-primary text-neuro-primary hover:bg-neuro-light text-sm font-medium"
              >
                {copied === serverUrl ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div>
            <div className="flex gap-2 mb-3" role="tablist">
              {(['claude', 'chatgpt'] as const).map((a) => (
                <button
                  key={a}
                  role="tab"
                  aria-selected={assistant === a}
                  onClick={() => setAssistant(a)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    assistant === a
                      ? 'bg-neuro-primary text-white'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  {a === 'claude' ? 'Claude' : 'ChatGPT'}
                </button>
              ))}
            </div>
            <h3 className="font-semibold text-neuro-dark mb-2">{guide.title}</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-800">
              {guide.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-sm text-gray-800 mt-2">{guide.use}</p>
            <p className="text-xs text-gray-600 mt-2">
              Menu names can differ by plan and change over time; custom connectors may need a paid
              plan.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-neuro-dark mb-2">Things to ask</h3>
            <ul className="space-y-2">
              {prompts.map((p) => (
                <li key={p} className="flex gap-2 items-start">
                  <span className="flex-1 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded px-3 py-2 break-words">
                    {p}
                  </span>
                  <button
                    onClick={() => copy(p)}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-100 text-sm"
                  >
                    {copied === p ? 'Copied' : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-neuro-light border border-gray-200 rounded-lg p-4 text-sm text-gray-800 space-y-1">
            <p>
              <strong>What it can see:</strong> read-only EEG measurements from projects you can
              access — no client details, project names or file names. It cannot change anything.
            </p>
            <p>
              Answers come from your assistant, not Squiggly, and are pattern-level interpretation —
              not a diagnosis.
            </p>
            <p>
              Revoke access anytime under{' '}
              <a href="/settings/connected-apps" className="text-neuro-primary underline">
                Connected apps
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
