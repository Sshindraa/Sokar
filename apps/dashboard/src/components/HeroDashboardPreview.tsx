// Capture du vrai dashboard Sokar (restaurant de démonstration « Chez Sokar », données fictives),
// sous le hero à la manière de linear.app. Une capture par format d'écran, chargée en priorité.
export default function HeroDashboardPreview() {
  return (
    <div className="relative ml-[calc(50%-min(50vw,800px))] mt-16 w-[min(100vw,1600px)] shrink-0 self-start px-4 text-left sm:mt-20 sm:px-6 lg:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -top-16 h-72 rounded-full bg-pricing-accent/25 blur-3xl"
      />

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-1.5 shadow-2xl shadow-black/60 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
        {/* La capture est l'élément principal sur mobile (LCP) : on précharge la bonne version
            dès le HTML, au lieu d'attendre que le navigateur découvre la balise <picture>. */}
        <link
          rel="preload"
          as="image"
          href="/marketing/dashboard-mobile.webp"
          media="(max-width: 639px)"
          fetchPriority="high"
        />
        <link
          rel="preload"
          as="image"
          href="/marketing/dashboard-tablet.webp"
          media="(min-width: 640px) and (max-width: 1279px)"
          fetchPriority="high"
        />
        <link
          rel="preload"
          as="image"
          href="/marketing/dashboard-desktop.webp"
          media="(min-width: 1280px)"
          fetchPriority="high"
        />
        <picture>
          <source media="(max-width: 639px)" srcSet="/marketing/dashboard-mobile.webp" />
          <source media="(max-width: 1279px)" srcSet="/marketing/dashboard-tablet.webp" />
          <img
            src="/marketing/dashboard-desktop.webp"
            alt="Tableau de bord Sokar : réservations, couverts, chiffre d'affaires estimé et réservations par canal"
            width={3200}
            height={2000}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="block max-h-[48rem] w-full rounded-xl object-cover object-top"
          />
        </picture>
      </div>
      <p className="mt-3 text-center text-[11px] text-white/35">
        Restaurant de démonstration — données simulées
      </p>
    </div>
  );
}
