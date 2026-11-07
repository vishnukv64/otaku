import { Link } from '@tanstack/react-router'
import { Home, Search, ArrowLeft } from 'lucide-react'

/** Phone 404 (mock: design/files/you.html "Not found"). */
export function NotFound() {
  return (
    <div className="text-center px-8 pt-10">
      <div className="font-display text-[150px] font-bold leading-none opacity-[0.07] select-none" aria-hidden="true">
        404
      </div>
      <div className="w-24 h-24 rounded-full bg-[var(--color-accent-primary)]/10 flex items-center justify-center mx-auto -mt-[110px] mb-10">
        <Search size={32} className="text-[var(--color-accent-primary)]" />
      </div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-text-primary)] mb-2.5">Page Not Found</h1>
      <p className="text-[var(--color-text-secondary)] mb-6">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex gap-3 justify-center">
        <button
          onClick={() => window.history.back()}
          className="min-h-[44px] px-5 rounded-[var(--radius-md)] bg-white/[0.14] text-white font-semibold flex items-center gap-2"
        >
          <ArrowLeft size={20} /> Go Back
        </button>
        <Link
          to="/"
          className="min-h-[44px] px-5 rounded-[var(--radius-md)] bg-[var(--color-accent-primary)] text-white font-semibold flex items-center gap-2"
        >
          <Home size={20} /> Home
        </Link>
      </div>
    </div>
  )
}
