export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-neuro-light">
      <div className="z-10 max-w-5xl w-full items-center justify-center font-mono text-sm">
        <h1 className="text-4xl font-bold text-neuro-primary mb-4">
          Squiggly
        </h1>
        <p className="text-xl text-neuro-dark">
          EEG EO/EC Diagnostics Platform
        </p>
        <p className="mt-4 text-gray-600">
          Rapid, transparent, open-source analysis of 19-channel EEG recordings
        </p>
      </div>
    </main>
  );
}
