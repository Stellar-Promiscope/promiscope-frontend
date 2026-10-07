import Link from 'next/link';
import Navbar from '@/components/Navbar';

export const metadata = {
  title: 'Page Not Found – Promiscope',
  description: 'The page you are looking for does not exist or has been moved.',
};

export default function NotFound() {
  return (
    <html lang="en">
      <body className="bg-brand-dark text-white font-sans">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8 min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div className="text-center space-y-8">
            <div className="flex justify-center">
              <svg
                className="w-32 h-32 text-brand-green opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="space-y-4">
              <h1 className="text-8xl font-bold text-brand-green">404</h1>
              <h2 className="text-2xl font-semibold text-white">
                Page Not Found
              </h2>
              <p className="text-gray-400 max-w-md mx-auto">
                The page you are looking for does not exist or has been moved.
              </p>
            </div>
            <Link
              href="/"
              className="inline-block bg-brand-green text-black font-semibold px-6 py-3 rounded-lg hover:opacity-90 transition"
            >
              Go Home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
