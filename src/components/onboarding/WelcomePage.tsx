import { Play, BookOpen, Library, Download, Search, FastForward } from 'lucide-react'
import { FeatureCard } from './FeatureCard'
import { isMobile } from '@/utils/platform'
import logoUrl from '@/assets/logo.png'

const features = [
  {
    icon: Play,
    title: 'Anime Streaming',
    description: 'Stream anime with quality selection and multiple servers',
    accentColor: '#e50914',
  },
  {
    icon: BookOpen,
    title: 'Manga Reader',
    description: 'Read manga in single, double, or vertical scroll mode',
    accentColor: '#e50914',
  },
  {
    icon: Library,
    title: 'Library & Tracking',
    description: 'Track progress and organize your watchlist',
    accentColor: '#e50914',
  },
  {
    icon: Download,
    title: 'Offline Downloads',
    description: 'Download episodes and chapters for offline viewing',
    accentColor: '#e50914',
  },
  {
    icon: Search,
    title: 'Smart Search',
    description: 'Find any anime or manga with spotlight search',
    accentColor: '#e50914',
  },
  {
    icon: FastForward,
    title: 'Continue Watching',
    description: 'Resume right where you left off',
    accentColor: '#e50914',
  },
]

interface WelcomePageProps {
  onGetStarted: () => void
}

export function WelcomePage({ onGetStarted }: WelcomePageProps) {
  const mobile = isMobile()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-auto">
      {/* Subtle radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(229, 9, 20, 0.1), transparent 60%)',
        }}
      />

      <div
        className={`relative z-10 w-full flex flex-col items-center ${
          mobile ? 'px-6 py-12 pt-[calc(12px+var(--sat))]' : 'px-8 py-16 max-w-3xl mx-auto'
        }`}
      >
        {/* Logo */}
        <img
          src={logoUrl}
          alt="Otaku"
          className="animate-onboarding-fade-up w-20 h-20 mb-4"
          style={{
            animationDelay: '0ms',
            filter: 'drop-shadow(0 0 20px rgba(229, 9, 20, 0.4))',
          }}
        />

        {/* Title */}
        <h1
          className="animate-onboarding-fade-up text-4xl font-bold bg-gradient-to-r from-red-500 via-red-600 to-red-700 bg-clip-text text-transparent mb-2"
          style={{ animationDelay: '100ms' }}
        >
          OTAKU
        </h1>

        {/* Tagline */}
        <p
          className={`animate-onboarding-fade-up text-[var(--color-text-secondary)] text-base ${mobile ? 'mb-6' : 'mb-10'}`}
          style={{ animationDelay: '200ms' }}
        >
          Your anime &amp; manga companion
        </p>

        {/* Feature Cards */}
        <div
          className={
            mobile
              ? 'w-full grid grid-cols-2 gap-3 mb-8'
              : 'w-full grid grid-cols-3 gap-4 mb-12'
          }
        >
          {features.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              accentColor={feature.accentColor}
              delay={300 + i * 80}
              mobile={mobile}
            />
          ))}
        </div>

        {/* CTA Button */}
        <button
          onClick={onGetStarted}
          className="animate-onboarding-fade-up px-8 py-3 rounded-xl bg-[#e50914] text-white font-semibold text-base hover:bg-[#ff1a25] transition-all active:scale-95"
          style={{ animationDelay: `${300 + features.length * 80 + 100}ms` }}
        >
          Get Started
        </button>
      </div>
    </div>
  )
}
