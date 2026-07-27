export default function Loading() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <div className="mb-6 h-4 w-28 animate-pulse rounded bg-surface-2" />
      <div className="mb-3 h-8 w-64 animate-pulse rounded bg-surface-2" />
      <div className="mb-8 h-4 w-44 animate-pulse rounded bg-surface-2" />
      <div className="grid gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-xl border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}
