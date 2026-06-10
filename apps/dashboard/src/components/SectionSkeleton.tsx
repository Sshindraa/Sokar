import { cn } from '@/lib/utils';

interface SectionSkeletonProps {
  variant: 'storyboard' | 'demo';
  className?: string;
}

/**
 * Placeholder reserved for deferred dynamic sections.
 * Mirrors the real section's height to avoid CLS while the
 * heavy client bundle (framer-motion / chat timer) is loaded.
 */
export default function SectionSkeleton({ variant, className }: SectionSkeletonProps) {
  if (variant === 'storyboard') {
    return (
      <section
        aria-hidden="true"
        className={cn(
          'relative w-full bg-black/40',
          // ScrollStoryboard renders h-[260vh] — reserve it
          'min-h-[260vh]',
          className,
        )}
      >
        <div className="sticky top-0 flex h-screen w-full items-center justify-center px-4 sm:px-6 lg:px-10">
          <div className="h-[min(76vh,46rem)] w-full max-w-6xl rounded-[2rem] border border-white/10 bg-black/40" />
        </div>
      </section>
    );
  }

  // demo
  return (
    <section
      aria-hidden="true"
      className={cn(
        'relative flex w-full flex-col items-center justify-center px-4 py-20 sm:px-6 lg:px-10',
        'min-h-[100vh]',
        className,
      )}
    >
      <div className="relative z-10 mb-12 h-10 w-80 max-w-lg rounded-md bg-white/5" />
      <div className="relative z-10 grid w-full gap-4 lg:grid-cols-[1.08fr_1fr] lg:gap-6">
        <div className="flex h-[min(76vh,46rem)] flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5" />
        <div className="h-[min(76vh,46rem)] rounded-2xl border border-white/10 bg-black/40" />
      </div>
    </section>
  );
}
