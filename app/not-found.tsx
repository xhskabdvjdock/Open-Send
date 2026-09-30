export default function NotFound() {
  return (
    <div className="center-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 52, margin: '0 0 6px' }}>404</h1>
        <h2>Page not found</h2>
        <p className="muted">The page you are looking for does not exist.</p>
        <a className="btn btn-primary" href="/">Go home</a>
      </div>
    </div>
  );
}
