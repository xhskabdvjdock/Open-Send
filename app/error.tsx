'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="center-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 44, margin: '0 0 6px' }}>500</h1>
        <h2>Something went wrong</h2>
        <p className="muted small">{error?.message || 'Unexpected error.'}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={reset}>Try again</button>
          <a className="btn" href="/">Go home</a>
        </div>
      </div>
    </div>
  );
}
