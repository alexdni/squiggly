import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-b from-neuro-light to-white">
      <div className="z-10 max-w-5xl w-full items-center justify-center text-center space-y-8">
        <h1 className="text-5xl font-bold text-neuro-primary mb-4">
          Squiggly
        </h1>
        <p className="text-2xl text-neuro-dark font-medium">
          EEG EO/EC Diagnostics Platform
        </p>
        <p className="text-lg text-gray-800 max-w-2xl mx-auto">
          Rapid, transparent, open-source analysis of 19-channel EEG recordings comparing
          Eyes-Open and Eyes-Closed states
        </p>

        <div className="flex gap-4 justify-center mt-8">
          <Link
            href="/login"
            className="bg-neuro-primary text-white px-8 py-3 rounded-lg text-lg font-medium hover:bg-neuro-accent transition-colors shadow-lg"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/your-repo/squiggly"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white border-2 border-neuro-primary text-neuro-primary px-8 py-3 rounded-lg text-lg font-medium hover:bg-neuro-light transition-colors shadow-lg"
          >
            Learn More
          </a>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-3">🧠</div>
            <h3 className="font-semibold text-neuro-dark mb-2">Multi-Domain Analysis</h3>
            <p className="text-sm text-gray-800">
              Power, coherence, complexity, and asymmetry metrics
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-semibold text-neuro-dark mb-2">Interactive Visualizations</h3>
            <p className="text-sm text-gray-800">
              Topomaps, spectrograms, and coherence matrices
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-3">🔒</div>
            <h3 className="font-semibold text-neuro-dark mb-2">Private & Secure</h3>
            <p className="text-sm text-gray-800">
              Project-level privacy with role-based access control
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
