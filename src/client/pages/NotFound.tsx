import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="max-w-lg py-16">
      <h1 className="type-display text-2xl">This page does not exist</h1>
      <p className="mt-2 text-muted">Check the address, or go back to the dashboard.</p>
      <Link to="/" className="mt-4 inline-block text-accent underline-offset-4 hover:underline">
        Open the dashboard
      </Link>
    </div>
  );
}
